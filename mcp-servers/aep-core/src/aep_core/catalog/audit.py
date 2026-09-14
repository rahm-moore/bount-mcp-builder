"""Dataset size/row-count audit — pure transforms over Catalog Service payloads.

Split out from `datasets.py` (which only talks to the API) so the actual
metric-extraction logic is unit-testable without mocking HTTP. Originated
from a one-off audit script written against a live CIT Bank tenant
(cit-bank-websdk repo, docs/aep-dataset-audit/) to explain a Prod
row-count/storage overage; promoted here so the same process is available
as a reusable MCP tool instead of a bespoke script next time.
"""

from __future__ import annotations

from typing import Any


def dataset_metrics(dataset: dict[str, Any]) -> dict[str, Any]:
    """Extract row count / storage size from a single Catalog dataset object.

    AEP's lakehouse metrics live at
    `extensions.adobe_lakeHouse.metrics.{storageSize,rowCount,asOf}` — this
    is the authoritative, no-extra-API-call source for both; there is no
    need for a separate Query Service `SELECT COUNT(*)` or a Data Access
    batch/file-size sum, confirmed against a live tenant.
    """
    metrics = dataset.get("extensions", {}).get("adobe_lakeHouse", {}).get("metrics", {})
    size_bytes = metrics.get("storageSize", 0) or 0
    return {
        "dataset_name": dataset.get("name", ""),
        "dataset_id": dataset.get("id", ""),
        "row_count": metrics.get("rowCount", 0) or 0,
        "size_bytes": size_bytes,
        "size_gb": round(size_bytes / (1024**3), 4),
        "profile_enabled": is_profile_enabled(dataset),
        "last_batch_date": metrics.get("asOf"),
    }


def is_profile_enabled(dataset: dict[str, Any]) -> bool:
    """A dataset is Profile-enabled iff tags.unifiedProfile contains "enabled:true".

    Confirmed empirically — there is no separate top-level `unifiedProfile`
    boolean field on the dataset object; it's encoded as one of several
    colon-separated strings under the `unifiedProfile` tag family.
    """
    tags = dataset.get("tags", {})
    return any(v.startswith("enabled:true") for v in tags.get("unifiedProfile", []))


def audit_datasets(
    datasets_by_sandbox: dict[str, dict[str, Any]],
    dataset_to_labels: dict[str, list[str]] | None = None,
) -> list[dict[str, Any]]:
    """Build the full audit row list across one or more sandboxes.

    Args:
        datasets_by_sandbox: {sandbox_name: {dataset_id: dataset_object}},
            e.g. the output of calling `CatalogClient.list_all_datasets()`
            once per profile/sandbox and keying the results by sandbox name.
        dataset_to_labels: optional {dataset_id: [label, ...]} to attach —
            e.g. matched CJA data view names from
            `cja.dataviews.map_dataviews_to_datasets` inverted by dataset id.

    Returns:
        Rows sorted by size_gb descending, each with an added `sandbox` and
        `matched_labels` field.
    """
    dataset_to_labels = dataset_to_labels or {}
    rows: list[dict[str, Any]] = []
    for sandbox, datasets in datasets_by_sandbox.items():
        for dataset in datasets.values():
            row = dataset_metrics(dataset)
            row["sandbox"] = sandbox
            row["matched_labels"] = dataset_to_labels.get(row["dataset_id"], [])
            rows.append(row)
    rows.sort(key=lambda r: r["size_gb"], reverse=True)
    return rows
