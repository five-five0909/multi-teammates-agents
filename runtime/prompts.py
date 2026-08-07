"""Versioned bounded role prompts and strict structured-output parsers."""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any, Literal, Mapping

from .core.contracts import AuditDecision, ContractError, RoleResult, RunSnapshot, WorkItem


@dataclass(frozen=True)
class ManagerDecision:
    action: Literal["execute", "ask", "blocked", "propose_complete", "cancel"]
    work_item_ids: tuple[str, ...] = ()
    message: str = ""


def build_manager_prompt(snapshot: RunSnapshot, *, max_chars: int) -> str:
    state = {
        "schema_version": 1,
        "goal": snapshot.contract.goal,
        "constraints": list(snapshot.contract.constraints),
        "deliverables": list(snapshot.contract.deliverables),
        "acceptance_criteria": list(snapshot.contract.acceptance_criteria),
        "verified_progress": {key: list(value) for key, value in snapshot.verified_progress.items()},
        "unresolved_work": [
            {
                "id": item.id,
                "objective": item.objective,
                "role": item.role,
                "mode": item.mode,
                "required": item.required,
                "depends_on": list(item.depends_on),
                "status": item.status,
                "attempt": item.attempt,
            }
            for item in snapshot.work_items.values()
            if item.status not in {"accepted", "cancelled"}
        ],
        "budget": {
            "rounds_used": snapshot.rounds_used,
            "max_rounds": snapshot.max_rounds,
            "retry_limit": snapshot.retry_limit,
        },
    }
    state_json = _bounded_state_json(state, max_chars=max_chars - 1_200)
    prompt = (
        "You are the Expert Team Manager. Plan only; never claim execution or audit evidence.\n"
        "Choose exactly one action: execute, ask, blocked, propose_complete, cancel.\n"
        "For execute, select only dependency-ready unresolved work item IDs.\n"
        "Return JSON only: {\"schema_version\":1,\"action\":\"execute\","
        "\"work_item_ids\":[\"id\"],\"message\":\"reason\"}.\n"
        "Authoritative compact state:\n" + state_json
    )
    if len(prompt) > max_chars:
        raise ContractError("Manager prompt exceeds configured context budget")
    return prompt


def build_executor_prompt(
    snapshot: RunSnapshot,
    item: WorkItem,
    *,
    executor_id: str,
    max_chars: int,
) -> str:
    expected_attempt = item.attempt if item.status == "running" else item.attempt + 1
    payload = {
        "goal": snapshot.contract.goal,
        "work_item": item.to_dict(),
        "executor_id": executor_id,
        "accepted_dependencies": {
            dependency: list(snapshot.verified_progress.get(dependency, ()))
            for dependency in item.depends_on
        },
    }
    prompt = (
        "You are an Expert Team Executor in a fresh context. Complete only the bounded work item. "
        "Do not certify your own work. Return one RoleResult JSON object with schema_version=1, "
        f"work_item_id={item.id!r}, attempt={expected_attempt}, executor_id={executor_id!r}.\n"
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    )
    if len(prompt) > max_chars:
        raise ContractError("Executor prompt exceeds configured context budget")
    return prompt


def build_auditor_prompt(
    snapshot: RunSnapshot,
    item: WorkItem,
    result: RoleResult,
    *,
    auditor_id: str,
    max_chars: int,
) -> str:
    payload = {
        "goal": snapshot.contract.goal,
        "acceptance_criteria": list(snapshot.contract.acceptance_criteria),
        "work_item": item.to_dict(),
        "executor_result": result.to_dict(),
        "auditor_id": auditor_id,
    }
    prompt = (
        "You are an independent read-only Expert Team Auditor. Inspect the actual workspace and "
        "evidence. Do not create, edit, move, or delete files. Never repair the Executor's work. "
        "Return one AuditDecision JSON object with schema_version=1 and auditor_id="
        f"{auditor_id!r}. Accepted requires clean integrity and aligned contract.\n"
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    )
    if len(prompt) > max_chars:
        raise ContractError("Auditor prompt exceeds configured context budget")
    return prompt


def parse_manager_decision(output: str, snapshot: RunSnapshot) -> ManagerDecision:
    data = _json_object(output, "ManagerDecision")
    required = {"schema_version", "action", "work_item_ids", "message"}
    if set(data) != required or data.get("schema_version") != 1:
        raise ContractError("ManagerDecision must contain exactly schema_version, action, work_item_ids, message")
    action = data.get("action")
    if action not in {"execute", "ask", "blocked", "propose_complete", "cancel"}:
        raise ContractError("ManagerDecision action is invalid")
    raw_ids = data.get("work_item_ids")
    if not isinstance(raw_ids, list) or not all(isinstance(value, str) and value.strip() for value in raw_ids):
        raise ContractError("ManagerDecision.work_item_ids must be an array of strings")
    ids = tuple(raw_ids)
    if len(ids) != len(set(ids)):
        raise ContractError("ManagerDecision work_item_ids contain duplicates")
    message = data.get("message")
    if not isinstance(message, str):
        raise ContractError("ManagerDecision.message must be a string")
    if action == "execute":
        if not ids:
            raise ContractError("execute decision requires work_item_ids")
        for item_id in ids:
            item = snapshot.work_items.get(item_id)
            if item is None or item.status not in {"pending", "rework"}:
                raise ContractError(f"Manager selected unavailable work item: {item_id}")
            if any(snapshot.work_items[dependency].status != "accepted" for dependency in item.depends_on):
                raise ContractError(f"Manager selected work item with unmet dependency: {item_id}")
    elif ids:
        raise ContractError(f"{action} decision cannot include work_item_ids")
    return ManagerDecision(action, ids, message)


def parse_role_result(output: str, *, item: WorkItem, executor_id: str) -> RoleResult:
    result = RoleResult.from_dict(_json_object(output, "RoleResult"))
    if result.work_item_id != item.id or result.attempt != item.attempt or result.executor_id != executor_id:
        raise ContractError("RoleResult identity does not match active Executor attempt")
    return result


def parse_audit_decision(
    output: str,
    *,
    item: WorkItem,
    executor_id: str,
    auditor_id: str,
) -> AuditDecision:
    decision = AuditDecision.from_dict(_json_object(output, "AuditDecision"))
    if (
        decision.work_item_id != item.id
        or decision.attempt != item.attempt
        or decision.executor_id != executor_id
        or decision.auditor_id != auditor_id
    ):
        raise ContractError("AuditDecision identity does not match active audit attempt")
    return decision


def _json_object(output: str, label: str) -> Mapping[str, Any]:
    text = output.strip()
    if text.startswith("```" ):
        lines = text.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            text = "\n".join(lines[1:-1])
            if text.lstrip().startswith("json"):
                text = text.lstrip()[4:].lstrip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError as error:
        raise ContractError(f"{label} output is not one JSON object: {error.msg}") from error
    if not isinstance(value, Mapping):
        raise ContractError(f"{label} output must be a JSON object")
    return value


def _bounded_state_json(state: dict[str, Any], *, max_chars: int) -> str:
    if max_chars < 500:
        raise ContractError("Manager context budget is too small")
    value = json.loads(json.dumps(state, ensure_ascii=False))
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(encoded) <= max_chars:
        return encoded
    verified = value["verified_progress"]
    for item_id in list(verified):
        verified[item_id] = verified[item_id][:1]
    value["goal"] = str(value["goal"])[: max(200, max_chars // 5)]
    for item in value["unresolved_work"]:
        item["objective"] = str(item["objective"])[:300]
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(encoded) <= max_chars:
        return encoded
    value["constraints"] = []
    value["deliverables"] = value["deliverables"][:3]
    value["acceptance_criteria"] = value["acceptance_criteria"][:3]
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(encoded) > max_chars:
        raise ContractError("compact Manager state exceeds configured context budget")
    return encoded
