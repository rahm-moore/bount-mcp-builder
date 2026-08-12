"""Profile-based credential resolution.

Every MCP tool in this server that touches a real AEP tenant accepts a
`profile` *name* (e.g. "cit_bank_test_user"), never a raw secret. This
module is the only place allowed to turn that name into an actual
credential set, and it does so at call time, inside this process — the
resolved credentials are handed to internal HTTP client code and are never
returned as part of an MCP tool's response payload, logged, or echoed back
to the calling model.

Backend selection is controlled by the `MCP_SECRETS_BACKEND` env var:

  - "local" (default): read `secrets/profiles.json` (gitignored) for the
    profile's metadata (vault ref placeholder + allowedDomains), then pull
    the actual secret values from per-profile environment variables. This
    is the local-dev path only.
  - "vault": production path. Placeholder — wire this up to HashiCorp
    Vault / AWS Secrets Manager. The profile's `vaultRef` from
    profiles.json tells us where to look; nothing here should ever read a
    plaintext secret from a checked-in file in that mode.

See docs/security-model.md for the full policy this module implements.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ProfileNotFoundError(Exception):
    """Raised when a requested profile does not exist in the manifest."""


class DomainNotAllowedError(Exception):
    """Raised when a profile is used against a domain outside its allowlist."""


class SecretBackendError(Exception):
    """Raised when the configured secrets backend cannot resolve a value."""


@dataclass(frozen=True)
class ResolvedCredentials:
    """Fully resolved AEP credential set for a single profile.

    Field names mirror the shape used by AEP's IMS Server-to-Server OAuth
    and the standard AEP API request headers (x-api-key, x-gw-ims-org-id,
    x-sandbox-name, Authorization: Bearer <access_token>).

    NEVER serialize this object into a tool response, log line, or
    exception message. It should only ever be consumed by internal HTTP
    client code in this process.
    """

    profile_name: str
    base_url: str
    client_id: str
    client_secret: str
    api_key: str
    org_id: str
    tech_account_id: str
    sandbox: str
    scopes: tuple[str, ...]

    def __repr__(self) -> str:  # pragma: no cover - defensive redaction
        return f"ResolvedCredentials(profile_name={self.profile_name!r}, sandbox={self.sandbox!r}, <redacted>)"


def _profiles_manifest_path() -> Path:
    # Repo-root-relative by convention; overridable for tests/containers.
    override = os.environ.get("MCP_PROFILES_PATH")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[6] / "secrets" / "profiles.json"


def _load_profiles_manifest() -> dict[str, Any]:
    path = _profiles_manifest_path()
    if not path.exists():
        raise SecretBackendError(
            f"Profiles manifest not found at {path}. Copy "
            "secrets/profiles.example.json to secrets/profiles.json and fill "
            "it in for local development."
        )
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _env_var_for(profile_name: str, field: str) -> str:
    """Deterministic env var name for a given profile + field, local-dev only.

    e.g. profile "cit_bank_test_user", field "client_secret" ->
    AEP_PROFILE_CIT_BANK_TEST_USER_CLIENT_SECRET
    """
    normalized = profile_name.upper().replace("-", "_")
    return f"AEP_PROFILE_{normalized}_{field.upper()}"


def _resolve_local(profile_name: str, profile_meta: dict[str, Any]) -> ResolvedCredentials:
    required_fields = [
        "base_url",
        "client_id",
        "client_secret",
        "api_key",
        "org_id",
        "tech_account_id",
        "sandbox",
    ]
    values: dict[str, str] = {}
    missing: list[str] = []
    for field in required_fields:
        env_name = _env_var_for(profile_name, field)
        value = os.environ.get(env_name)
        if not value:
            missing.append(env_name)
            continue
        values[field] = value

    if missing:
        raise SecretBackendError(
            f"Missing local secret env vars for profile '{profile_name}': "
            f"{', '.join(missing)}. Set them or switch MCP_SECRETS_BACKEND=vault."
        )

    scopes_raw = os.environ.get(_env_var_for(profile_name, "scopes"), "")
    scopes = tuple(s.strip() for s in scopes_raw.split(",") if s.strip())

    return ResolvedCredentials(
        profile_name=profile_name,
        base_url=values["base_url"],
        client_id=values["client_id"],
        client_secret=values["client_secret"],
        api_key=values["api_key"],
        org_id=values["org_id"],
        tech_account_id=values["tech_account_id"],
        sandbox=values["sandbox"],
        scopes=scopes,
    )


def _resolve_vault(profile_name: str, profile_meta: dict[str, Any]) -> ResolvedCredentials:
    vault_ref = profile_meta.get("vaultRef")
    if not vault_ref:
        raise SecretBackendError(f"Profile '{profile_name}' has no vaultRef configured.")
    raise NotImplementedError(
        f"wire up Vault/AWS Secrets Manager lookup for vaultRef={vault_ref!r} here "
        "(e.g. hvac.Client().secrets.kv.v2.read_secret_version, or boto3 secretsmanager "
        "get_secret_value) and map the returned fields onto ResolvedCredentials"
    )


def resolve_profile(profile_name: str, domain: str) -> ResolvedCredentials:
    """Resolve a profile name + target domain into usable AEP credentials.

    Args:
        profile_name: Logical profile identifier, e.g. "cit_bank_test_user".
            Tool callers pass this string; they never pass secret material.
        domain: The domain/tenant context the credential will be used
            against (e.g. "citbank.com"). Validated against the profile's
            `allowedDomains` so a credential can't be replayed against an
            unintended target.

    Returns:
        A ResolvedCredentials instance for internal use only.

    Raises:
        ProfileNotFoundError: profile_name is not in the manifest.
        DomainNotAllowedError: domain is not in the profile's allowlist.
        SecretBackendError: the configured backend could not resolve values.
    """
    manifest = _load_profiles_manifest()
    profile_meta = manifest.get(profile_name)
    if profile_meta is None:
        raise ProfileNotFoundError(f"Unknown profile: {profile_name!r}")

    allowed_domains: list[str] = profile_meta.get("allowedDomains", [])
    if domain not in allowed_domains and "*" not in allowed_domains:
        raise DomainNotAllowedError(
            f"Profile {profile_name!r} is not authorized for domain {domain!r}. "
            f"Allowed: {allowed_domains}"
        )

    backend = os.environ.get("MCP_SECRETS_BACKEND", "local").lower()
    if backend == "local":
        return _resolve_local(profile_name, profile_meta)
    if backend == "vault":
        return _resolve_vault(profile_name, profile_meta)

    raise SecretBackendError(f"Unknown MCP_SECRETS_BACKEND: {backend!r}")
