"""Adobe Identity Service — identity graph lookups.

Given a known identity (e.g. an ECID captured by alloy.js, or a CRM ID
namespace), fetch the linked identity graph / clusters. Primarily useful
for tag-side troubleshooting: confirming identity stitching is behaving as
expected after a Web SDK implementation change.
"""

from __future__ import annotations

from typing import Any

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager
from ..core.http_client import AEPHttpClient

IDENTITY_BASE = "/data/core/identity"


class IdentityGraphClient:
    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._client = AEPHttpClient(creds, token_manager)

    def get_identity_clusters(self, namespace: str, identity_value: str) -> dict[str, Any]:
        response = self._client.request(
            "GET",
            f"{IDENTITY_BASE}/identity/cluster/members",
            params={"namespace": namespace, "id": identity_value},
        )
        response.raise_for_status()
        return response.json()

    def get_namespaces(self) -> list[dict[str, Any]]:
        response = self._client.request("GET", f"{IDENTITY_BASE}/idnamespace/identity-namespaces")
        response.raise_for_status()
        return response.json()

    def delete_identity(self, namespace: str, identity_value: str) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up DELETE for a namespace/id pair — this is a destructive, "
            "sandbox-scoped operation and should require an explicit confirmation flag"
        )

    def close(self) -> None:
        self._client.close()
