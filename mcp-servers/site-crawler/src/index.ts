#!/usr/bin/env node
/**
 * site-crawler MCP server entrypoint.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { crawl, getFindings } from "./mcp-tools.js";

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("site-crawler MCP server failed to start:", err);
  process.exit(1);
});
