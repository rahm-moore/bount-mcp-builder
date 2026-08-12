"""Adobe IMS Server-to-Server OAuth token fetch/refresh.

Ported conceptually from the legacy kit's credential-checking flow (which
validated a manually-refreshed long-lived token against
`/data/core/ups/config/mergePolicies`), but rebuilt here around AEP's
Server-to-Server OAuth grant so tokens are fetched/refreshed automatically
instead of via manual paste. All values below are placeholders — nothing in
this file should ever contain a real client id/secret.

Env vars used only when unit-testing this module directly / outside the
credential_resolver flow:
    AEP_CLIENT_ID, AEP_CLIENT_SECRET, AEP_IMS_SCOPES
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from .credential_resolver import ResolvedCredentials

IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3"

# Refresh this many seconds before actual expiry to avoid racing a 401.
EXPIRY_SAFETY_MARGIN_SECONDS = 60


@dataclass
class CachedToken:
    access_token: str
    expires_at: float  # epoch seconds

    def is_expired(self) -> bool:
        return time.time() >= (self.expires_at - EXPIRY_SAFETY_MARGIN_SECONDS)


class IMSTokenManager:
    """Fetches and caches IMS Server-to-Server tokens per profile.

    One instance is expected to live for the lifetime of the MCP server
    process; it caches a token per profile name so repeated tool calls
    don't re-authenticate on every request.
    """

    def __init__(self, http_client: httpx.Client | None = None) -> None:
        self._http = http_client or httpx.Client(timeout=30.0)
        self._cache: dict[str, CachedToken] = {}

    def get_access_token(self, creds: ResolvedCredentials) -> str:
        cached = self._cache.get(creds.profile_name)
        if cached and not cached.is_expired():
            return cached.access_token

        token = self._fetch_token(creds)
        self._cache[creds.profile_name] = token
        return token.access_token

    def _fetch_token(self, creds: ResolvedCredentials) -> CachedToken:
        scope = ",".join(creds.scopes) if creds.scopes else "openid,AdobeID,session"
        response = self._http.post(
            IMS_TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": creds.client_id,
                "client_secret": creds.client_secret,
                "scope": scope,
            },
        )
        response.raise_for_status()
        payload = response.json()

        access_token = payload["access_token"]
        expires_in = payload.get("expires_in", 3600)
        return CachedToken(access_token=access_token, expires_at=time.time() + expires_in)

    def invalidate(self, profile_name: str) -> None:
        self._cache.pop(profile_name, None)

    def close(self) -> None:
        self._http.close()
