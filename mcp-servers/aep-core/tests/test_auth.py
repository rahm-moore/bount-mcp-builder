"""Tests for the credential_resolver module.

These tests verify the two properties that matter most for this module:
  1. It never leaks resolved secret values (repr/str is redacted).
  2. Missing profiles / disallowed domains / missing env vars fail loudly
     and safely rather than silently returning partial/garbage credentials.

No real secrets are used anywhere in this file — only synthetic
placeholder values written to a temp profiles.json and temp env vars.
"""

from __future__ import annotations

import json
import os

import pytest

import aep_core.auth.credential_resolver as credential_resolver
from aep_core.auth.credential_resolver import (
    DomainNotAllowedError,
    ProfileNotFoundError,
    SecretBackendError,
    resolve_profile,
)

TEST_PROFILE_NAME = "test_profile"
TEST_DOMAIN = "example.test"


@pytest.fixture()
def profiles_manifest(tmp_path, monkeypatch):
    manifest_path = tmp_path / "profiles.json"
    manifest_path.write_text(
        json.dumps(
            {
                TEST_PROFILE_NAME: {
                    "vaultRef": "<vault-path>",
                    "allowedDomains": [TEST_DOMAIN],
                }
            }
        )
    )
    monkeypatch.setenv("MCP_PROFILES_PATH", str(manifest_path))
    monkeypatch.setenv("MCP_SECRETS_BACKEND", "local")
    return manifest_path


def _set_profile_env(monkeypatch, profile_name: str = TEST_PROFILE_NAME) -> None:
    normalized = profile_name.upper().replace("-", "_")
    for field, value in {
        "base_url": "https://platform.adobe.io",
        "client_id": "<CLIENT_ID>",
        "client_secret": "<CLIENT_SECRET>",
        "api_key": "<API_KEY>",
        "org_id": "<ORG_ID>@AdobeOrg",
        "tech_account_id": "<TECH_ACCOUNT_ID>@techacct.adobe.com",
        "sandbox": "prod",
    }.items():
        monkeypatch.setenv(f"AEP_PROFILE_{normalized}_{field.upper()}", value)


def test_resolve_profile_success(profiles_manifest, monkeypatch):
    _set_profile_env(monkeypatch)
    creds = resolve_profile(TEST_PROFILE_NAME, TEST_DOMAIN)
    assert creds.profile_name == TEST_PROFILE_NAME
    assert creds.sandbox == "prod"
    # Secret values never show up in repr()
    rendered = repr(creds)
    assert "<CLIENT_SECRET>" not in rendered
    assert "redacted" in rendered


def test_unknown_profile_raises(profiles_manifest):
    with pytest.raises(ProfileNotFoundError):
        resolve_profile("does_not_exist", TEST_DOMAIN)


def test_domain_not_allowed_raises(profiles_manifest, monkeypatch):
    _set_profile_env(monkeypatch)
    with pytest.raises(DomainNotAllowedError):
        resolve_profile(TEST_PROFILE_NAME, "not-allowed.test")


def test_missing_env_vars_raise_secret_backend_error(profiles_manifest):
    # Deliberately do NOT set the per-profile env vars.
    with pytest.raises(SecretBackendError):
        resolve_profile(TEST_PROFILE_NAME, TEST_DOMAIN)


def test_missing_manifest_raises_secret_backend_error(tmp_path, monkeypatch):
    monkeypatch.setenv("MCP_PROFILES_PATH", str(tmp_path / "does-not-exist.json"))
    with pytest.raises(SecretBackendError):
        resolve_profile(TEST_PROFILE_NAME, TEST_DOMAIN)


@pytest.fixture()
def doppler_profiles_manifest(tmp_path, monkeypatch):
    manifest_path = tmp_path / "profiles.json"
    manifest_path.write_text(
        json.dumps(
            {
                TEST_PROFILE_NAME: {
                    "dopplerConfig": {"project": "bount-mcp-builder", "config": "dev"},
                    "allowedDomains": [TEST_DOMAIN],
                }
            }
        )
    )
    monkeypatch.setenv("MCP_PROFILES_PATH", str(manifest_path))
    monkeypatch.setenv("MCP_SECRETS_BACKEND", "doppler")
    return manifest_path


def test_doppler_missing_token_raises(doppler_profiles_manifest, monkeypatch):
    monkeypatch.delenv("DOPPLER_TOKEN", raising=False)
    with pytest.raises(SecretBackendError):
        resolve_profile(TEST_PROFILE_NAME, TEST_DOMAIN)


def test_doppler_missing_config_raises(profiles_manifest, monkeypatch):
    # `profiles_manifest` fixture has no dopplerConfig at all.
    monkeypatch.setenv("MCP_SECRETS_BACKEND", "doppler")
    monkeypatch.setenv("DOPPLER_TOKEN", "<DOPPLER_TOKEN>")
    with pytest.raises(SecretBackendError):
        resolve_profile(TEST_PROFILE_NAME, TEST_DOMAIN)


def test_doppler_success_never_hits_real_network(doppler_profiles_manifest, monkeypatch):
    monkeypatch.setenv("DOPPLER_TOKEN", "<DOPPLER_TOKEN>")

    calls: list[tuple[str, str, str]] = []

    def fake_fetch(project: str, config: str, token: str) -> dict[str, str]:
        calls.append((project, config, token))
        return {
            "AEP_PROFILE_TEST_PROFILE_BASE_URL": "https://platform.adobe.io",
            "AEP_PROFILE_TEST_PROFILE_CLIENT_ID": "<CLIENT_ID>",
            "AEP_PROFILE_TEST_PROFILE_CLIENT_SECRET": "<CLIENT_SECRET>",
            "AEP_PROFILE_TEST_PROFILE_API_KEY": "<API_KEY>",
            "AEP_PROFILE_TEST_PROFILE_ORG_ID": "<ORG_ID>@AdobeOrg",
            "AEP_PROFILE_TEST_PROFILE_TECH_ACCOUNT_ID": "<TECH_ACCOUNT_ID>@techacct.adobe.com",
            "AEP_PROFILE_TEST_PROFILE_SANDBOX": "prod",
        }

    monkeypatch.setattr(credential_resolver, "_fetch_doppler_secrets", fake_fetch)

    creds = resolve_profile(TEST_PROFILE_NAME, TEST_DOMAIN)
    assert creds.profile_name == TEST_PROFILE_NAME
    assert creds.sandbox == "prod"
    assert "<CLIENT_SECRET>" not in repr(creds)
    assert calls == [("bount-mcp-builder", "dev", "<DOPPLER_TOKEN>")]


def test_doppler_missing_secret_raises(doppler_profiles_manifest, monkeypatch):
    monkeypatch.setenv("DOPPLER_TOKEN", "<DOPPLER_TOKEN>")
    monkeypatch.setattr(credential_resolver, "_fetch_doppler_secrets", lambda *a, **k: {})
    with pytest.raises(SecretBackendError):
        resolve_profile(TEST_PROFILE_NAME, TEST_DOMAIN)
