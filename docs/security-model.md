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
   - `doppler`: production path, implemented. Fetches the full secrets
     map for the profile's `dopplerConfig` (project + config) from the
     Doppler API at call time, authenticated with a single bootstrap
     `DOPPLER_TOKEN`. See "Doppler setup" below.
   - `vault`: alternative production path — look up the profile's
     `vaultRef` in HashiCorp Vault / AWS Secrets Manager. (Marked
     `NotImplementedError`/`throw` in this skeleton; only wire this up if
     you need it alongside or instead of Doppler.)
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
    "dopplerConfig": { "project": "<doppler-project>", "config": "<doppler-config>" },
    "allowedDomains": ["<domain>"]
  }
}
```

It never contains a secret value itself — only where to find one
(`dopplerConfig`/`vaultRef`, production) or, implicitly, which env vars to
check (`local`, dev). See `secrets/profiles.example.json` for the
checked-in placeholder template and `secrets/README.md` for the full
policy including rotation guidance.

## Doppler setup

This is the recommended production backend (`MCP_SECRETS_BACKEND=doppler`).
Both credential resolvers (`aep-core`'s `_resolve_doppler` and
`site-crawler`'s `resolveDoppler`) call the Doppler API directly at
resolution time — nothing is baked into the container image at build time.

1. **Create a Doppler project** for this repo (e.g. `bount-mcp-builder`),
   with one **config per profile** — e.g. `cit_bank_prod`, `rol_dev`,
   `cit_bank_test_user` — rather than one config shared across profiles.
   This keeps each profile's blast radius contained: a leaked service
   token scoped to `rol_dev` can't read `cit_bank_prod` secrets.
2. **Name each secret exactly like the local-dev env var it replaces.**
   The resolver looks up secrets by the same deterministic name it would
   use for `MCP_SECRETS_BACKEND=local`:
   - `aep-core`: `AEP_PROFILE_<PROFILE_NAME>_<FIELD>`, e.g.
     `AEP_PROFILE_CIT_BANK_PROD_CLIENT_SECRET`. Required fields:
     `BASE_URL`, `CLIENT_ID`, `CLIENT_SECRET`, `API_KEY`, `ORG_ID`,
     `TECH_ACCOUNT_ID`, `SANDBOX` (plus optional `SCOPES`,
     comma-separated).
   - `site-crawler`: `SITE_CRAWLER_PROFILE_<PROFILE_NAME>_<FIELD>`, e.g.
     `SITE_CRAWLER_PROFILE_CIT_BANK_TEST_USER_BASICAUTHUSER` and
     `..._BASICAUTHPASSWORD`.
   `<PROFILE_NAME>` is the profile name upper-cased with `-` replaced by
   `_` (matches `_env_var_for` / `envVarFor` in each resolver).
3. **Enter the real rotated secret values into Doppler** (via the
   dashboard or `doppler secrets set`) — never into `secrets/profiles.json`
   or this repo. `secrets/profiles.json` only records which
   `dopplerConfig.project`/`.config` a profile maps to.
4. **Mint a Doppler service token** scoped to the relevant project/config
   (Doppler dashboard → project → Access → Service Tokens). Set it as
   `DOPPLER_TOKEN` in the environment the MCP server process itself runs
   in (its container's env, or CI secret store) — this is the one
   credential that has to exist outside of Doppler. Give the container
   only the token(s) it actually needs; don't hand every server a token
   scoped to every config.
5. **Set `MCP_SECRETS_BACKEND=doppler`** for that process. Everything
   else (profile name → domain validation → secrets download →
   `ResolvedCredentials`) happens automatically.
6. **Rotation**: rotate the value in Doppler (or at the source system,
   e.g. Adobe IMS, then update Doppler to match) — never by editing
   `secrets/profiles.json`, which doesn't hold a secret value to rotate.
   Doppler's own change history/audit log covers who changed what and
   when at the secrets-manager layer; `orchestrator/src/audit-log.ts`
   covers who *used* a profile and against which domain.

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
  `resolveVault` are still `NotImplementedError` placeholders) — Doppler
  is the implemented production path; only build this out if you need a
  second backend.
- The orchestrator's actual sub-server transport
  (`callSubServerTool` in `router.ts`) is also a placeholder; audit
  logging is wired around it correctly, but there's no live dispatch yet
  to audit.
