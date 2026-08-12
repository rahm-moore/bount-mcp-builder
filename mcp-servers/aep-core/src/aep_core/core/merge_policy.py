"""Real-Time CDP Merge Policy client.

Ported conceptually from the legacy kit's merge-policy handling: the kit
used merge policy lookups (`/data/core/ups/config/mergePolicies`) as its
credential health-check endpoint, which tells us merge policies were a
first-class object the kit cared about beyond auth. This module makes that
a proper first-class client instead of an auth-check side effect.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager
from .http_client import AEPHttpClient

UPS_MERGE_POLICIES_PATH = "/data/core/ups/config/mergePolicies"


@dataclass
class MergePolicySummary:
    id: str
    name: str
    schema_class: str
    default: bool


class MergePolicyClient:
    """Wraps Unified Profile Merge Policy configuration endpoints."""

    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._client = AEPHttpClient(creds, token_manager)

    def list_merge_policies(self, sandbox: str | None = None) -> list[dict[str, Any]]:
        """GET all merge policies for the active (or given) sandbox."""
        response = self._client.request("GET", UPS_MERGE_POLICIES_PATH)
        response.raise_for_status()
        return response.json().get("children", [])

    def get_merge_policy(self, policy_id: str) -> dict[str, Any]:
        response = self._client.request("GET", f"{UPS_MERGE_POLICIES_PATH}/{policy_id}")
        response.raise_for_status()
        return response.json()

    def create_merge_policy(self, definition: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up POST /data/core/ups/config/mergePolicies with the merge "
            "policy definition payload (schema.name, identityGraph, attributeMerge)"
        )

    def close(self) -> None:
        self._client.close()
