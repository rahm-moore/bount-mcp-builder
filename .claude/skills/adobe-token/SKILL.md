---
name: adobe-token
description: Check and renew the Adobe IMS access token before any Adobe API call (Tags/Reactor, AEP, CJA) and make it available to the command that needs it. Use at the start of any session that calls Adobe APIs, whenever a call returns 401 or oauth-token-invalid, or when the user says a secret was rotated and asks to avoid starting a new session.
---

# adobe-token

A session's environment variables are fixed when the session starts. A rotated client secret or an expired `ADOBE_ACCESS_TOKEN` cannot be swapped into a running session, and a shell variable does not survive from one Bash call to the next. This skill avoids both problems: it reads credentials from their source at call time, mints or reuses a token, caches it outside the repo, and passes it to the command that needs it.

## Use

Run the script from the repo root. It needs only Python 3 (standard library).

```bash
S=.claude/skills/adobe-token/scripts/adobe_token.py

python3 $S status                 # what is valid and which sources are complete; no secrets printed
python3 $S ensure --probe         # reuse a valid token or refresh; --probe confirms it with a live read-only GET
python3 $S refresh                # force a new token
python3 $S run -- <command> ...   # preferred: ensure, then run the command with the ADOBE_* variables set
eval "$(python3 $S env)"          # sets the variables for the REST OF THIS ONE Bash call only
```

Rules for Claude:
1. Before the first Adobe API call in a session, and again after any 401 or `oauth-token-invalid`, run `ensure --probe`. Do not mint tokens by hand with curl.
2. Run Adobe calls through `run --` (or `eval "$(... env)"` in the same Bash call). Never rely on a variable set in an earlier call.
3. Never print, log or paste a token, client secret or Doppler token. Do not run `env` without wrapping it in `eval`.
4. If every source fails, stop and report the message the script printed. Do not guess scopes, retry in a loop, or work around it.
5. Tags API calls stay GET-only unless the user says otherwise.

## Where credentials come from (first complete source that mints a token wins)

1. **Doppler** (recommended; picks up rotations with no session restart). Needs `DOPPLER_TOKEN`, `ADOBE_DOPPLER_PROJECT` and `ADOBE_DOPPLER_CONFIG` in the session. The config holds `ADOBE_CLIENT_ID`, `ADOBE_CLIENT_SECRET`, `ADOBE_ORG_ID`, `ADOBE_SCOPES`. With `--profile NAME` it reads the repo's `AEP_PROFILE_<NAME>_<FIELD>` names first (see `secrets/README.md`).
2. **Environment** variables `ADOBE_CLIENT_ID`, `ADOBE_CLIENT_SECRET`, `ADOBE_ORG_ID`, `ADOBE_SCOPES`.
3. **Credentials file** at `$ADOBE_CREDS_FILE` (KEY=VALUE lines, mode 0600, outside the repo).

If a source returns `invalid_client` (a rotated or wrong secret), the script moves on to the next source. This is what makes a stale environment secret recoverable when Doppler holds the current one.

The cache is `~/.cache/bount-adobe/token.json` (directory 0700, file 0600), keyed to the client ID so a different client never reuses it. It is never inside the repo. A token is refreshed when fewer than 5 minutes remain.

## What this cannot do

- It cannot change the session's own secret variables. If the only current secret lives somewhere outside Doppler and the credentials file, update it there; a session started before the change still sees the old value.
- It cannot fix a secret Adobe rejects at the source. Rotate it in the Adobe Developer Console, then update Doppler.
- `ADOBE_SCOPES` must match the project's configured scopes. If it is unset the script uses Adobe's standard default set and says so; confirm that against the project before relying on it.

## One-time setup to stop restarting sessions

1. Put the four Adobe values in a Doppler config (for example project `bount-mcp-builder`, config `cit_adobe_tags`).
2. Create a read-only Doppler service token for that config.
3. Add `DOPPLER_TOKEN`, `ADOBE_DOPPLER_PROJECT` and `ADOBE_DOPPLER_CONFIG` to the environment's secrets once. They do not change when Adobe credentials rotate, so rotation only means updating Doppler.

## Tests

`python3 -m unittest discover -s .claude/skills/adobe-token/tests -v`
