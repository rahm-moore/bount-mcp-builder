"""Real-Time CDP Segmentation Service — segment definitions and jobs.

Ported conceptually from the legacy kit's segment module: manage segment
definitions (PQL-based), trigger/inspect segmentation jobs, and check
estimated/actual segment membership counts.
"""

from __future__ import annotations

from typing import Any

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager
from ..core.http_client import AEPHttpClient

SEGMENTATION_BASE = "/data/core/ups"


class SegmentationClient:
    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._client = AEPHttpClient(creds, token_manager)

    def list_segments(self) -> list[dict[str, Any]]:
        response = self._client.request("GET", f"{SEGMENTATION_BASE}/segment/definitions")
        response.raise_for_status()
        return response.json().get("segments", [])

    def get_segment(self, segment_id: str) -> dict[str, Any]:
        response = self._client.request("GET", f"{SEGMENTATION_BASE}/segment/definitions/{segment_id}")
        response.raise_for_status()
        return response.json()

    def create_segment(self, name: str, pql_expression: str, schema_class: str, description: str = "") -> dict[str, Any]:
        raise NotImplementedError(
            "wire up POST /segment/definitions with name, description, "
            "expression.type='PQL', expression.value=pql_expression, "
            "and schema.name=schema_class"
        )

    def get_segment_job_status(self, job_id: str) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up GET /segment/jobs/{job_id} to check evaluation job status"
        )

    def get_segment_estimate(self, pql_expression: str, schema_class: str) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up POST /segment/estimate for an approximate population count "
            "before committing to a full segment definition"
        )

    def close(self) -> None:
        self._client.close()
