"""Customer Journey Analytics — data view -> underlying dataset resolution.

CJA data views are a different namespace from AEP Catalog dataset IDs, and
a CJA API call is *not* just another AEP Catalog/Platform Gateway call: CJA
is served from its own host (`cja.adobe.io`, not `platform.adobe.io`) and
authorizes requests with a discovered `x-proxy-global-company-id` header
instead of the `x-sandbox-name` header the rest of this package uses (CJA
connections aren't scoped to one AEP sandbox the way Catalog datasets are).

This exists because a recurring analyst question — "what does dataset X's
size/row overage actually correspond to in CJA?" — otherwise requires
manually resolving each data view id by hand every time. First done that
way for a CIT Bank dataset audit (see cit-bank-websdk repo,
docs/aep-dataset-audit/); promoted here as a reusable tool.

NOTE ON ENDPOINT SHAPES: the discovery/data-view/connection endpoint paths
below reflect Adobe's documented CJA API. Reconfirm current path/param
names against Adobe's CJA API reference before relying on this in a new
environment — Adobe has changed exact query param names between API
versions before (see the note in the sibling `catalog/datasets.py` re:
Catalog Service's `limit` bounds, found the same way).
"""

from __future__ import annotations

from typing import Any

import httpx

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager

CJA_BASE_URL = "https://cja.adobe.io"


class CJAClient:
    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._creds = creds
        self._token_manager = token_manager
        self._http = httpx.Client(base_url=CJA_BASE_URL, timeout=30.0)
        self._global_company_id: str | None = None

    def _headers(self) -> dict[str, str]:
        access_token = self._token_manager.get_access_token(self._creds)
        headers = {
            "Authorization": f"Bearer {access_token}",
            "x-api-key": self._creds.api_key,
            "x-gw-ims-org-id": self._creds.org_id,
            "Content-Type": "application/json",
        }
        if self._global_company_id:
            headers["x-proxy-global-company-id"] = self._global_company_id
        return headers

    def get_global_company_id(self) -> str:
        """Resolve and cache this org's CJA global company id via discovery.

        Required on every subsequent CJA call as `x-proxy-global-company-id`
        — CJA has its own per-org "company" concept distinct from the AEP
        `x-gw-ims-org-id`/sandbox model used elsewhere in this package.
        """
        if self._global_company_id:
            return self._global_company_id
        response = self._http.request("GET", "/discovery/me", headers=self._headers())
        response.raise_for_status()
        payload = response.json()
        for ims_org in payload.get("imsOrgs", []):
            for company in ims_org.get("companies", []):
                global_company_id = company.get("globalCompanyId")
                if global_company_id:
                    self._global_company_id = global_company_id
                    return global_company_id
        raise RuntimeError(
            "No globalCompanyId found in CJA /discovery/me response for this "
            "credential — the technical account may not have CJA product access."
        )

    def get_dataview(self, dataview_id: str) -> dict[str, Any]:
        """Get one data view, expanded to include its parent connection's dataset list.

        `dataview_id` may be passed with or without the `dv_` prefix seen in
        the CJA UI/reports — both are accepted by the API; this method
        passes it through unchanged.
        """
        self.get_global_company_id()
        response = self._http.request(
            "GET",
            f"/data-views/{dataview_id}",
            headers=self._headers(),
            params={"expansion": "connections"},
        )
        response.raise_for_status()
        return response.json()

    def resolve_dataview_datasets(self, dataview_id: str) -> list[dict[str, Any]]:
        """Return the list of underlying dataset objects for one data view.

        Each item includes at least `dataSetId` and `name`; a data view can
        span multiple datasets (event/profile/lookup roles), so this always
        returns a list, even when it has exactly one entry.
        """
        dataview = self.get_dataview(dataview_id)
        connection = dataview.get("parentConnection", {})
        return connection.get("dataSets", [])

    def map_dataviews_to_datasets(self, dataview_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Resolve several data views at once.

        Returns {dataview_id: {"name": ..., "parent_connection_id": ...,
        "parent_connection_name": ..., "dataset_ids": [...]}}, the same
        shape as cit-bank-websdk's tools/cja_dataview_dataset_map.json, so
        that file (or this call's output) can be treated interchangeably by
        downstream tooling.
        """
        result: dict[str, dict[str, Any]] = {}
        for dataview_id in dataview_ids:
            dataview = self.get_dataview(dataview_id)
            connection = dataview.get("parentConnection", {})
            result[dataview_id] = {
                "name": dataview.get("name", ""),
                "parent_connection_id": dataview.get("parentConnectionId", ""),
                "parent_connection_name": connection.get("name", ""),
                "dataset_ids": [ds["dataSetId"] for ds in connection.get("dataSets", []) if ds.get("dataSetId")],
            }
        return result

    def close(self) -> None:
        self._http.close()
