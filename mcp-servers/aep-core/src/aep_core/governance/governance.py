"""Adobe Experience Platform Data Governance — usage labels and policies.

Ported conceptually from the legacy kit's governance module: read/apply
data usage labels (e.g. C1/C2, sensitive-category labels like SEN) on
fields/datasets, and evaluate marketing actions against configured data
usage policies before an activation goes out. This is high-stakes for a
regulated client like CIT Bank (banking data), so reads are fully wired
and mutating calls are left as explicit NotImplementedError stubs pending
a policy review workflow.
"""

from __future__ import annotations

from typing import Any

from ..auth.credential_resolver import ResolvedCredentials
from ..auth.ims_oauth import IMSTokenManager
from ..core.http_client import AEPHttpClient

POLICY_SERVICE_BASE = "/data/foundation/policy"


class GovernanceClient:
    def __init__(self, creds: ResolvedCredentials, token_manager: IMSTokenManager) -> None:
        self._client = AEPHttpClient(creds, token_manager)

    def list_usage_labels(self, resource_id: str, resource_type: str = "dataSets") -> list[str]:
        response = self._client.request(
            "GET", f"{POLICY_SERVICE_BASE}/resources/{resource_type}/{resource_id}/labels"
        )
        response.raise_for_status()
        return response.json().get("labels", [])

    def list_data_usage_policies(self) -> list[dict[str, Any]]:
        response = self._client.request("GET", f"{POLICY_SERVICE_BASE}/dulepolicies")
        response.raise_for_status()
        return response.json().get("children", [])

    def evaluate_marketing_action(self, marketing_action_id: str, dataset_ids: list[str]) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up POST /marketingActions/{marketing_action_id}/evaluate with "
            "the candidate dataset ids to check for policy violations before activation"
        )

    def apply_usage_label(self, resource_id: str, resource_type: str, label: str) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up PATCH to apply a data usage label (e.g. 'C1', 'SEN') to a "
            "field or dataset — should require explicit human sign-off given the "
            "compliance blast radius for a banking client"
        )

    def close(self) -> None:
        self._client.close()
