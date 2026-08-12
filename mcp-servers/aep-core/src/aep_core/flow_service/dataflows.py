"""Adobe Flow Service — Dataflows.

Dataflows move data from a connected source into AEP (or out to a
destination) on a schedule/policy. This client covers the general Flow
Service dataflow surface; `datastreams.py` in this same package covers the
Web SDK / Edge Network-specific "datastream" configuration object, which
Flow Service also owns.
"""

from __future__ import annotations

from typing import Any

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager
from ..core.http_client import AEPHttpClient

FLOW_SERVICE_BASE = "/data/foundation/flowservice"


class DataflowClient:
    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._client = AEPHttpClient(creds, token_manager)

    def list_dataflows(self) -> list[dict[str, Any]]:
        response = self._client.request("GET", f"{FLOW_SERVICE_BASE}/flows")
        response.raise_for_status()
        return response.json().get("items", [])

    def get_dataflow(self, flow_id: str) -> dict[str, Any]:
        response = self._client.request("GET", f"{FLOW_SERVICE_BASE}/flows/{flow_id}")
        response.raise_for_status()
        return response.json()

    def get_dataflow_runs(self, flow_id: str) -> list[dict[str, Any]]:
        response = self._client.request("GET", f"{FLOW_SERVICE_BASE}/runs", params={"property": f"flowId=={flow_id}"})
        response.raise_for_status()
        return response.json().get("items", [])

    def create_dataflow(self, definition: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up POST /flows with source/target connection ids, "
            "transformation mapping id, and scheduling params"
        )

    def enable_dataflow(self, flow_id: str, enabled: bool) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up PATCH /flows/{flow_id} to toggle the flow's 'state' field"
        )

    def close(self) -> None:
        self._client.close()
