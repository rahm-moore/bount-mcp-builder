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

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { withAudit } from "./audit-log.js";
import { runFullSiteAudit } from "./workflows/full-site-audit.js";

export type SubServerName = "aep-core" | "site-crawler" | "industry-news-tracker";

const SUB_SERVER_URLS: Record<SubServerName, string | undefined> = {
  "aep-core": process.env.AEP_CORE_URL,
  "site-crawler": process.env.SITE_CRAWLER_URL,
  "industry-news-tracker": process.env.INDUSTRY_NEWS_TRACKER_URL,
};

/**
 * Dispatches a single tool call to a named sub-MCP server, with audit
 * logging wrapped around it. The actual wire transport to the sub-server
 * (MCP client over SSE/HTTP against its container) is left as a
 * NotImplementedError placeholder — swap in an
 * `@modelcontextprotocol/sdk` Client + appropriate transport once the
 * sub-servers are deployed and reachable at SUB_SERVER_URLS.
 */
export async function callSubServerTool(
  server: SubServerName,
  tool: string,
  args: Record<string, unknown>,
  context: { caller: string }
): Promise<unknown> {
  const baseUrl = SUB_SERVER_URLS[server];
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
      throw new Error(
        `NotImplemented: wire up an MCP Client against ${baseUrl} and call tool '${tool}' ` +
          `with args ${JSON.stringify(Object.keys(args))} (values withheld from this message ` +
          `deliberately — do not log raw tool arguments here, they may include profile/domain ` +
          `pairs relevant to compliance review but should go through recordAuditEntry, not ad hoc logs)`
      );
    }
  );
}

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("orchestrator failed to start:", err);
  process.exit(1);
});
