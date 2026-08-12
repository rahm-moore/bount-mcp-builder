# shared/validation

Cross-server validation harness run by CI (`.github/workflows/ci.yml`,
`shared-validation` job) against every package under `mcp-servers/`.

## What it checks

- **contract-tests.ts** — every `mcp-servers/*/mcp.config.json` is present,
  has the required top-level fields (`name`, `description`, `version`,
  `tools`), and every tool entry has a `name`, `description`, and a
  structurally valid `inputSchema` (and `outputSchema` if present).
- **chaos/simulate-timeout.ts** — a small chaos-testing helper for
  verifying that callers of sub-MCP tools (orchestrator, web-ui backend)
  handle timeouts gracefully instead of hanging. Not yet wired into CI by
  default since it depends on the orchestrator's real transport being
  implemented (see `orchestrator/src/router.ts`); intended for use once
  that lands.

## Running locally

```bash
cd shared/validation
npm install
npm run ci
```

## Adding a new server

When you add a new package under `mcp-servers/`, as long as it has a
top-level `mcp.config.json` it is picked up automatically by
`validateAllServers()` — no changes needed here. See
`docs/onboarding.md` for the full new-server checklist.
