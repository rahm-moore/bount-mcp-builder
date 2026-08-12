# Security Model

This document describes the credential-isolation pattern used across
every MCP server in this repo, and the audit logging that sits in front
of it. If you're adding a new server or a new tool to an existing one,
this is the contract you need to follow.

## The core rule

**MCP tools accept a `profile` name string. They never accept a raw
secret value as a tool argument, and they never return one in a tool's
response payload.**

This applies to every tool signature, every log line, and every error
message across `aep-core` and `site-crawler` (the two servers that touch
authenticated systems; `industry-news-tracker` and `orchestrator` hold no
secrets at all).

## The credential-resolver pattern

Each server that needs credentials has exactly one module responsible for
turning a profile name into a usable credential:

- Python: `mcp-servers/aep-core/src/aep_core/auth/credential_resolver.py`
- TypeScript: `mcp-servers/site-crawler/src/auth/credential-resolver.ts`

Both implement the same contract:

```
resolve_profile(profile_name: str, domain: str) -> ResolvedCredentials
```

1. **Look up the profile** in `secrets/profiles.json` (a real file,
   gitignored — see `secrets/README.md`). Unknown profile → error, no
   secret lookup attempted.
2. **Validate the domain** against that profile's `allowedDomains`
   allowlist. A credential can't be replayed against a domain it wasn't
   provisioned for, even if the profile name leaks or is guessed —
   e.g. a `cit_bank_test_user` profile scoped to `citbank-staging.com`
   cannot be used against `some-other-client.com`.
3. **Resolve the actual secret value**, backend selected by the
   `MCP_SECRETS_BACKEND` env var:
   - `local` (default): pull values from per-profile environment
     variables. Local-dev only.
   - `vault`: production path — look up the profile's `vaultRef` in
     HashiCorp Vault / AWS Secrets Manager. (Marked
     `NotImplementedError`/`throw` in this skeleton; wire up the actual
     client call when a backend is chosen.)
4. **Return the resolved credential object to internal server code
   only.** It is never serialized into a tool response, never logged
   (both `ResolvedCredentials.__repr__` in Python and `toString()` in
   TypeScript are hand-written to redact everything but the profile name
   and non-secret metadata), and never passed back to the calling model.

## `secrets/profiles.json`

Real file, gitignored (`.gitignore` excludes `secrets/profiles.json` and
any `**/credentials.json`). Maps profile names to:

```json
{
  "cit_bank_test_user": {
    "vaultRef": "<vault-path>",
    "allowedDomains": ["<domain>"]
  }
}
```

It never contains a secret value itself — only where to find one
(`vaultRef`, production) or, implicitly, which env vars to check
(`local`, dev). See `secrets/profiles.example.json` for the checked-in
placeholder template and `secrets/README.md` for the full policy
including rotation guidance.

## Audit logging

Every credential-scoped tool invocation is logged by
`orchestrator/src/audit-log.ts`, since the orchestrator is the layer that
fronts every call to `aep-core` and `site-crawler`. Each entry records:

- `caller` — which client/session initiated the call
- `server` / `tool` — which sub-MCP server and tool were invoked
- `profile` — the profile *name* used (never the resolved credential)
- `domain` — the domain the call was scoped to
- `timestamp`, `durationMs`, `outcome` (`success`/`error`)

The audit logger is intentionally dumb about *values* — it only ever
receives the same profile/domain strings that were already validated by
the credential resolver, and it's covered by a test
(`orchestrator/tests/audit-log.test.ts`) asserting that secret-shaped
fields (`access_token`, `client_secret`) never appear in an audit entry.

## Defense in depth

- `aep-core`'s internal logger (`core/logger.py`) independently redacts
  any dict key that looks secret-shaped (`access_token`,
  `client_secret`, `api_key`, etc.) before writing a log line, as a
  backstop in case a future contributor accidentally logs a raw response
  that happens to include one.
- Governance and sandbox mutation calls
  (`governance/governance.py::apply_usage_label`,
  `sandboxes/sandboxes.py::reset_sandbox`) are left as explicit
  `NotImplementedError`s rather than being wired up straight to a
  destructive API call — the compliance/blast-radius review for those
  needs to happen before the code does, not after.

## What this does *not* cover yet

- Vault/AWS Secrets Manager wiring (`_resolve_vault` /
  `resolveVault` are `NotImplementedError` placeholders) — pick a backend
  before going to production with a real client credential.
- The orchestrator's actual sub-server transport
  (`callSubServerTool` in `router.ts`) is also a placeholder; audit
  logging is wired around it correctly, but there's no live dispatch yet
  to audit.
