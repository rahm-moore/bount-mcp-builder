# secrets/

This directory holds the **policy** for how MCP tool `profile` names map
to actual credentials — not the credentials themselves.

## The rule: profile name, not raw value

Every MCP tool in this repo that needs to authenticate against a real
system (AEP tenant, staging environment behind basic auth, etc.) accepts a
`profile` argument that is just a name — e.g. `"cit_bank_test_user"` —
never a client id, secret, API key, or token. The corresponding
`credential_resolver.py` / `credential-resolver.ts` in each server is the
only code allowed to turn that name into a usable credential, and it does
so at call time, inside the server process. See `docs/security-model.md`
for the full model.

## `profiles.json` (gitignored, real file)

Each server's credential resolver reads a `secrets/profiles.json` at the
repo root (path overridable via `MCP_PROFILES_PATH` for tests/containers).
This file is **not** committed — see `.gitignore` — and is not the
credential itself, only the *mapping*:

```json
{
  "cit_bank_test_user": {
    "vaultRef": "<vault-path>",
    "dopplerConfig": { "project": "<doppler-project>", "config": "<doppler-config>" },
    "allowedDomains": ["<domain>"]
  }
}
```

- `dopplerConfig` — the Doppler project/config this profile's secrets
  live in. Consulted when `MCP_SECRETS_BACKEND=doppler` — the recommended
  production backend. See `docs/security-model.md` ("Doppler setup") for
  the full walkthrough (naming convention, service tokens, rotation).
- `vaultRef` — where the real secret lives in Vault / AWS Secrets Manager,
  for the alternative `MCP_SECRETS_BACKEND=vault` path (not yet
  implemented).
- `allowedDomains` — an allowlist of domains this profile's credentials
  may be used against. A resolver call for a domain not in this list is
  rejected before any secret is even looked up, so a leaked/misused
  profile name can't be replayed against an unintended target.

For local development (`MCP_SECRETS_BACKEND=local`, the default), the
actual secret *values* come from per-profile environment variables, not
from `profiles.json` itself — see each resolver's source for the exact
env var naming convention. Copy `profiles.example.json` to `profiles.json`
to get started.

## Rotation

- Rotate credentials in Doppler (or at the source system, e.g. Adobe IMS,
  then update Doppler to match) — never by editing `profiles.json` with a
  new inline secret (it doesn't hold one, only pointers to where the real
  value lives).
- After any suspected credential exposure (e.g. a real secret accidentally
  committed anywhere, ever), rotate immediately and treat the old value as
  permanently compromised even after removal from git history.
- `secrets/profiles.json` and any `**/credentials.json` file are
  gitignored repo-wide. If either ever shows up in `git status` as
  something you're about to commit, stop and check why.
