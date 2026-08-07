"""Helpers for selecting the structured final response from host streams."""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any, Mapping


def select_structured_visible_output(texts: Sequence[str], *, preferred: str = "") -> str:
    """Prefer the last assistant message that is a single JSON object."""

    preferred_text = preferred.strip()
    if preferred_text and _is_json_object(preferred_text):
        return preferred_text
    for text in reversed(texts):
        candidate = text.strip()
        if candidate and _is_json_object(candidate):
            return candidate
    if preferred_text:
        return preferred_text
    return "\n\n".join(text.strip() for text in texts if text.strip())


def _is_json_object(text: str) -> bool:
    try:
        value: Any = json.loads(_strip_json_fence(text))
    except json.JSONDecodeError:
        return False
    return isinstance(value, Mapping)


def _strip_json_fence(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    lines = stripped.splitlines()
    if len(lines) < 3 or lines[-1].strip() != "```":
        return stripped
    body = "\n".join(lines[1:-1]).lstrip()
    if body.startswith("json"):
        return body[4:].lstrip()
    return body
