# Onboarding

## Prerequisites

- Docker + Docker Compose
- Node 20+ and Python 3.11+ if you want to run individual servers outside
  Docker for faster iteration
- An `ANTHROPIC_API_KEY` if you want the web-ui's `/chat` panel to work

## First-time setup

1. Clone the repo and check out this branch.
2. Copy the local secrets template:
   ```bash
   cp secrets/profiles.example.json secrets/profiles.json
   ```
   Edit `secrets/profiles.json` to add a profile per client/environment
   you'll be working against (see `secrets/README.md` for the exact
   shape). Remember: this file maps profile names to *where* a secret
   lives (or, for local dev, implies which env vars to set) — it never
   contains a secret value itself.
3. For each profile in `secrets/profiles.json`, set the corresponding
   per-profile environment variables locally (see the naming convention
   in `mcp-servers/aep-core/src/aep_core/auth/credential_resolver.py`
   `_env_var_for()` and `mcp-servers/site-crawler/src/auth/credential-resolver.ts`
   `envVarFor()`). Put these in a local `.env` file (gitignored) and
   source it, or export them in your shell profile — never commit them.
4. Set `ANTHROPIC_API_KEY` if you want to use the chat panel.
5. Bring the whole stack up:
   ```bash
   docker compose up --build
   ```
   This starts `aep-core` (:8801), `site-crawler` (:8802),
   `industry-news-tracker` (:8803), `orchestrator` (:8800), the web-ui
   backend (:4000), and the web-ui frontend (:3000).
6. Open `http://localhost:3000` for the dashboard.

## Adding a new profile

1. Add an entry to `secrets/profiles.json`:
   ```json
   "new_client_test_user": {
     "vaultRef": "<vault-path>",
     "allowedDomains": ["<domain>"]
   }
   ```
2. Set the per-profile env vars locally (see step 3 above) using the
   `new_client_test_user` name.
3. In production, populate the real secret at the `vaultRef` path in
   Vault/AWS Secrets Manager instead, and set
   `MCP_SECRETS_BACKEND=vault` for the affected server(s) — see
   `docker-compose.prod.yml`.

## Adding a new mcp-server package to the monorepo

1. Create `mcp-servers/<your-server>/` following the shape of an existing
   server (Python: mirror `aep-core`'s `pyproject.toml` + `src/` layout;
   Node: mirror `site-crawler`'s `package.json` + `tsconfig.json` +
   `src/` layout).
2. Write a `mcp.config.json` manifest listing every tool your server
   exposes, with `name`, `description`, `inputSchema`, and (if
   applicable) `outputSchema`. This is validated automatically by
   `shared/validation/src/contract-tests.ts` in CI — no registration
   needed there.
3. If your server touches anything requiring auth, add a
   `credential_resolver`/`credential-resolver` module following the
   pattern in `docs/security-model.md`. If it's public-data-only (like
   `industry-news-tracker`), you can skip this entirely.
4. Add a service block to `docker-compose.yml` (and, if it needs
   different production behavior, `docker-compose.prod.yml`).
5. Add a job to `.github/workflows/ci.yml` to build/test it, and a matrix
   entry to `.github/workflows/build-images.yml` to publish its image.
6. If the orchestrator should be able to call it, add its base URL as an
   env var to `orchestrator`'s compose service and reference it in
   `orchestrator/src/router.ts`'s `SUB_SERVER_URLS`.

## Running tests

```bash
# aep-core
cd mcp-servers/aep-core && pip install -e ".[dev]" && pytest

# site-crawler / orchestrator (Node test runner)
cd mcp-servers/site-crawler && npm install && npm test
cd orchestrator && npm install && npm test

# shared validation harness
cd shared/validation && npm install && npm run ci
```
