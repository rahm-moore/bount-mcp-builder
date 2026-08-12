"""Shared AEP HTTP request helper.

Not part of the original spec tree, but small enough (and used identically
by every domain module below) that duplicating it six times seemed worse
than one shared helper. Builds the standard AEP request headers
(Authorization, x-api-key, x-gw-ims-org-id, x-sandbox-name) from a resolved
profile + cached IMS token, mirroring the header shape used by the legacy
kit's `check_token_validity()` (see cli/credentials_cli.py in the source
kit) but sourced from environment-backed profiles instead of a JSON file
on disk.
"""

from __future__ import annotations

import httpx

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager


def build_headers(creds: ResolvedCredentials, token_manager: IMSTokenManager) -> dict[str, str]:
    access_token = token_manager.get_access_token(creds)
    return {
        "Authorization": f"Bearer {access_token}",
        "x-api-key": creds.api_key,
        "x-gw-ims-org-id": creds.org_id,
        "x-sandbox-name": creds.sandbox,
        "Content-Type": "application/json",
    }


class AEPHttpClient:
    """Thin wrapper around httpx bound to a single resolved profile."""

    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._creds = creds
        self._token_manager = token_manager
        self._http = httpx.Client(base_url=creds.base_url, timeout=30.0)

    def request(self, method: str, path: str, **kwargs) -> httpx.Response:
        headers = build_headers(self._creds, self._token_manager)
        headers.update(kwargs.pop("headers", {}) or {})
        return self._http.request(method, path, headers=headers, **kwargs)

    def close(self) -> None:
        self._http.close()
