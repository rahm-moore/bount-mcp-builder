/**
 * Integration test for mcp/mcp-client.ts: spins up a real MCP server (same
 * pattern as orchestrator/tests/router.test.ts) on an ephemeral local port
 * and exercises getMcpClient/callMcpTool end-to-end, including the
 * JSON-vs-plain-text error handling this module shares with
 * orchestrator/src/router.ts's parseToolResult.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

function createFakeMcpServer(): Server {
  const mcpServer = new Server({ name: "fake-server", version: "0.1.0" }, { capabilities: { tools: {} } });

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "echo", description: "echoes its args back", inputSchema: { type: "object", properties: {} } }],
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === "echo") {
      return { content: [{ type: "text", text: JSON.stringify({ echoed: args }) }] };
    }
    if (name === "plainTextError") {
      // Mirrors aep-core's FastMCP runtime turning an uncaught exception
      // into a plain-text (non-JSON) error message.
      return { content: [{ type: "text", text: "Error executing tool plainTextError: boom" }], isError: true };
    }
    throw new Error(`Unknown tool: ${name}`);
  });

  return mcpServer;
}

async function startFakeServer(): Promise<{ url: string; httpServer: HttpServer }> {
  const httpServer = createServer(async (req, res) => {
    const mcpServer = createFakeMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      mcpServer.close();
    });
    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500).end(String(err));
    }
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, httpServer };
}

// Both scenarios live in one test rather than two: this test runner runs
// top-level tests in a file concurrently, and a Streamable HTTP client
// keeps a persistent connection open for server-initiated messages —
// which otherwise holds this process open past its last assertion (see
// orchestrator/tests/router.test.ts for the same issue). Forcing exit
// from an after()/second test risked racing against the first test still
// in flight; one test with an exit at the very end has no such race.
test("callMcpTool round-trips success and surfaces plain-text errors as-is", async () => {
  const { callMcpTool } = await import("../src/mcp/mcp-client.js");

  const fakeA = await startFakeServer();
  try {
    const result = await callMcpTool("test-server-a", fakeA.url, "echo", { a: 1 });
    assert.deepEqual(result, { echoed: { a: 1 } });
  } finally {
    fakeA.httpServer.close();
  }

  const fakeB = await startFakeServer();
  try {
    // Mirrors aep-core's FastMCP runtime turning an uncaught exception
    // into a plain-text (non-JSON) error message — parseToolResult must
    // surface that as-is rather than assuming all error text is JSON.
    await assert.rejects(
      () => callMcpTool("test-server-b", fakeB.url, "plainTextError", {}),
      /Error executing tool plainTextError: boom/
    );
  } finally {
    fakeB.httpServer.close();
  }

  process.exit(0);
});
