"""aep-core MCP server entrypoint.

Registers one MCP tool per AEP domain operation. Every tool that touches a
real tenant takes a `profile` name + `domain` (never raw credentials),
resolves them via auth.credential_resolver.resolve_profile, and returns
only the API response payload — the resolved ResolvedCredentials object
never leaves this module.
"""

from __future__ import annotations

import os
from typing import Any

from mcp.server.fastmcp import FastMCP

from .auth.credential_resolver import (
    DomainNotAllowedError,
    ProfileNotFoundError,
    SecretBackendError,
    resolve_profile,
)
from .auth.ims_oauth import IMSTokenManager
from .catalog.audit import audit_datasets
from .catalog.datasets import CatalogClient
from .cja.dataviews import CJAClient
from .core.logger import get_logger
from .flow_service.dataflows import DataflowClient
from .flow_service.datastreams import DatastreamClient
from .governance.governance import GovernanceClient
from .identity.identity_graph import IdentityGraphClient
from .sandboxes.sandboxes import SandboxClient
from .schema_registry.schemas import SchemaRegistryClient
from .segmentation.audiences import AudienceClient
from .segmentation.segments import SegmentationClient

logger = get_logger("aep_core.server")

# Transport is env-driven: "stdio" (default — e.g. for a local Claude
# Desktop config invoking this as a subprocess) or "streamable-http" (used
# in docker-compose, where the orchestrator reaches this server over HTTP
# at http://aep-core:<port>/mcp — see orchestrator/src/router.ts).
mcp = FastMCP(
    "aep-core",
    host=os.environ.get("MCP_HTTP_HOST", "0.0.0.0"),
    port=int(os.environ.get("PORT", "8801")),
)

# One shared token manager for the process lifetime so tokens are cached
# across tool calls instead of re-fetched every time.
_token_manager = IMSTokenManager()


def _resolve(profile: str, domain: str):
    """Shared resolve + error-shaping used by every tool below."""
    try:
        return resolve_profile(profile, domain)
    except (ProfileNotFoundError, DomainNotAllowedError, SecretBackendError) as exc:
        logger.warning(
            "credential resolution failed",
            extra={"context": {"profile": profile, "domain": domain, "error": type(exc).__name__}},
        )
        raise


# ---------------------------------------------------------------------------
# Flow Service: dataflows
# ---------------------------------------------------------------------------


@mcp.tool()
def list_dataflows(profile: str, domain: str) -> list[dict[str, Any]]:
    """List Flow Service dataflows configured for this tenant/sandbox."""
    creds = _resolve(profile, domain)
    client = DataflowClient(creds, _token_manager)
    try:
        return client.list_dataflows()
    finally:
        client.close()


@mcp.tool()
def get_dataflow(profile: str, domain: str, flow_id: str) -> dict[str, Any]:
    """Get a single Flow Service dataflow by id, including its current state."""
    creds = _resolve(profile, domain)
    client = DataflowClient(creds, _token_manager)
    try:
        return client.get_dataflow(flow_id)
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Flow Service: datastreams (Web SDK / alloy.js edge config)
# ---------------------------------------------------------------------------


@mcp.tool()
def list_datastreams(profile: str, domain: str) -> list[dict[str, Any]]:
    """List Web SDK datastreams (edge configs) configured for this tenant."""
    creds = _resolve(profile, domain)
    client = DatastreamClient(creds, _token_manager)
    try:
        return client.list_datastreams()
    finally:
        client.close()


@mcp.tool()
def get_datastream_services(profile: str, domain: str, edge_config_id: str) -> dict[str, Any]:
    """Get the service mappings (Analytics/Target/AAM/AEP) for a datastream."""
    creds = _resolve(profile, domain)
    client = DatastreamClient(creds, _token_manager)
    try:
        return client.get_datastream_services(edge_config_id)
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Schema Registry
# ---------------------------------------------------------------------------


@mcp.tool()
def list_schemas(profile: str, domain: str, container: str = "tenant") -> list[dict[str, Any]]:
    """List XDM schemas in a Schema Registry container ('tenant' or 'global')."""
    creds = _resolve(profile, domain)
    client = SchemaRegistryClient(creds, _token_manager)
    try:
        return client.list_schemas(container)
    finally:
        client.close()


@mcp.tool()
def get_schema(profile: str, domain: str, schema_id: str, container: str = "tenant") -> dict[str, Any]:
    """Get the full definition of one XDM schema."""
    creds = _resolve(profile, domain)
    client = SchemaRegistryClient(creds, _token_manager)
    try:
        return client.get_schema(schema_id, container)
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


@mcp.tool()
def list_datasets(profile: str, domain: str) -> dict[str, Any]:
    """List Catalog datasets for this tenant/sandbox."""
    creds = _resolve(profile, domain)
    client = CatalogClient(creds, _token_manager)
    try:
        return client.list_datasets()
    finally:
        client.close()


@mcp.tool()
def list_dataset_audit(profile: str, domain: str) -> list[dict]:
    """Full dataset size/row-count audit for this profile's sandbox.

    Paginates past Catalog Service's 100-per-page cap and extracts each
    dataset's live row count, storage size (bytes + GB), Profile-enabled
    flag, and last-batch timestamp straight from
    extensions.adobe_lakeHouse.metrics — no separate Query Service or Data
    Access call needed. Rows are sorted by size_gb descending. For repeat
    use across multiple sandboxes (e.g. prod + dev2), call once per profile
    and merge client-side, or use resolve_dataset_audit_with_cja_labels
    below if you also want known CJA data views cross-referenced.
    """
    creds = _resolve(profile, domain)
    client = CatalogClient(creds, _token_manager)
    try:
        datasets = client.list_all_datasets()
    finally:
        client.close()
    return audit_datasets({creds.sandbox: datasets})


@mcp.tool()
def resolve_cja_dataview_datasets(profile: str, domain: str, dataview_ids: list[str]) -> dict[str, Any]:
    """Resolve CJA data view IDs (e.g. "dv_...") to their underlying AEP dataset IDs.

    A CJA data view can span multiple datasets (event/profile/lookup roles
    on its parent connection); this returns all of them per data view, in
    the same shape as cit-bank-websdk's tools/cja_dataview_dataset_map.json.
    Use this whenever a report/workbook only has a data view ID and you
    need to trace it back to real Catalog datasets (e.g. to explain which
    part of a storage/row-count audit a given CJA view corresponds to).
    """
    creds = _resolve(profile, domain)
    client = CJAClient(creds, _token_manager)
    try:
        return client.map_dataviews_to_datasets(dataview_ids)
    finally:
        client.close()


@mcp.tool()
def audit_datasets_with_cja_labels(profile: str, domain: str, dataview_ids: list[str]) -> list[dict]:
    """One-shot version of the CIT Bank dataset audit: size/row audit + CJA cross-reference.

    Combines list_dataset_audit and resolve_cja_dataview_datasets: runs the
    full Catalog Service dataset audit for this profile's sandbox, then
    labels each row with the names of any known CJA data views (from
    dataview_ids) whose parent connection includes that dataset. This is
    the reusable version of the one-off process first run by hand against
    the CIT Bank tenant (see cit-bank-websdk repo,
    docs/aep-dataset-audit/) — use this tool instead of re-deriving that
    script next time the same question comes up.
    """
    creds = _resolve(profile, domain)
    catalog_client = CatalogClient(creds, _token_manager)
    try:
        datasets = catalog_client.list_all_datasets()
    finally:
        catalog_client.close()

    cja_client = CJAClient(creds, _token_manager)
    try:
        dataview_map = cja_client.map_dataviews_to_datasets(dataview_ids)
    finally:
        cja_client.close()

    dataset_to_labels: dict[str, list[str]] = {}
    for dataview_id, info in dataview_map.items():
        label = f"{dataview_id} ({info['name']})"
        for dataset_id in info["dataset_ids"]:
            dataset_to_labels.setdefault(dataset_id, []).append(label)

    return audit_datasets({creds.sandbox: datasets}, dataset_to_labels)


# ---------------------------------------------------------------------------
# Segmentation
# ---------------------------------------------------------------------------


@mcp.tool()
def list_segments(profile: str, domain: str) -> list[dict[str, Any]]:
    """List Real-Time CDP segment definitions."""
    creds = _resolve(profile, domain)
    client = SegmentationClient(creds, _token_manager)
    try:
        return client.list_segments()
    finally:
        client.close()


@mcp.tool()
def list_audiences(profile: str, domain: str) -> list[dict[str, Any]]:
    """List Real-Time CDP audiences available for activation."""
    creds = _resolve(profile, domain)
    client = AudienceClient(creds, _token_manager)
    try:
        return client.list_audiences()
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------


@mcp.tool()
def get_identity_clusters(profile: str, domain: str, namespace: str, identity_value: str) -> dict[str, Any]:
    """Look up the identity graph cluster for a given namespace + identity value."""
    creds = _resolve(profile, domain)
    client = IdentityGraphClient(creds, _token_manager)
    try:
        return client.get_identity_clusters(namespace, identity_value)
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Governance
# ---------------------------------------------------------------------------


@mcp.tool()
def list_data_usage_policies(profile: str, domain: str) -> list[dict[str, Any]]:
    """List configured Data Usage policies for this tenant."""
    creds = _resolve(profile, domain)
    client = GovernanceClient(creds, _token_manager)
    try:
        return client.list_data_usage_policies()
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Sandboxes
# ---------------------------------------------------------------------------


@mcp.tool()
def list_sandboxes(profile: str, domain: str) -> list[dict[str, Any]]:
    """List sandboxes available to this tenant/profile."""
    creds = _resolve(profile, domain)
    client = SandboxClient(creds, _token_manager)
    try:
        return client.list_sandboxes()
    finally:
        client.close()


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    logger.info("starting aep-core MCP server", extra={"context": {"transport": transport}})
    if transport not in ("stdio", "streamable-http"):
        raise ValueError(f"Unknown MCP_TRANSPORT: {transport!r}")
    mcp.run(transport=transport)


if __name__ == "__main__":
    main()
