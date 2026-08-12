"""Point-in-time configuration snapshots.

Ported conceptually from the legacy kit's snapshot module: capture a
tenant's current configuration (schemas, merge policies, segments,
sandboxes) as a single JSON artifact for diffing/auditing/rollback
reference — never for restoring/writing back automatically.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from ..auth.credential_resolver import ResolvedCredentials


@dataclass
class Snapshot:
    profile_name: str
    sandbox: str
    taken_at: str
    sections: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(
            {
                "profile_name": self.profile_name,
                "sandbox": self.sandbox,
                "taken_at": self.taken_at,
                "sections": self.sections,
            },
            indent=2,
            sort_keys=True,
        )


class SnapshotClient:
    """Builds and persists point-in-time tenant configuration snapshots.

    Each collector is a zero-arg callable returning JSON-serializable data
    for one section (e.g. merge policies, schemas). Callers supply the
    collectors so this module has no direct dependency on every other
    domain client.
    """

    def __init__(self, creds: ResolvedCredentials, storage_dir: str | Path = "logs/snapshots") -> None:
        self._creds = creds
        self._storage_dir = Path(storage_dir)

    def take_snapshot(self, sandbox: str, collectors: dict[str, Callable[[], Any]]) -> Snapshot:
        sections: dict[str, Any] = {}
        for section_name, collector in collectors.items():
            try:
                sections[section_name] = collector()
            except Exception as exc:  # noqa: BLE001 - snapshot should be best-effort
                sections[section_name] = {"error": str(exc)}

        return Snapshot(
            profile_name=self._creds.profile_name,
            sandbox=sandbox,
            taken_at=datetime.now(timezone.utc).isoformat(),
            sections=sections,
        )

    def save(self, snapshot: Snapshot) -> Path:
        self._storage_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{snapshot.profile_name}_{snapshot.sandbox}_{snapshot.taken_at.replace(':', '-')}.json"
        out_path = self._storage_dir / filename
        out_path.write_text(snapshot.to_json(), encoding="utf-8")
        return out_path

    def diff(self, before: Snapshot, after: Snapshot) -> dict[str, Any]:
        raise NotImplementedError(
            "wire up a structural diff between two Snapshot.sections dicts "
            "(e.g. via deepdiff) and return the delta"
        )
