"""Adobe Experience Platform Sandboxes.

Sandboxes are the isolation boundary every other client in this package
operates within (via the `x-sandbox-name` header baked into
core/http_client.py). This module manages the sandboxes themselves —
listing, inspecting, and (carefully) creating/resetting them.
"""

from __future__ import annotations

from typing import Any

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager
from ..core.http_client import AEPHttpClient

SANDBOX_BASE = "/data/foundation/sandbox-management"


class SandboxClient:
    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._client = AEPHttpClient(creds, token_manager)

    def list_sandboxes(self) -> list[dict[str, Any]]:
        response = self._client.request("GET", f"{SANDBOX_BASE}/sandboxes")
        response.raise_for_status()
        return response.json().get("sandboxes", [])

    def get_sandbox(self, sandbox_name: str) -> dict[str, Any]:
        response = self._client.request("GET", f"{SANDBOX_BASE}/sandboxes/{sandbox_name}")
        response.raise_for_status()
        return response.json()

    def create_sandbox(self, name: str, title: str, sandbox_type: str = "development") -> dict[str, Any]:
        raise NotImplementedError(
            "wire up POST /sandboxes with name/title/type — restrict to "
            "'development' type sandboxes by default for safety"
        )

    def reset_sandbox(self, sandbox_name: str) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up the sandbox reset call — destructive; require an explicit "
            "confirm=True argument from the caller before ever issuing this request"
        )

    def close(self) -> None:
        self._client.close()
