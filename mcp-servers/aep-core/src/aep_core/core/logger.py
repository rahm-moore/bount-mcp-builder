"""Structured logging for aep-core.

Every log record goes through `_redact` so that even an accidental attempt
to log a ResolvedCredentials-derived dict doesn't leak secret material.
Tool-invocation-level audit logging (who/when/profile/domain) lives in the
orchestrator (see orchestrator/src/audit-log.ts) since that is the layer
that fronts every credential-scoped call; this logger is for
server-internal diagnostics only.
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

_REDACTED_KEYS = {
    "access_token",
    "refresh_token",
    "client_secret",
    "api_key",
    "authorization",
    "secret",
    "password",
}


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: ("<redacted>" if k.lower() in _REDACTED_KEYS else _redact(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        extra = getattr(record, "context", None)
        if extra:
            payload["context"] = _redact(extra)
        return json.dumps(payload)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(_JsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger
