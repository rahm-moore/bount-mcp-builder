"""aep-core MCP server entrypoint.

Registers one MCP tool per AEP domain operation. Every tool that touches a
real tenant takes a `profile` name + `domain` (never raw credentials),
resolves them via auth.credential_resolver.resolve_profile, and returns
only the API response payload — the resolved ResolvedCredentials object
never leaves this module.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from .auth.credential_resolver import (
    DomainNotAllowedError,
    ProfileNotFoundError,
    SecretBackendError,
    resolve_profile,
)
from .auth.ims_oauth import IMSTokenManager
from .catalog.datasets import CatalogClient
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

mcp = FastMCP("aep-core")

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
    logger.info("starting aep-core MCP server")
    mcp.run()


if __name__ == "__main__":
    main()
