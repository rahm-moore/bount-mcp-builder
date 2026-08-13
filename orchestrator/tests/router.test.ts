/**
 * Integration test for callSubServerTool: spins up a real MCP server (the
 * same Server + StreamableHTTPServerTransport classes a sub-server like
 * site-crawler uses) on an ephemeral local port, points a sub-server URL
 * env var at it, and exercises the orchestrator's real dispatch path
 * end-to-end rather than mocking the MCP client.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// A Streamable HTTP client keeps a persistent connection open for
// server-initiated messages, which otherwise holds this test file's
// process open well past its last assertion — close every cached
// sub-server client once all tests in this file are done.
after(async () => {
  const { closeSubServerClients } = await import("../src/router.js");
  await closeSubServerClients();
  // client.close() only aborts in-flight requests — it doesn't tear down
  // the underlying fetch/undici keep-alive connection pool, which keeps
  // this process's event loop open indefinitely even though every test
  // and this hook itself has already finished. Force exit rather than
  // let node:test's runner wait on handles nothing further will use.
  process.exit(0);
});

function createFakeMcpServer(calls: Record<string, unknown>[]): Server {
  const mcpServer = new Server({ name: "fake-sub-server", version: "0.1.0" }, { capabilities: { tools: {} } });

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{ name: "echo", description: "echoes its args back", inputSchema: { type: "object", properties: {} } }],
  }));

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === "echo") {
      calls.push(args ?? {});
      return { content: [{ type: "text", text: JSON.stringify({ echoed: args }) }] };
    }
    if (name === "boom") {
      return { content: [{ type: "text", text: JSON.stringify({ error: "boom" }) }], isError: true };
    }
    throw new Error(`Unknown tool: ${name}`);
  });

  return mcpServer;
}

/**
 * Mirrors the real servers' streamable-http wiring exactly (see e.g.
 * mcp-servers/site-crawler/src/index.ts): a fresh Server + transport per
 * HTTP request, because a stateless StreamableHTTPServerTransport
 * (sessionIdGenerator: undefined) throws if handleRequest() is called on
 * it more than once. A single logical tool call is actually 2-3 HTTP
 * requests (initialize, notifications/initialized, tools/call), so this
 * isn't optional even for a single-call test.
 */
async function startFakeSubServer(): Promise<{ url: string; httpServer: HttpServer; calls: Record<string, unknown>[] }> {
  const calls: Record<string, unknown>[] = [];

  const httpServer = createServer(async (req, res) => {
    const mcpServer = createFakeMcpServer(calls);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      mcpServer.close();
    });
    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("fake sub-server request failed:", err);
      if (!res.headersSent) res.writeHead(500).end(String(err));
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, httpServer, calls };
}

test("callSubServerTool round-trips a real tool call over Streamable HTTP", async () => {
  const fake = await startFakeSubServer();
  process.env.SITE_CRAWLER_URL = fake.url;

  try {
    const { callSubServerTool } = await import("../src/router.js");
    const result = await callSubServerTool(
      "site-crawler",
      "echo",
      { profile: "test_profile", domain: "example.test" },
      { caller: "router.test.ts" }
    );

    assert.deepEqual(result, { echoed: { profile: "test_profile", domain: "example.test" } });
    assert.equal(fake.calls.length, 1);

    const { getAuditLog } = await import("../src/audit-log.js");
    const last = getAuditLog()[getAuditLog().length - 1];
    assert.equal(last.server, "site-crawler");
    assert.equal(last.tool, "echo");
    assert.equal(last.outcome, "success");
    assert.equal(last.profile, "test_profile");
  } finally {
    fake.httpServer.close();
    delete process.env.SITE_CRAWLER_URL;
  }
});

test("callSubServerTool throws and audit-logs an error when the tool call fails", async () => {
  // Uses a different SubServerName than the previous test (aep-core, not
  // site-crawler) — the client cache in router.ts is keyed by server name
  // and module-scoped across this whole test file, so reusing a name
  // would hand this test a stale client still pointed at the previous
  // test's (now-closed) fake server.
  const fake = await startFakeSubServer();
  process.env.AEP_CORE_URL = fake.url;

  try {
    const { callSubServerTool } = await import("../src/router.js");
    await assert.rejects(() => callSubServerTool("aep-core", "boom", {}, { caller: "router.test.ts" }));

    const { getAuditLog } = await import("../src/audit-log.js");
    const last = getAuditLog()[getAuditLog().length - 1];
    assert.equal(last.tool, "boom");
    assert.equal(last.outcome, "error");
  } finally {
    fake.httpServer.close();
    delete process.env.AEP_CORE_URL;
  }
});

test("callSubServerTool throws a clear error when no URL is configured for the server", async () => {
  delete process.env.INDUSTRY_NEWS_TRACKER_URL;
  const { callSubServerTool } = await import("../src/router.js");
  await assert.rejects(
    () => callSubServerTool("industry-news-tracker", "getWeeklyDigest", {}, { caller: "router.test.ts" }),
    /No URL configured/
  );
});
