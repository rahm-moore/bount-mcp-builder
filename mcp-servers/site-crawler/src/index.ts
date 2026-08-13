#!/usr/bin/env node
/**
 * site-crawler MCP server entrypoint.
 */

import { createServer as createHttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { crawl, getFindings } from "./mcp-tools.js";

function createMcpServer(): Server {
  const server = new Server(
    { name: "site-crawler", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "crawl",
        description: "Crawl a domain and audit its Web SDK (alloy.js) implementation.",
        inputSchema: {
          type: "object",
          properties: {
            profile: { type: "string", description: "Named credential profile for gated/staging domains" },
            domain: { type: "string", description: "Domain to crawl, e.g. www.citbank.com" },
          },
          required: ["profile", "domain"],
        },
      },
      {
        name: "getFindings",
        description: "Poll for the status/findings of a previously started crawl job.",
        inputSchema: {
          type: "object",
          properties: {
            jobId: { type: "string" },
          },
          required: ["jobId"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "crawl") {
      const { profile, domain } = args as { profile: string; domain: string };
      const result = await crawl(profile, domain);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    if (name === "getFindings") {
      const { jobId } = args as { jobId: string };
      const result = getFindings(jobId);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

/**
 * Transport is env-driven: "stdio" (default — e.g. a local Claude Desktop
 * config invoking this as a subprocess) or "streamable-http" (used in
 * docker-compose, where the orchestrator reaches this server over HTTP
 * at http://site-crawler:<port>/mcp — see orchestrator/src/router.ts).
 *
 * The in-memory crawl job store (mcp-tools.ts) lives at module scope, so
 * it's shared across requests/connections regardless of transport — only
 * the MCP protocol plumbing (Server + transport) is recreated per HTTP
 * request. That per-request recreation isn't a style choice: a stateless
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
    const port = Number(process.env.PORT ?? 8802);
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
        console.error("site-crawler MCP request failed:", err);
        if (!res.headersSent) res.writeHead(500).end();
      }
    }).listen(port, () => {
      console.log(`site-crawler MCP server listening on :${port} (streamable-http)`);
    });
    return;
  }

  throw new Error(`Unknown MCP_TRANSPORT: ${transportKind}`);
}

main().catch((err) => {
  console.error("site-crawler MCP server failed to start:", err);
  process.exit(1);
});
