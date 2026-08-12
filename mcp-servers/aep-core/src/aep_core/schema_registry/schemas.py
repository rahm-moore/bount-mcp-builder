"""Adobe Schema Registry — full XDM schemas (composed of fragments)."""

from __future__ import annotations

from typing import Any

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager
from ..core.http_client import AEPHttpClient

SCHEMA_REGISTRY_BASE = "/data/foundation/schemaregistry"


class SchemaRegistryClient:
    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._client = AEPHttpClient(creds, token_manager)

    def list_schemas(self, container: str = "tenant") -> list[dict[str, Any]]:
        response = self._client.request("GET", f"{SCHEMA_REGISTRY_BASE}/{container}/schemas")
        response.raise_for_status()
        return response.json().get("results", [])

    def get_schema(self, schema_id: str, container: str = "tenant") -> dict[str, Any]:
        response = self._client.request(
            "GET",
            f"{SCHEMA_REGISTRY_BASE}/{container}/schemas/{schema_id}",
            headers={"Accept": "application/vnd.adobe.xed-full+json; version=1"},
        )
        response.raise_for_status()
        return response.json()

    def create_schema(self, definition: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up POST /tenant/schemas with allOf field group refs and "
            "meta:class (e.g. XDM ExperienceEvent or Profile class)"
        )

    def patch_schema(self, schema_id: str, patch_ops: list[dict[str, Any]]) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up PATCH /tenant/schemas/{schema_id} with a JSON Patch (RFC 6902) body"
        )

    def close(self) -> None:
        self._client.close()
