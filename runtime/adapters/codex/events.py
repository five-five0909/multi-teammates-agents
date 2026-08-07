"""Normalize Codex exec/thread JSON without leaking its shape into core."""

from __future__ import annotations

from typing import Any, Mapping, Literal

from ...core.contracts import BackendEvent, ContractError


Role = Literal["manager", "executor", "auditor"]


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"Codex {label} must be a non-empty string")
    return value


def normalize_codex_event(value: Any, *, role: Role) -> BackendEvent:
    if not isinstance(value, Mapping):
        raise ContractError("Codex event must be an object")
    event_type = _text(value.get("type"), "event type")
    raw_item = value.get("item")
    item: Mapping[str, Any] = raw_item if isinstance(raw_item, Mapping) else {}
    item_type = item.get("type") if isinstance(item.get("type"), str) else None
    action = item_type or event_type
    source_id = value.get("thread_id") or item.get("id") or value.get("id")
    source_id = _text(source_id, "source id")
    if event_type.endswith(".started"):
        status = "started"
    elif event_type.endswith(".completed") or event_type in {"result", "turn.completed"}:
        status = "completed"
    elif event_type in {"error", "turn.failed", "item.failed"}:
        status = "failed"
    elif event_type in {"permission.requested", "approval.requested"}:
        status = "permission_required"
    elif event_type.endswith(".cancelled"):
        status = "cancelled"
    else:
        status = "progress"
    references: list[str] = []
    for key in ("path", "command", "url"):
        candidate = item.get(key) or value.get(key)
        if isinstance(candidate, str) and candidate.strip() and candidate not in references:
            references.append(candidate)
    tool = item.get("name") if item_type in {"mcp_tool_call", "tool_call"} and isinstance(item.get("name"), str) else None
    return BackendEvent.from_dict({"schema_version": 1, "host": "codex", "role": role, "action": action, "status": status, "source_id": source_id, "references": references, "tool": tool})
