/**
 * Chat page — embeds Claude directly into the dashboard via the Agent SDK
 * client on the backend (web-ui/backend/src/agent/claude-client.ts).
 * This is the "Claude embedded in our app" surface described in
 * docs/architecture.md, distinct from the team using Claude Code's own
 * UI directly.
 */

import { ClaudeChatPanel } from "../../components/ClaudeChatPanel";

export default function ChatPage() {
  return (
    <main>
      <h1>Ask Claude</h1>
      <p>
        Claude here has access to the aep-core, site-crawler, and orchestrator MCP
        tools via the Agent SDK client on the backend — the same tools available in
        Claude Code, wired into our own UI instead.
      </p>
      <ClaudeChatPanel />
    </main>
  );
}
