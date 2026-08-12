# Architecture

`bount-mcp-builder` is a monorepo of independently deployable MCP
(Model Context Protocol) servers, plus a small internal web app that
embeds Claude as the primary interface to them. It exists to support
Bounteous's Adobe Experience Platform consulting practice across clients
(currently CIT Bank, on Adobe Web SDK / alloy.js).

## Layered design

```
                    ┌─────────────────────────────┐
                    │           web-ui              │
                    │  (Next.js + Express + Agent   │
                    │   SDK-embedded Claude)         │
                    └───────────────┬────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────┐
                    │        orchestrator            │
                    │  (MCP-of-MCPs, no secrets)      │
                    └───┬─────────────┬──────────┬───┘
                        │             │          │
                        ▼             ▼          ▼
               ┌────────────┐ ┌─────────────┐ ┌──────────────────────┐
               │  aep-core   │ │ site-crawler │ │ industry-news-tracker │
               │ (Python MCP)│ │ (Node MCP)   │ │ (Node MCP)             │
               └────────────┘ └─────────────┘ └──────────────────────┘
```

### `aep-core` — the foundational AEP API layer

`mcp-servers/aep-core` is a Python MCP server that exposes (or stubs, with
clearly marked `NotImplementedError`s for deep API calls) the AEP surface
a client engagement actually touches day to day:

- **auth** — profile-based credential resolution
  (`auth/credential_resolver.py`) and IMS Server-to-Server OAuth token
  management (`auth/ims_oauth.py`).
- **flow_service** — both **dataflows** (general source/destination data
  movement, `flow_service/dataflows.py`) and **datastreams**
  (`flow_service/datastreams.py`, the Web SDK / Edge Network config
  object alloy.js's `edgeConfigId` points at). Both live under Flow
  Service because that's the actual Adobe API surface that owns them.
- **schema_registry** — XDM schemas (`schema_registry/schemas.py`).
- **core/fragments.py** — the reusable field groups / data types that
  compose into those schemas, kept separate because Schema Registry
  treats them as a distinct resource type.
- **catalog** — dataset metadata (`catalog/datasets.py`).
- **segmentation** — segment definitions (`segmentation/segments.py`) and
  the publishable audiences built from them
  (`segmentation/audiences.py`).
- **identity** — identity graph lookups (`identity/identity_graph.py`),
  useful for confirming stitching behavior after a tag change.
- **governance** — data usage labels and policy evaluation
  (`governance/governance.py`), read-heavy by design given the compliance
  stakes of a banking client.
- **sandboxes** — the isolation boundary every other client above
  operates within (`sandboxes/sandboxes.py`).
- **core/merge_policy.py** and **core/snapshot.py** — merge policy
  configuration and point-in-time tenant snapshots, kept in `core/`
  because they're cross-cutting rather than owned by one API surface.

Every other server in this repo, and the orchestrator, treat `aep-core`
as the source of truth for "what does the AEP tenant actually say" —
`site-crawler` checks what a page *does* against what `aep-core` says it
*should* do (see `orchestrator/src/workflows/full-site-audit.ts`).

### `site-crawler` and `industry-news-tracker` — servers built on top

- **site-crawler** (Node/TypeScript, Playwright/Chromium) is the QA/audit
  workhorse: `crawl(profile, domain)` loads a page and runs the checks in
  `src/checks/` (alloy.js version staleness, duplicate tag loads, whether
  an expected event actually fired), and `getFindings(jobId)` polls for
  results.
- **industry-news-tracker** (Node/TypeScript) tracks Adobe release notes
  and curated martech RSS feeds and builds a weekly digest. It holds no
  secrets at all — every source it reads is public.

### `orchestrator` — the "MCP of MCPs"

`orchestrator/src/router.ts` composes calls to the three servers above
into higher-level workflows (see
`orchestrator/src/workflows/full-site-audit.ts` for the canonical
example: crawl a domain, check the observed config against `aep-core`'s
datastream configuration, and produce one combined report).

Critically, **the orchestrator holds no secrets of its own**. It only
ever passes `profile` name strings through to whichever sub-server
actually needs them; that sub-server's own credential resolver is the
only code that ever turns a name into a usable credential. The
orchestrator's one additional responsibility is audit logging
(`orchestrator/src/audit-log.ts`) — see `docs/security-model.md`.

### `web-ui` — Claude embedded in our own dashboard

The team works from its own internal dashboard
(`web-ui/frontend`, Next.js) rather than from inside Claude Code's UI
directly. The dashboard's Express backend
(`web-ui/backend/src/agent/claude-client.ts`) wires the Anthropic Agent
SDK to the same MCP servers described above as tools — so the assistant
embedded in `/chat` can, for example, kick off a site audit or answer a
question about a segment definition using the exact same tool surface a
Claude Code session would use.

GitHub remains the source of truth for code and CI regardless of which
surface (Claude Code, or this dashboard's embedded Claude) was used to
produce a change — nothing here bypasses normal PR review.

### `shared/`

- `shared/validation` is the fault-tolerance / self-validation harness CI
  runs against every server (`shared/validation/src/contract-tests.ts`
  checks every `mcp-servers/*/mcp.config.json` is well-formed;
  `shared/validation/src/chaos/simulate-timeout.ts` is a chaos-testing
  helper for verifying callers handle sub-MCP timeouts gracefully).
- `shared/types/xdm.d.ts` holds the handful of XDM-shaped TypeScript types
  more than one package needs to agree on.

## Why this shape

- **Independently deployable servers** mean a bug or a slow crawl in
  `site-crawler` can't take down `aep-core`, and each can be scaled/
  versioned on its own schedule.
- **No secrets in the orchestrator or web-ui** keeps the credential
  attack surface as small and as auditable as possible — see
  `docs/security-model.md`.
- **Reuse across clients**: nothing in `mcp-servers/` or `orchestrator/`
  is CIT-Bank-specific. Client-specific configuration lives entirely in
  `secrets/profiles.json` (gitignored) as named profiles, so onboarding a
  new client engagement is a matter of adding profiles, not forking code.
