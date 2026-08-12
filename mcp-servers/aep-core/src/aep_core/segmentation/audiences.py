"""Real-Time CDP Audiences — publishable/composable groupings of segments.

Distinct from raw segment definitions (segments.py): an "audience" here is
the object activated to destinations (e.g. published to Adobe Target or an
ad platform), which may wrap a single segment or a composed rule set.
"""

from __future__ import annotations

from typing import Any

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager
from ..core.http_client import AEPHttpClient

SEGMENTATION_BASE = "/data/core/ups"


class AudienceClient:
    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._client = AEPHttpClient(creds, token_manager)

    def list_audiences(self) -> list[dict[str, Any]]:
        response = self._client.request("GET", f"{SEGMENTATION_BASE}/audiences")
        response.raise_for_status()
        return response.json().get("audiences", [])

    def get_audience(self, audience_id: str) -> dict[str, Any]:
        response = self._client.request("GET", f"{SEGMENTATION_BASE}/audiences/{audience_id}")
        response.raise_for_status()
        return response.json()

    def activate_audience(self, audience_id: str, destination_ids: list[str]) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up the destination activation call (Flow Service dataflow "
            "targeting the destination, scoped to this audience_id as the segment filter)"
        )

    def close(self) -> None:
        self._client.close()
