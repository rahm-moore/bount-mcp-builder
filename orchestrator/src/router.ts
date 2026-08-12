/**
 * The "MCP of MCPs" router: dispatches tool calls to the sub-MCP servers
 * (aep-core, site-crawler, industry-news-tracker) and exposes composed
 * workflows (see workflows/) as tools of its own.
 *
 * This process holds NO secrets. Every call that needs credentials still
 * passes only a `profile` name string through to the sub-server, which is
 * the one that resolves it internally (see
 * mcp-servers/aep-core/src/aep_core/auth/credential_resolver.py and
 * mcp-servers/site-crawler/src/auth/credential-resolver.ts). The
 * orchestrator's only additional responsibility on top of dispatch is
 * audit logging (see audit-log.ts).
 */

import { createServer as createHttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { withAudit } from "./audit-log.js";
import { runFullSiteAudit } from "./workflows/full-site-audit.js";

export type SubServerName = "aep-core" | "site-crawler" | "industry-news-tracker";

const SUB_SERVER_ENV_VAR: Record<SubServerName, string> = {
  "aep-core": "AEP_CORE_URL",
  "site-crawler": "SITE_CRAWLER_URL",
  "industry-news-tracker": "INDUSTRY_NEWS_TRACKER_URL",
};

// Read live rather than snapshotted at module load: env vars don't change
// in a real deployment, but reading them lazily also means tests can set
// them per-case without needing a fresh module instance each time.
function getSubServerUrl(server: SubServerName): string | undefined {
  return process.env[SUB_SERVER_ENV_VAR[server]];
}

// One connected MCP Client per sub-server, created lazily and reused
// across calls (each sub-server is a long-lived container in
// docker-compose, not a per-request process).
const subServerClients = new Map<SubServerName, Promise<Client>>();

async function getSubServerClient(server: SubServerName, baseUrl: string): Promise<Client> {
  const existing = subServerClients.get(server);
  if (existing) return existing;

  const clientPromise = (async () => {
    const client = new Client({ name: `orchestrator->${server}`, version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL("/mcp", baseUrl));
    await client.connect(transport);
    return client;
  })();

  subServerClients.set(server, clientPromise);
  // If the connection attempt fails, don't poison the cache — let the
  // next call retry a fresh connection instead of failing forever.
  clientPromise.catch(() => subServerClients.delete(server));
  return clientPromise;
}

/**
 * Closes every cached sub-server client connection and clears the cache.
 * The process never needs this in normal operation (a docker-compose
 * container just runs until stopped), but a Streamable HTTP client keeps
 * a persistent connection open for server-initiated messages, which
 * otherwise holds a test process's event loop open indefinitely — so
 * tests call this in an `after()` hook for a clean, fast exit.
 */
export async function closeSubServerClients(): Promise<void> {
  const clients = await Promise.all([...subServerClients.values()]);
  await Promise.all(clients.map((client) => client.close()));
  subServerClients.clear();
}

/**
 * Extracts the JSON payload from an MCP tool result. On success, every
 * tool in this repo's own sub-servers returns
 * `{ content: [{ type: "text", text: JSON.stringify(...) }] }` (see e.g.
 * mcp-servers/site-crawler/src/index.ts), so this just reverses that.
 *
 * On error, this can't assume JSON: aep-core's underlying FastMCP runtime
 * turns an uncaught Python exception into a plain-text error message
 * (e.g. "Error executing tool list_sandboxes: ..."), not JSON — confirmed
 * against a live cross-language call during development. So error text is
 * surfaced as-is, JSON-decoded only on a best-effort basis.
 */
function parseToolResult(result: { content?: { type: string; text?: string }[]; isError?: boolean }): unknown {
  const textBlock = result.content?.find((block) => block.type === "text");
  if (!textBlock?.text) {
    throw new Error(`Sub-server tool call returned no text content: ${JSON.stringify(result)}`);
  }

  if (result.isError) {
    let detail = textBlock.text;
    try {
      detail = JSON.stringify(JSON.parse(textBlock.text));
    } catch {
      // Not JSON (e.g. a Python exception's plain-text message) — use as-is.
    }
    throw new Error(`Sub-server tool call failed: ${detail}`);
  }

  return JSON.parse(textBlock.text);
}

/**
 * Dispatches a single tool call to a named sub-MCP server, with audit
 * logging wrapped around it. Connects to the sub-server over the MCP
 * Streamable HTTP transport (matching MCP_TRANSPORT=streamable-http on
 * each sub-server — see docker-compose.yml) and reuses one connection per
 * sub-server across calls.
 */
export async function callSubServerTool(
  server: SubServerName,
  tool: string,
  args: Record<string, unknown>,
  context: { caller: string }
): Promise<unknown> {
  const baseUrl = getSubServerUrl(server);
  if (!baseUrl) {
    throw new Error(`No URL configured for sub-server '${server}' (set its *_URL env var)`);
  }

  return withAudit(
    {
      caller: context.caller,
      server,
      tool,
      profile: typeof args.profile === "string" ? args.profile : undefined,
      domain: typeof args.domain === "string" ? args.domain : undefined,
    },
    async () => {
      const client = await getSubServerClient(server, baseUrl);
      const result = await client.callTool({ name: tool, arguments: args });
      return parseToolResult(result as { content?: { type: string; text?: string }[]; isError?: boolean });
    }
  );
}

function createMcpServer(): Server {
  const server = new Server(
    { name: "orchestrator", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "fullSiteAudit",
        description: "Composed workflow: crawl a domain, check findings against aep-core's expected schema/datastream config, and produce a report.",
        inputSchema: {
          type: "object",
          properties: {
            profile: { type: "string" },
            domain: { type: "string" },
            edgeConfigId: { type: "string" },
          },
          required: ["profile", "domain", "edgeConfigId"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "fullSiteAudit") {
      const { profile, domain, edgeConfigId } = args as {
        profile: string;
        domain: string;
        edgeConfigId: string;
      };
      const report = await runFullSiteAudit({ profile, domain, edgeConfigId, caller: "orchestrator-tool" });
      return { content: [{ type: "text", text: JSON.stringify(report) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

/**
 * Transport is env-driven: "stdio" (default) or "streamable-http" (used
 * in docker-compose, where web-ui/backend reaches this server over HTTP
 * at http://orchestrator:<port>/mcp — see
 * web-ui/backend/src/agent/claude-client.ts).
 *
 * A new Server + transport is created per HTTP request: a stateless
 * StreamableHTTPServerTransport (sessionIdGenerator: undefined) throws if
 * handleRequest() is called on it more than once — it's built for
 * exactly one request each.
 */
async function main() {
  const transportKind = process.env.MCP_TRANSPORT ?? "stdio";

  if (transportKind === "stdio") {
    await createMcpServer().connect(new StdioServerTransport());
    return;
  }

  if (transportKind === "streamable-http") {
    const port = Number(process.env.PORT ?? 8800);
    createHttpServer(async (req, res) => {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err) {
        console.error("orchestrator MCP request failed:", err);
        if (!res.headersSent) res.writeHead(500).end();
      }
    }).listen(port, () => {
      console.log(`orchestrator MCP server listening on :${port} (streamable-http)`);
    });
    return;
  }

  throw new Error(`Unknown MCP_TRANSPORT: ${transportKind}`);
}

main().catch((err) => {
  console.error("orchestrator failed to start:", err);
  process.exit(1);
});
