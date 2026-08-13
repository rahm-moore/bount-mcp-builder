/**
 * Agent SDK client: this is the piece that actually embeds Claude into
 * the team's own dashboard (see docs/architecture.md). Rather than the
 * team working inside Claude Code's own UI, this wires MCP servers as
 * tools Claude can call from within this app's /api/chat endpoint, using
 * the same Streamable HTTP transport as orchestrator/src/router.ts.
 *
 * Requires ANTHROPIC_API_KEY in the environment. Never accept an API key
 * or any other credential as a request parameter from the frontend — it
 * must only ever come from server-side environment/secrets configuration.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getMcpClient } from "../mcp/mcp-client.js";

const MODEL = "claude-sonnet-5";
const MAX_TOOL_LOOP_ITERATIONS = 8;

export interface McpServerConfig {
  name: string;
  url: string;
}

export interface ChatResult {
  reply: string;
  toolCalls: { server: string; tool: string }[];
}

/**
 * Only servers that either hold no secrets (industry-news-tracker) or
 * that themselves enforce audit logging for anything that does
 * (orchestrator) are wired into chat. aep-core and site-crawler are
 * deliberately NOT connected here even if their *_URL env vars happen to
 * be set in this environment: every credential-scoped call must go
 * through the orchestrator's audit log (docs/security-model.md), and
 * connecting this chat surface to them directly would let a model
 * bypass that.
 */
function getConfiguredMcpServers(): McpServerConfig[] {
  const servers: McpServerConfig[] = [];
  if (process.env.ORCHESTRATOR_URL) servers.push({ name: "orchestrator", url: process.env.ORCHESTRATOR_URL });
  if (process.env.INDUSTRY_NEWS_TRACKER_URL) {
    servers.push({ name: "industry-news-tracker", url: process.env.INDUSTRY_NEWS_TRACKER_URL });
  }
  return servers;
}

interface ToolSource {
  serverName: string;
  toolName: string;
}

/**
 * Anthropic tool names must be unique across the whole request, but two
 * different MCP servers could expose a same-named tool. Prefixing with
 * the server name (joined by "__", since Anthropic tool names must match
 * [a-zA-Z0-9_-]) keeps them distinguishable and lets dispatch map a
 * tool_use block straight back to the right server.
 */
function anthropicToolName(serverName: string, toolName: string): string {
  return `${serverName}__${toolName}`;
}

async function buildToolCatalog(
  servers: McpServerConfig[]
): Promise<{ tools: Anthropic.Tool[]; sources: Map<string, ToolSource> }> {
  const tools: Anthropic.Tool[] = [];
  const sources = new Map<string, ToolSource>();

  for (const { name: serverName, url } of servers) {
    const client = await getMcpClient(serverName, url);
    const { tools: serverTools } = await client.listTools();
    for (const tool of serverTools) {
      const name = anthropicToolName(serverName, tool.name);
      tools.push({
        name,
        description: tool.description ?? "",
        input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      });
      sources.set(name, { serverName, toolName: tool.name });
    }
  }

  return { tools, sources };
}

function extractResultText(result: { content?: { type: string; text?: string }[] }): string {
  const block = result.content?.find((b) => b.type === "text");
  return block?.text ?? "";
}

function extractReplyText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
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
   * Sends a chat turn to Claude with the configured MCP servers available
   * as tools, looping on tool_use content blocks (dispatching each back to
   * the MCP server that exposed it) until Claude produces a final text
   * response or MAX_TOOL_LOOP_ITERATIONS is hit.
   */
  async chat(message: string): Promise<ChatResult> {
    const servers = getConfiguredMcpServers();
    const toolCalls: { server: string; tool: string }[] = [];

    if (servers.length === 0) {
      const response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: message }],
      });
      return { reply: extractReplyText(response.content), toolCalls };
    }

    const { tools, sources } = await buildToolCatalog(servers);
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: message }];

    for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration++) {
      const response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        messages,
        tools,
      });

      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) {
        return { reply: extractReplyText(response.content), toolCalls };
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const source = sources.get(block.name);
        if (!source) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Unknown tool: ${block.name}`,
            is_error: true,
          });
          continue;
        }

        toolCalls.push({ server: source.serverName, tool: source.toolName });
        const serverUrl = servers.find((s) => s.name === source.serverName)?.url;
        try {
          if (!serverUrl) throw new Error(`No URL configured for server '${source.serverName}'`);
          const client = await getMcpClient(source.serverName, serverUrl);
          const result = await client.callTool({ name: source.toolName, arguments: block.input as Record<string, unknown> });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: extractResultText(result as { content?: { type: string; text?: string }[] }),
            is_error: Boolean((result as { isError?: boolean }).isError),
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: err instanceof Error ? err.message : String(err),
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    throw new Error(`Tool loop did not converge after ${MAX_TOOL_LOOP_ITERATIONS} iterations`);
  }
}
