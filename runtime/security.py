"""Small, dependency-free redaction helpers for durable runtime artifacts."""

from __future__ import annotations

from collections.abc import Mapping
import re


_SECRET_KEY = re.compile(r"(?i)(?:api[_ -]?key|auth(?:orization)?|access[_ -]?token|token|password|secret)")
_SECRET_PATTERN = re.compile(
    r"(?i)(api[_-]?key|auth(?:orization)?|access[_-]?token|password|secret)(\s*[=:]\s*)([^\s,;]+)"
)
_BEARER_PATTERN = re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=-]+")
_OPENAI_KEY_PATTERN = re.compile(r"\bsk-[a-zA-Z0-9_-]{8,}\b")


def redact_secrets(text: str) -> str:
    """Redact labelled credentials and common bearer/API-key forms."""

    redacted = _SECRET_PATTERN.sub(r"\1\2***REDACTED***", text)
    redacted = _BEARER_PATTERN.sub("Bearer ***REDACTED***", redacted)
    return _OPENAI_KEY_PATTERN.sub("sk-***REDACTED***", redacted)


def redact_value(value: object, *, field: str | None = None) -> object:
    """Recursively redact JSON-like values before they cross a durable boundary."""

    if field is not None and _SECRET_KEY.search(field):
        return "***REDACTED***"
    if isinstance(value, str):
        return redact_secrets(value)
    if isinstance(value, Mapping):
        return {str(key): redact_value(item, field=str(key)) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact_value(item) for item in value]
    return value
