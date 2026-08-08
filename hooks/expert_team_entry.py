#!/usr/bin/env python3
"""Host hook adapter for the Expert Team entry gate.

The hook is deliberately small: it records a prompt fingerprint through the
same service used by MCP and emits a phase-aware context/deny response.  It
does not claim to cover hosted tools that bypass the host hook API; callers
must pass ``hook_trusted``/the observed event ID to obtain enforced status.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
from typing import Any
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.service import ExpertTeamService  # noqa: E402


EXPLICIT = re.compile(r"(?:\$expert-team|/multi-teammates-agents:expert-team)\b", re.IGNORECASE)
MUTATING_TOOLS = {
    "apply_patch", "Bash", "bash", "shell_command", "exec_command",
    "expert_team_start", "expert_team_next", "expert_team_submit_result",
    "expert_team_submit_audit", "expert_team_answer", "expert_team_run",
}
READ_ONLY_COMMANDS = (
    "git status", "git diff", "git log", "rg ", "python -m unittest", "python -m mypy",
    "python -m compileall", "get-content", "select-string", "get-childitem", "task.py current",
    "task.py list", "task.py validate",
)


def _input() -> dict[str, object]:
    try:
        value = json.loads(sys.stdin.read() or "{}")
    except (json.JSONDecodeError, OSError):
        return {}
    return value if isinstance(value, dict) else {}


def _workspace(data: dict[str, object]) -> Path:
    raw = data.get("cwd") or os.environ.get("EXPERT_TEAM_WORKSPACE") or os.getcwd()
    return Path(str(raw)).resolve()


def _session_id(data: dict[str, object]) -> str:
    value = data.get("session_id") or os.environ.get("EXPERT_TEAM_SESSION_ID") or "hook-session"
    return str(value)


def _emit_context(content: str) -> None:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": content}}, ensure_ascii=False))


def _emit_deny(reason: str) -> None:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}}, ensure_ascii=False))


def _payload_text(data: dict[str, object]) -> str:
    values = [data.get("command"), data.get("cmd"), data.get("input"), data.get("tool_input"), data.get("arguments")]
    return " ".join(str(value) for value in values if value is not None).casefold()


def _host_version_fields(data: dict[str, object]) -> dict[str, Any]:
    """Forward host-reported compatibility metadata when the hook provides it."""

    aliases = {
        "host_package_version": ("host_package_version", "package_version", "EXPERT_TEAM_HOST_PACKAGE_VERSION"),
        "host_entry_contract_version": ("host_entry_contract_version", "entry_contract_version", "EXPERT_TEAM_HOST_ENTRY_CONTRACT_VERSION"),
        "host_hook_schema_version": ("host_hook_schema_version", "hook_schema_version", "EXPERT_TEAM_HOST_HOOK_SCHEMA_VERSION"),
        "host_toolset_fingerprint": ("host_toolset_fingerprint", "toolset_fingerprint", "EXPERT_TEAM_HOST_TOOLSET_FINGERPRINT"),
    }
    result: dict[str, Any] = {}
    for target, candidates in aliases.items():
        for candidate in candidates:
            value = data.get(candidate) if candidate in data else os.environ.get(candidate)
            if value is not None and str(value).strip():
                if target in {"host_entry_contract_version", "host_hook_schema_version"}:
                    try:
                        value = int(str(value))
                    except (TypeError, ValueError):
                        pass
                result[target] = value
                break
    return result


def _planning_only(tool: str, payload: str) -> bool:
    if any(command in payload for command in READ_ONLY_COMMANDS):
        return True
    if tool.casefold() in {"bash", "shell_command", "exec_command"}:
        return any(marker in payload for marker in ("task.py create", "task.py add-context", "task.py list-context"))
    if tool.casefold() == "apply_patch":
        paths = re.findall(r"(?:Update|Add|Delete) File:\s*([^\n]+)", payload, re.IGNORECASE)
        if not paths:
            return False
        return all(
            ".trellis\\tasks\\" in path.casefold() or "/.trellis/tasks/" in path.casefold()
            for path in paths
        ) and all(path.casefold().endswith((".md", ".jsonl", "task.json")) for path in paths)
    return False


def _prompt_submit(data: dict[str, object]) -> int:
    prompt = str(data.get("prompt") or data.get("user_prompt") or "")
    if not EXPLICIT.search(prompt):
        return 0
    workspace = _workspace(data)
    service = ExpertTeamService(workspace, session_id=_session_id(data), workspace_trusted=True)
    invocation_id = str(data.get("invocation_id") or uuid4())
    try:
        host_versions = _host_version_fields(data)
        assessment = service.prepare(
            prompt,
            invocation_id=invocation_id,
            host_mode="inline" if data.get("host_mode") != "subagent" else "subagent",
            intent="implementation",
            source_event_id=str(data.get("event_id") or invocation_id),
            selection_surface="native_single_select" if data.get("native_single_select") else "plain_reply",
            hook_trusted=True,
            **host_versions,
        )
    except Exception as error:  # hook failures must be visible, never a false allow
        _emit_context(f"Expert Team entry gate unavailable: {error}. Stop before project mutation and refresh the plugin/session.")
        return 0
    _emit_context(
        "Expert Team entry gate recorded. "
        f"invocation_id={assessment['invocation_id']}; policy_floor={assessment['policy_floor']}; "
        f"decision_state={assessment['decision_state']}; source_event_id={assessment['entry_gate'].get('source_event_id')}; "
        f"next_action={assessment['next_action']}; "
        "Call expert_team_select_mode when a selection is required, then expert_team_qualify."
    )
    return 0


def _pre_tool_use(data: dict[str, object]) -> int:
    tool = str(data.get("tool_name") or data.get("name") or "")
    if tool not in MUTATING_TOOLS:
        return 0
    workspace = _workspace(data)
    session = _session_id(data)
    try:
        service = ExpertTeamService(workspace, session_id=session, workspace_trusted=True)
        invocation_id = data.get("invocation_id")
        if isinstance(invocation_id, str) and invocation_id.strip():
            records = [service.gates.path(invocation_id)]
        else:
            records = sorted(service.gates.root.glob("*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
        if not records or not records[0].exists():
            _emit_deny("Expert Team entry gate has no prepare record; call expert_team_prepare before mutation.")
            return 0
        record = json.loads(records[0].read_text(encoding="utf-8"))
        state = record.get("state")
        payload = _payload_text(data)
        if state in {"prepared", "mode_selected"} and _planning_only(tool, payload):
            return 0
        if state not in {"qualified", "run_started"}:
            _emit_deny(f"Expert Team entry gate state is {state!r}; follow next_action before using {tool}.")
    except Exception as error:
        _emit_deny(f"Expert Team entry gate cannot be verified ({error}); mutation is blocked.")
    return 0


def main() -> int:
    data = _input()
    event = str(data.get("hook_event_name") or data.get("event") or "UserPromptSubmit")
    if event in {"PreToolUse", "before_tool_use"}:
        return _pre_tool_use(data)
    return _prompt_submit(data)


if __name__ == "__main__":
    raise SystemExit(main())
