#!/usr/bin/env python3
"""Keep a valid Adobe IMS Server-to-Server access token available to a session.

Why this exists: a cloud/CLI session's environment variables are fixed when the
session starts, so a rotated secret or an expired ADOBE_ACCESS_TOKEN cannot be
hot-swapped into it. This script sidesteps that. It resolves credentials at
call time (Doppler first, so rotations are picked up), mints or reuses a token,
caches it outside the repo, and hands it to the command that needs it.

Standard library only. Never prints secrets. Only `env` prints the token, and it
is meant to be consumed by `eval`, not read.

Commands:
  status            Report token validity and credential source (no secrets).
  ensure            Make sure a valid token is cached; refresh if needed.
  refresh           Force a new token.
  run -- CMD ...    ensure, then exec CMD with ADOBE_* variables set.
  env               Print `export` lines for eval in the SAME shell call.

Options: --probe (live GET to Tags API to confirm the token), --profile NAME.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3"
PROBE_URL = "https://reactor.adobe.io/companies?page[size]=1"
DOPPLER_URL = "https://api.doppler.com/v3/configs/config/secrets/download"
DEFAULT_SCOPES = "openid,AdobeID,read_organizations,additional_info.projectedProductContext"
SAFETY_MARGIN = 300  # refresh when fewer than this many seconds remain
CACHE_DIR = Path(os.environ.get("ADOBE_TOKEN_CACHE_DIR", Path.home() / ".cache" / "bount-adobe"))
CACHE_FILE = CACHE_DIR / "token.json"
FIELDS = ("client_id", "client_secret", "org_id", "scopes")


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


# ---------- credential sources (never print values) ----------
def _keys(profile: str | None, field: str) -> list[str]:
    names = [f"ADOBE_{field.upper()}"]
    if profile:
        names.insert(0, f"AEP_PROFILE_{profile.upper().replace('-', '_')}_{field.upper()}")
    return names


def _pick(mapping: dict, profile: str | None, field: str) -> str:
    for name in _keys(profile, field):
        if mapping.get(name):
            return str(mapping[name]).strip()
    return ""


def from_doppler(profile: str | None) -> dict | None:
    token = os.environ.get("DOPPLER_TOKEN")
    project = os.environ.get("ADOBE_DOPPLER_PROJECT")
    config = os.environ.get("ADOBE_DOPPLER_CONFIG")
    if not (token and project and config):
        return None
    url = DOPPLER_URL + "?" + urllib.parse.urlencode({"project": project, "config": config, "format": "json"})
    req = urllib.request.Request(url)
    basic = base64.b64encode(f"{token}:".encode()).decode()
    req.add_header("Authorization", f"Basic {basic}")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.load(r)
    except (urllib.error.URLError, ValueError) as exc:
        log(f"doppler: unavailable ({type(exc).__name__}); trying next source")
        return None
    return {f: _pick(data, profile, f) for f in FIELDS}


def from_env(profile: str | None) -> dict | None:
    return {f: _pick(os.environ, profile, f) for f in FIELDS}


def from_file(profile: str | None) -> dict | None:
    path = os.environ.get("ADOBE_CREDS_FILE")
    if not path or not Path(path).is_file():
        return None
    data = {}
    for line in Path(path).read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            data[k.strip()] = v.strip().strip("'\"")
    return {f: _pick(data, profile, f) for f in FIELDS}


SOURCES = (("doppler", from_doppler), ("environment", from_env), ("creds-file", from_file))


# ---------- token cache ----------
def _fp(client_id: str) -> str:
    return hashlib.sha256(client_id.encode()).hexdigest()[:12]


def load_cache() -> dict | None:
    try:
        return json.loads(CACHE_FILE.read_text())
    except (OSError, ValueError):
        return None


def save_cache(token: str, expires_at: float, client_id: str, source: str) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(CACHE_DIR, stat.S_IRWXU)
    tmp = CACHE_FILE.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump({"access_token": token, "expires_at": expires_at, "client": _fp(client_id), "source": source}, fh)
    os.replace(tmp, CACHE_FILE)


def jwt_expiry(token: str) -> float | None:
    """Expiry (epoch s) from a JWT: `exp`, or Adobe's created_at + expires_in (ms)."""
    try:
        seg = token.split(".")[1]
        p = json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4)))
    except Exception:
        return None
    if "exp" in p:
        return float(p["exp"])
    if "created_at" in p and "expires_in" in p:
        return (int(p["created_at"]) + int(p["expires_in"])) / 1000.0
    return None


def jwt_client_id(token: str) -> str:
    try:
        seg = token.split(".")[1]
        return str(json.loads(base64.urlsafe_b64decode(seg + "=" * (-len(seg) % 4))).get("client_id", ""))
    except Exception:
        return ""


def identity(profile: str | None) -> tuple[str, str]:
    """(client_id, org_id) the session should be using: first source that names both."""
    for _, getter in SOURCES:
        c = getter(profile)
        if c and c["client_id"] and c["org_id"]:
            return c["client_id"], c["org_id"]
    return "", ""


def fresh(expires_at: float | None) -> bool:
    return bool(expires_at) and time.time() < expires_at - SAFETY_MARGIN


def probe(token: str, client_id: str, org_id: str) -> int:
    req = urllib.request.Request(PROBE_URL.replace("[", "%5B").replace("]", "%5D"))
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("x-api-key", client_id)
    req.add_header("x-gw-ims-org-id", org_id)
    req.add_header("Accept", "application/vnd.api+json;revision=1")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status
    except urllib.error.HTTPError as exc:
        return exc.code
    except urllib.error.URLError:
        return 0


def mint(creds: dict) -> tuple[str, float]:
    body = urllib.parse.urlencode({
        "client_id": creds["client_id"], "client_secret": creds["client_secret"],
        "grant_type": "client_credentials", "scope": creds["scopes"] or DEFAULT_SCOPES,
    }).encode()
    req = urllib.request.Request(IMS_TOKEN_URL, data=body)
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=30) as r:
        payload = json.load(r)
    expires_in = int(payload.get("expires_in", 3600))
    if expires_in > 10**6:  # some IMS responses report milliseconds
        expires_in //= 1000
    return payload["access_token"], time.time() + expires_in


def resolve_and_mint(profile: str | None) -> tuple[str, float, dict, str]:
    errors = []
    for name, getter in SOURCES:
        creds = getter(profile)
        if not creds or not (creds["client_id"] and creds["client_secret"] and creds["org_id"]):
            continue
        try:
            token, exp = mint(creds)
            if not creds["scopes"]:
                log(f"note: no scopes set in {name}; used Adobe's standard default scope set")
            return token, exp, creds, name
        except urllib.error.HTTPError as exc:
            try:
                err = json.load(exc).get("error", "")
            except Exception:
                err = ""
            errors.append(f"{name}: HTTP {exc.code} {err}".strip())
        except urllib.error.URLError as exc:
            errors.append(f"{name}: network error ({type(exc).__name__})")
    detail = "; ".join(errors) or "no credential source had client id, secret and org id"
    log(f"FAILED to mint a token: {detail}")
    log("Fix the secret at its source (Doppler, or the environment's secrets), then re-run. "
        "A secret rejected as invalid_client has usually been rotated.")
    sys.exit(2)


def ensure(profile: str | None, force: bool = False, do_probe: bool = False) -> tuple[str, dict]:
    """Return (token, info). Reuse a valid cached or ambient token for the right client; otherwise mint."""
    cid, org = identity(profile)

    def result(token, state, source, exp, client, org_id):
        return token, {"state": state, "source": source, "expires_at": exp, "client_id": client, "org_id": org_id}

    if not force:
        cache = load_cache()
        if cache and fresh(cache.get("expires_at")) and (not cid or cache.get("client") == _fp(cid)):
            token = cache["access_token"]
            if not do_probe or probe(token, cid, org) == 200:
                return result(token, "valid (cached)", cache.get("source"), cache["expires_at"], cid, org)
        amb = os.environ.get("ADOBE_ACCESS_TOKEN", "")
        if amb and fresh(jwt_expiry(amb)):
            amb_client = jwt_client_id(amb)
            acid = cid or _pick(os.environ, profile, "client_id")
            aorg = org or _pick(os.environ, profile, "org_id")
            if (not cid or not amb_client or amb_client == cid) and (not do_probe or probe(amb, acid, aorg) == 200):
                return result(amb, "valid (session variable)", "environment", jwt_expiry(amb), acid, aorg)
    token, exp, creds, source = resolve_and_mint(profile)
    if do_probe:
        status = probe(token, creds["client_id"], creds["org_id"])
        if status != 200:
            log(f"FAILED: a new token was minted from {source} but the read-only Tags probe returned HTTP {status}. "
                "Check that the scopes and product profile include the Tags API.")
            sys.exit(3)
    save_cache(token, exp, creds["client_id"], source)
    return result(token, "refreshed", source, exp, creds["client_id"], creds["org_id"])


def describe(info: dict) -> str:
    left = int(info["expires_at"] - time.time()) if info.get("expires_at") else 0
    return f"token {info['state']}; credential source: {info['source']}; expires in {left // 60} min"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["status", "ensure", "refresh", "run", "env"])
    ap.add_argument("--profile")
    ap.add_argument("--probe", action="store_true", help="confirm the token with a live read-only GET")
    # Everything after the first "--" is the child command for `run`; options before it are parsed normally.
    child: list[str] = []
    if "--" in argv:
        i = argv.index("--")
        argv, child = argv[:i], argv[i + 1:]
    a = ap.parse_args(argv)

    if a.command == "status":
        cache = load_cache()
        amb = os.environ.get("ADOBE_ACCESS_TOKEN", "")
        print(f"cached token: {'valid' if cache and fresh(cache.get('expires_at')) else 'missing or expiring'}")
        print(f"session variable token: {'valid' if amb and fresh(jwt_expiry(amb)) else 'missing or expired'}")
        for name, getter in SOURCES:
            c = getter(a.profile)
            ok = bool(c and c["client_id"] and c["client_secret"] and c["org_id"])
            print(f"credential source {name}: {'complete' if ok else 'not available'}")
        return 0

    token, info = ensure(a.profile, force=a.command == "refresh", do_probe=a.probe)
    cid, org = info["client_id"], info["org_id"]
    if a.command in ("ensure", "refresh"):
        log(describe(info))
        return 0
    if a.command == "env":
        for k, v in (("ADOBE_ACCESS_TOKEN", token), ("ADOBE_CLIENT_ID", cid), ("ADOBE_ORG_ID", org)):
            print(f"export {k}='{v}'")
        return 0
    cmd = child
    if not cmd:
        log("run needs a command after --")
        return 64
    log(describe(info))
    env = dict(os.environ, ADOBE_ACCESS_TOKEN=token, ADOBE_CLIENT_ID=cid, ADOBE_ORG_ID=org)
    return subprocess.call(cmd, env=env)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
