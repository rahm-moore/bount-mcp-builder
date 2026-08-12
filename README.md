# bount-mcp-builder

A monorepo of Model Context Protocol (MCP) servers supporting Bounteous's Adobe
Experience Platform (AEP) consulting practice — spanning Web SDK / alloy.js
tag implementations, real-time CDP configuration, and cross-client audit
tooling.

This library is designed to be reused across clients (current: **CIT Bank**,
Adobe Web SDK). Each MCP server is a standalone, independently deployable
package; an orchestrator composes them into higher-level workflows; and a
small internal web UI embeds Claude (via the Agent SDK) as the primary
interface for the team.

## Layout

- `mcp-servers/aep-core` — Python MCP server exposing the full AEP API surface
  (auth, Flow Service dataflows/datastreams, Schema Registry, Catalog,
  Segmentation, Identity Graph, Governance, Sandboxes).
- `mcp-servers/site-crawler` — Node/TypeScript MCP server that crawls client
  sites and audits Web SDK (alloy.js) implementations.
- `mcp-servers/industry-news-tracker` — Node/TypeScript MCP server that
  tracks Adobe release notes and industry RSS feeds and builds digests.
- `orchestrator` — composes the sub-servers above into end-to-end workflows.
  Holds no secrets of its own.
- `shared/` — cross-server validation harness and shared TypeScript types.
- `secrets/` — profile-to-secret mapping policy (the real mapping file is
  gitignored; only an example manifest and the policy doc live here).
- `web-ui/` — internal dashboard (Next.js frontend + Express backend) that
  embeds Claude via the Agent SDK, wired to the MCP servers above as tools.

See [`docs/architecture.md`](docs/architecture.md) for the full system
design, [`docs/security-model.md`](docs/security-model.md) for the
credential-isolation model, and [`docs/onboarding.md`](docs/onboarding.md)
to get a local environment running.

## Status

Actively developed. Current primary engagement: CIT Bank (Adobe Web SDK).
This repo is client-agnostic — client-specific configuration lives in
per-client profiles under `secrets/`, never hardcoded into server code.
