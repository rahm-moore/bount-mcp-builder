"""Adobe Catalog Service — datasets."""

from __future__ import annotations

from typing import Any

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager
from ..core.http_client import AEPHttpClient

CATALOG_BASE = "/data/foundation/catalog"


class CatalogClient:
    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._client = AEPHttpClient(creds, token_manager)

    def list_datasets(self) -> dict[str, Any]:
        response = self._client.request("GET", f"{CATALOG_BASE}/dataSets")
        response.raise_for_status()
        return response.json()

    def get_dataset(self, dataset_id: str) -> dict[str, Any]:
        response = self._client.request("GET", f"{CATALOG_BASE}/dataSets/{dataset_id}")
        response.raise_for_status()
        return response.json()

    def get_dataset_files(self, dataset_id: str) -> list[dict[str, Any]]:
        raise NotImplementedError(
            "wire up GET /dataSetFiles?dataSetId={dataset_id} to list backing files "
            "(useful for confirming a batch actually landed after a dataflow run)"
        )

    def create_dataset(self, definition: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up POST /dataSets with schemaRef pointing at a Schema Registry $id"
        )

    def close(self) -> None:
        self._client.close()
