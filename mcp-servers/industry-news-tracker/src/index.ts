#!/usr/bin/env node
/**
 * industry-news-tracker MCP server entrypoint.
 *
 * Holds no secrets — all sources are public feeds — so there is no
 * auth/credential-resolver module in this server.
 */

import { createServer as createHttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildWeeklyDigest } from "./digest.js";
import { fetchIndustryRss } from "./sources/industry-rss.js";

function createMcpServer(): Server {
  const server = new Server(
    { name: "industry-news-tracker", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "getWeeklyDigest",
        description: "Build a combined Adobe release notes + industry news digest for the last N days.",
        inputSchema: {
          type: "object",
          properties: {
            windowDays: { type: "number", default: 7 },
          },
        },
      },
      {
        name: "getIndustryNews",
        description: "Fetch the raw list of curated industry RSS items (no date filtering).",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "getWeeklyDigest") {
      const windowDays = (args as { windowDays?: number } | undefined)?.windowDays ?? 7;
      const digest = await buildWeeklyDigest(windowDays);
      return { content: [{ type: "text", text: JSON.stringify(digest) }] };
    }

    if (name === "getIndustryNews") {
      const items = await fetchIndustryRss();
      return { content: [{ type: "text", text: JSON.stringify(items) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  return server;
}

/**
 * Transport is env-driven: "stdio" (default) or "streamable-http" (used
 * in docker-compose — see orchestrator/src/router.ts and
 * web-ui/backend/src/api/routes.ts, both of which reach this server
 * directly over HTTP since it holds no secrets to gate through the
 * orchestrator's audit log).
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
    const port = Number(process.env.PORT ?? 8803);
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
        console.error("industry-news-tracker MCP request failed:", err);
        if (!res.headersSent) res.writeHead(500).end();
      }
    }).listen(port, () => {
      console.log(`industry-news-tracker MCP server listening on :${port} (streamable-http)`);
    });
    return;
  }

  throw new Error(`Unknown MCP_TRANSPORT: ${transportKind}`);
}

main().catch((err) => {
  console.error("industry-news-tracker MCP server failed to start:", err);
  process.exit(1);
});
