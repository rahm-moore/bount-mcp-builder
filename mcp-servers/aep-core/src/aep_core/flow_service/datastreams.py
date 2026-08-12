"""Adobe Flow Service — Datastreams (Web SDK / Edge Network config).

A datastream is the server-side configuration object that alloy.js (Web
SDK) points at via `edgeConfigId`. It fans events out to configured
services (Analytics, AEP Edge/Datasets, Target, Audience Manager, etc).
This is the object CIT Bank's alloy.js `configure()` call references, so
this client is the most directly relevant one for the current engagement's
tag-side troubleshooting.
"""

from __future__ import annotations

from typing import Any

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager
from ..core.http_client import AEPHttpClient

FLOW_SERVICE_BASE = "/data/foundation/flowservice"


class DatastreamClient:
    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._client = AEPHttpClient(creds, token_manager)

    def list_datastreams(self) -> list[dict[str, Any]]:
        response = self._client.request("GET", f"{FLOW_SERVICE_BASE}/configs/datastreams")
        response.raise_for_status()
        return response.json().get("items", [])

    def get_datastream(self, edge_config_id: str) -> dict[str, Any]:
        response = self._client.request(
            "GET", f"{FLOW_SERVICE_BASE}/configs/datastreams/{edge_config_id}"
        )
        response.raise_for_status()
        return response.json()

    def get_datastream_services(self, edge_config_id: str) -> dict[str, Any]:
        """Return the configured service mappings (Analytics/Target/AAM/AEP)
        for a datastream — the piece most useful for alloy.js audit work
        (e.g. confirming the AEP Edge Dataset target matches expectations).
        """
        datastream = self.get_datastream(edge_config_id)
        return datastream.get("configId", {}).get("services", {})

    def create_datastream(self, definition: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up POST /configs/datastreams with the service mapping "
            "payload (analytics reportSuites, aep datasetId, target propertyToken, etc.)"
        )

    def update_datastream(self, edge_config_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up PATCH /configs/datastreams/{edge_config_id} with a JSON patch body"
        )

    def close(self) -> None:
        self._client.close()
