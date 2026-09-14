"""Adobe Catalog Service — datasets."""

from __future__ import annotations

from typing import Any

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager
from ..core.http_client import AEPHttpClient

CATALOG_BASE = "/data/foundation/catalog"

# Catalog Service rejects any limit outside this range with a 400
# ("Please supply a valid query limit: (1 - 100)") — confirmed empirically
# against a live tenant (2026-09-14), not just read off docs.
_MAX_PAGE_SIZE = 100


class CatalogClient:
    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._client = AEPHttpClient(creds, token_manager)

    def list_datasets(self) -> dict[str, Any]:
        """List datasets visible in this profile's sandbox (single page, <=100).

        For a full tenant inventory across many hundreds of datasets, use
        `list_all_datasets` instead, which paginates.
        """
        response = self._client.request("GET", f"{CATALOG_BASE}/dataSets", params={"limit": _MAX_PAGE_SIZE})
        response.raise_for_status()
        return response.json()

    def list_all_datasets(self) -> dict[str, Any]:
        """List every dataset in this profile's sandbox, paginating past the 100-per-page cap.

        Returns the same `{dataset_id: dataset_object}` shape as
        `list_datasets`/the raw Catalog response, merged across pages.
        """
        all_datasets: dict[str, Any] = {}
        start = 0
        while True:
            response = self._client.request(
                "GET",
                f"{CATALOG_BASE}/dataSets",
                params={"limit": _MAX_PAGE_SIZE, "start": start},
            )
            response.raise_for_status()
            page = response.json()
            if not page:
                break
            all_datasets.update(page)
            if len(page) < _MAX_PAGE_SIZE:
                break
            start += _MAX_PAGE_SIZE
        return all_datasets

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
