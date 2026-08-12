#!/usr/bin/env node
/**
 * industry-news-tracker MCP server entrypoint.
 *
 * Holds no secrets — all sources are public feeds — so there is no
 * auth/credential-resolver module in this server.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildWeeklyDigest } from "./digest.js";
import { fetchIndustryRss } from "./sources/industry-rss.js";

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("industry-news-tracker MCP server failed to start:", err);
  process.exit(1);
});
