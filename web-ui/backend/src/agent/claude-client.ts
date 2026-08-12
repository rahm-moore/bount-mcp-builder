/**
 * Agent SDK client stub: this is the piece that actually embeds Claude
 * into the team's own dashboard (see docs/architecture.md). Rather than
 * the team working inside Claude Code's own UI, this wires the same MCP
 * servers (aep-core, site-crawler, orchestrator) as tools Claude can call
 * from within this app's /api/chat endpoint.
 *
 * Requires ANTHROPIC_API_KEY in the environment. Never accept an API key
 * or any other credential as a request parameter from the frontend — it
 * must only ever come from server-side environment/secrets configuration.
 */

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5";

export interface McpServerConfig {
  name: string;
  url: string;
}

export interface ChatResult {
  reply: string;
  toolCalls: { server: string; tool: string }[];
}

function getConfiguredMcpServers(): McpServerConfig[] {
  const servers: McpServerConfig[] = [];
  if (process.env.AEP_CORE_URL) servers.push({ name: "aep-core", url: process.env.AEP_CORE_URL });
  if (process.env.SITE_CRAWLER_URL) servers.push({ name: "site-crawler", url: process.env.SITE_CRAWLER_URL });
  if (process.env.ORCHESTRATOR_URL) servers.push({ name: "orchestrator", url: process.env.ORCHESTRATOR_URL });
  return servers;
}

export class ClaudeClient {
  private anthropic: Anthropic;

  constructor(apiKey: string | undefined = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Configure it via the environment/secrets " +
          "manager — never pass it through a request body or query param."
      );
    }
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Sends a single chat turn to Claude with the configured MCP servers
   * available as tools. The actual MCP tool-wiring (connecting the
   * Anthropic client's tool-use loop to each configured server's tool
   * list, and dispatching tool_use blocks back to those servers) is left
   * as a documented gap — see the Agent SDK / MCP connector docs for the
   * exact wiring once a server transport (see orchestrator/src/router.ts)
   * is finalized.
   */
  async chat(message: string): Promise<ChatResult> {
    const mcpServers = getConfiguredMcpServers();

    if (mcpServers.length === 0) {
      throw new NotImplementedInLocalDevError(
        "No MCP servers configured (AEP_CORE_URL / SITE_CRAWLER_URL / ORCHESTRATOR_URL). " +
          "wire up the Agent SDK's MCP connector against these once the servers are reachable."
      );
    }

    throw new NotImplementedInLocalDevError(
      `wire up Anthropic messages.create() with model=${MODEL}, the incoming message, and ` +
        `mcp_servers=${JSON.stringify(mcpServers.map((s) => s.name))} as tool sources; loop on ` +
        `tool_use content blocks until a final text response is produced`
    );
  }
}

class NotImplementedInLocalDevError extends Error {}
