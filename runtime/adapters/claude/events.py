"""Normalize Claude Code stream-json without leaking its shape into core."""

from __future__ import annotations

from typing import Any, Mapping, Literal

from ...core.contracts import BackendEvent, ContractError


Role = Literal["manager", "executor", "auditor"]


def _text(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"Claude {label} must be a non-empty string")
    return value


def normalize_claude_event(value: Any, *, role: Role) -> BackendEvent:
    if not isinstance(value, Mapping):
        raise ContractError("Claude event must be an object")
    event_type = _text(value.get("type"), "event type")
    raw_message = value.get("message")
    message: Mapping[str, Any] = raw_message if isinstance(raw_message, Mapping) else {}
    raw_content = message.get("content")
    content: list[Any] = raw_content if isinstance(raw_content, list) else []
    first: Mapping[str, Any] = content[0] if content and isinstance(content[0], Mapping) else {}
    block_type = first.get("type") if isinstance(first.get("type"), str) else None
    action = block_type or event_type
    source_id = value.get("session_id") or value.get("uuid") or message.get("id") or first.get("id")
    source_id = _text(source_id, "source id")
    if event_type == "system" and value.get("subtype") == "init":
        status = "started"
    elif event_type == "result" and not value.get("is_error", False):
        status = "completed"
    elif event_type == "result" or value.get("is_error", False):
        status = "failed"
    elif event_type in {"permission_request", "permission.requested"}:
        status = "permission_required"
    elif event_type in {"cancelled", "task_cancelled"}:
        status = "cancelled"
    else:
        status = "progress"
    references: list[str] = []
    raw_tool_input = first.get("input")
    tool_input: Mapping[str, Any] = raw_tool_input if isinstance(raw_tool_input, Mapping) else {}
    for key in ("file_path", "path", "command", "url"):
        candidate = tool_input.get(key) or value.get(key)
        if isinstance(candidate, str) and candidate.strip() and candidate not in references:
            references.append(candidate)
    tool = first.get("name") if block_type in {"tool_use", "mcp_tool_use"} and isinstance(first.get("name"), str) else None
    return BackendEvent.from_dict({"schema_version": 1, "host": "claude", "role": role, "action": action, "status": status, "source_id": source_id, "references": references, "tool": tool})
