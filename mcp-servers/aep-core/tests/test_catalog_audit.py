"""Tests for catalog.audit — pure transforms, no network.

Fixture shapes mirror real Catalog Service dataset objects observed
against a live tenant (lakehouse metrics under
extensions.adobe_lakeHouse.metrics, Profile-enabled encoded as one of
several colon-separated strings under tags.unifiedProfile).
"""

from __future__ import annotations

from aep_core.catalog.audit import audit_datasets, dataset_metrics, is_profile_enabled


def _dataset(
    dataset_id: str,
    name: str,
    size_bytes: int = 0,
    row_count: int = 0,
    profile_enabled: bool = False,
) -> dict:
    tags = {"unifiedProfile": ["enabled:true"]} if profile_enabled else {}
    return {
        "id": dataset_id,
        "name": name,
        "tags": tags,
        "extensions": {
            "adobe_lakeHouse": {
                "metrics": {
                    "storageSize": size_bytes,
                    "rowCount": row_count,
                    "asOf": 1234567890,
                }
            }
        },
    }


def test_dataset_metrics_extracts_size_and_rows():
    ds = _dataset("abc123", "Test Dataset", size_bytes=1073741824, row_count=1000)
    metrics = dataset_metrics(ds)
    assert metrics["dataset_id"] == "abc123"
    assert metrics["row_count"] == 1000
    assert metrics["size_bytes"] == 1073741824
    assert metrics["size_gb"] == 1.0
    assert metrics["profile_enabled"] is False


def test_dataset_metrics_missing_lakehouse_extension_defaults_to_zero():
    ds = {"id": "no-metrics", "name": "Sparse Dataset"}
    metrics = dataset_metrics(ds)
    assert metrics["row_count"] == 0
    assert metrics["size_bytes"] == 0
    assert metrics["size_gb"] == 0.0


def test_is_profile_enabled_true_only_when_enabled_true_tag_present():
    assert is_profile_enabled(_dataset("a", "A", profile_enabled=True)) is True
    assert is_profile_enabled(_dataset("b", "B", profile_enabled=False)) is False
    assert is_profile_enabled({"id": "c", "name": "C", "tags": {"unifiedProfile": ["enabled:false"]}}) is False


def test_audit_datasets_sorts_by_size_descending_across_sandboxes():
    prod = {
        "small": _dataset("small", "Small", size_bytes=100),
        "large": _dataset("large", "Large", size_bytes=10_000_000_000),
    }
    dev2 = {
        "medium": _dataset("medium", "Medium", size_bytes=5_000_000_000),
    }
    rows = audit_datasets({"prod": prod, "dev2": dev2})
    assert [r["dataset_id"] for r in rows] == ["large", "medium", "small"]
    assert rows[0]["sandbox"] == "prod"
    assert rows[1]["sandbox"] == "dev2"


def test_audit_datasets_attaches_matched_labels():
    prod = {"ds1": _dataset("ds1", "Dataset One", size_bytes=1)}
    rows = audit_datasets({"prod": prod}, {"ds1": ["dv_abc (Some View)"]})
    assert rows[0]["matched_labels"] == ["dv_abc (Some View)"]


def test_audit_datasets_defaults_unmatched_labels_to_empty_list():
    prod = {"ds1": _dataset("ds1", "Dataset One", size_bytes=1)}
    rows = audit_datasets({"prod": prod})
    assert rows[0]["matched_labels"] == []
