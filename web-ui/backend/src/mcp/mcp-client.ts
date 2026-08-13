/**
 * Shared MCP client helper for the web-ui backend: connects to an MCP
 * server over Streamable HTTP (same transport as orchestrator/src/router.ts
 * and each MCP server's own MCP_TRANSPORT=streamable-http mode), caches
 * one connection per server name, and unwraps a tool result's JSON
 * payload. Used by both the chat tool loop (agent/claude-client.ts) and
 * the direct REST proxy routes (api/routes.ts) so the JSON-vs-plain-text
 * error handling only lives in one place.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const clients = new Map<string, Promise<Client>>();

export async function getMcpClient(serverName: string, baseUrl: string): Promise<Client> {
  const existing = clients.get(serverName);
  if (existing) return existing;

  const clientPromise = (async () => {
    const client = new Client({ name: `web-ui-backend->${serverName}`, version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", baseUrl)));
    return client;
  })();

  clients.set(serverName, clientPromise);
  // Don't poison the cache on a failed connection attempt — let the next
  // call retry fresh instead of failing forever.
  clientPromise.catch(() => clients.delete(serverName));
  return clientPromise;
}

/**
 * Extracts the JSON payload from an MCP tool result. On error, this can't
 * assume JSON: a sub-server's underlying framework can turn an uncaught
 * exception into a plain-text error message (confirmed against aep-core's
 * FastMCP runtime — see orchestrator/src/router.ts for the same handling),
 * so error text is surfaced as-is, JSON-decoded only on a best-effort basis.
 */
export function parseToolResult(result: { content?: { type: string; text?: string }[]; isError?: boolean }): unknown {
  const textBlock = result.content?.find((block) => block.type === "text");
  if (!textBlock?.text) {
    throw new Error(`Tool call returned no text content: ${JSON.stringify(result)}`);
  }

  if (result.isError) {
    let detail = textBlock.text;
    try {
      detail = JSON.stringify(JSON.parse(textBlock.text));
    } catch {
      // Not JSON — use as-is.
    }
    throw new Error(`Tool call failed: ${detail}`);
  }

  return JSON.parse(textBlock.text);
}

export async function callMcpTool(
  serverName: string,
  baseUrl: string,
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const client = await getMcpClient(serverName, baseUrl);
  const result = await client.callTool({ name: tool, arguments: args });
  return parseToolResult(result as { content?: { type: string; text?: string }[]; isError?: boolean });
}
