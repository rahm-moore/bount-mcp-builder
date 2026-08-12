"""Schema Registry field group / data type "fragments" client.

The legacy kit's `modules/fragments.py` stub existed to manage reusable XDM
building blocks (field groups and data types, collectively "fragments" in
Adobe's Schema Registry vocabulary) separately from full schemas — this
client preserves that separation of concerns from schema_registry/schemas.py.
"""

from __future__ import annotations

from typing import Any, Literal

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager
from .http_client import AEPHttpClient

SCHEMA_REGISTRY_BASE = "/data/foundation/schemaregistry"

FragmentType = Literal["fieldgroups", "datatypes"]


class FragmentClient:
    """Wraps Schema Registry field group + data type ("fragment") endpoints."""

    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._client = AEPHttpClient(creds, token_manager)

    def list_fragments(self, fragment_type: FragmentType, container: str = "tenant") -> list[dict[str, Any]]:
        response = self._client.request(
            "GET", f"{SCHEMA_REGISTRY_BASE}/{container}/{fragment_type}"
        )
        response.raise_for_status()
        return response.json().get("results", [])

    def get_fragment(self, fragment_type: FragmentType, fragment_id: str, container: str = "tenant") -> dict[str, Any]:
        response = self._client.request(
            "GET", f"{SCHEMA_REGISTRY_BASE}/{container}/{fragment_type}/{fragment_id}"
        )
        response.raise_for_status()
        return response.json()

    def create_fragment(self, fragment_type: FragmentType, definition: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up POST to the Schema Registry field group / data type "
            "endpoint with the XDM fragment definition payload"
        )

    def close(self) -> None:
        self._client.close()
