"""The single event reducer for managed Expert Team state."""

from __future__ import annotations

from dataclasses import replace
from typing import Iterable, Mapping, Any

from .contracts import AuditDecision, ContractError, RoleResult, RunEvent, RunSnapshot, TaskContract, WorkItem
from .scheduling import validate_parallel_wave, validate_work_graph


EVENT_KINDS = {
    "run.managing",
    "wave.execution_started",
    "executor.result_submitted",
    "wave.audit_started",
    "audit.recorded",
    "human.gate_requested",
    "human.decision_recorded",
    "run.blocked",
    "run.cancelled",
    "episode.started",
    "episode.completed",
    "episode.failed",
    "episode.timeout",
    "episode.cancelled",
    "episode.abandoned",
}
GATE_TYPES = {"ask", "blocked", "repeated_failure", "budget", "completion", "permission", "cancellation"}


def create_snapshot(
    run_id: str,
    contract: TaskContract,
    work_items: Iterable[WorkItem],
    *,
    max_rounds: int = 20,
    retry_limit: int = 2,
) -> RunSnapshot:
    if not run_id.strip():
        raise ContractError("run_id must be a non-empty string")
    if max_rounds < 1 or retry_limit < 1:
        raise ContractError("max_rounds and retry_limit must be positive")
    by_id = validate_work_graph(work_items)
    return RunSnapshot(1, run_id, "initialized", 0, 0, contract, by_id, max_rounds=max_rounds, retry_limit=retry_limit)


def _payload_id(payload: Mapping[str, Any], name: str) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"event payload {name} must be a non-empty string")
    return value


def _item(snapshot: RunSnapshot, item_id: str) -> WorkItem:
    try:
        return snapshot.work_items[item_id]
    except KeyError as error:
        raise ContractError(f"unknown work item: {item_id}") from error


def _with_item(snapshot: RunSnapshot, item: WorkItem) -> Mapping[str, WorkItem]:
    items = dict(snapshot.work_items)
    items[item.id] = item
    return items


def _can_complete(snapshot: RunSnapshot) -> bool:
    return all(not item.required or item.status == "accepted" for item in snapshot.work_items.values())


def apply_event(snapshot: RunSnapshot, event: RunEvent) -> RunSnapshot:
    if event.run_id != snapshot.run_id:
        raise ContractError("event run_id does not match snapshot")
    if event.id in snapshot.event_ids:
        return snapshot
    if event.kind not in EVENT_KINDS:
        raise ContractError(f"unknown event kind: {event.kind}")
    if event.seq != snapshot.last_seq + 1:
        raise ContractError(f"event seq must be {snapshot.last_seq + 1}")
    if event.expected_version != snapshot.version:
        raise ContractError(f"version conflict: expected {snapshot.version}, got {event.expected_version}")

    state = snapshot.state
    items: Mapping[str, WorkItem] = snapshot.work_items
    verified = dict(snapshot.verified_progress)
    gate = snapshot.pending_gate
    rounds = snapshot.rounds_used

    if event.kind.startswith("episode."):
        episode_id = _payload_id(event.payload, "episode_id")
        role = _payload_id(event.payload, "role")
        _payload_id(event.payload, "host")
        if role not in {"manager", "executor", "auditor"}:
            raise ContractError(f"unknown episode role: {role}")
        expected_states = {
            "manager": {"managing"},
            "executor": {"executing_wave"},
            "auditor": {"auditing_wave"},
        }
        if state not in expected_states[role]:
            raise ContractError(f"cannot record {role} episode {episode_id} from {state}")
        if event.kind in {"episode.abandoned", "episode.failed", "episode.timeout", "episode.cancelled"} and role in {"executor", "auditor"}:
            item_id = _payload_id(event.payload, "work_item_id")
            item = _item(snapshot, item_id)
            expected_status = "running" if role == "executor" else "auditing"
            if item.status != expected_status:
                raise ContractError(f"failed {role} episode does not match active work item")
            next_status = "blocked" if item.attempt >= snapshot.retry_limit else "rework"
            items = _with_item(snapshot, replace(item, status=next_status))  # type: ignore[arg-type]
            still_active = any(
                value.status in {"running", "auditing", "submitted"}
                for value in items.values()
            )
            if not still_active:
                state = "blocked" if any(value.status == "blocked" for value in items.values()) else "managing"

    elif event.kind == "run.managing":
        if state not in {"initialized", "executing_wave", "auditing_wave", "needs_input"}:
            raise ContractError(f"cannot enter managing from {state}")
        if state == "executing_wave" and any(item.status in {"running", "submitted"} for item in items.values()):
            raise ContractError("cannot leave execution wave while work items are active")
        if state == "auditing_wave" and any(item.status == "auditing" for item in items.values()):
            raise ContractError("cannot leave audit wave while work items await audit")
        state = "managing"
        gate = None

    elif event.kind == "wave.execution_started":
        if state != "managing":
            raise ContractError(f"cannot start execution from {state}")
        raw_ids = event.payload.get("work_item_ids")
        if not isinstance(raw_ids, list) or not raw_ids or not all(isinstance(value, str) for value in raw_ids):
            raise ContractError("execution wave requires work_item_ids")
        if len(raw_ids) != len(set(raw_ids)):
            raise ContractError("execution wave contains duplicate work_item_ids")
        selected = [_item(snapshot, item_id) for item_id in raw_ids]
        validate_parallel_wave(selected)
        raw_assignments = event.payload.get("assignments")
        assignments = raw_assignments if isinstance(raw_assignments, Mapping) else {}
        single_executor = event.payload.get("executor_id")
        updated = dict(items)
        for item_id in raw_ids:
            item = _item(snapshot, item_id)
            if item.status not in {"pending", "rework"}:
                raise ContractError(f"{item_id}: cannot execute from {item.status}")
            if any(items[dependency].status != "accepted" for dependency in item.depends_on):
                raise ContractError(f"{item_id}: dependencies are not accepted")
            executor_id = assignments.get(item_id) if isinstance(assignments.get(item_id), str) else single_executor if len(raw_ids) == 1 else None
            if not isinstance(executor_id, str) or not executor_id.strip():
                raise ContractError(f"{item_id}: execution wave requires a unique executor assignment")
            updated[item_id] = replace(item, status="running", attempt=item.attempt + 1, executor_id=executor_id)
        items = updated
        state = "executing_wave"
        rounds += 1
        if rounds > snapshot.max_rounds:
            raise ContractError("round budget exhausted")

    elif event.kind == "executor.result_submitted":
        if state != "executing_wave":
            raise ContractError(f"cannot submit Executor result from {state}")
        result = RoleResult.from_dict(event.payload)
        item = _item(snapshot, result.work_item_id)
        if item.status != "running" or item.attempt != result.attempt:
            raise ContractError("Executor result does not match active attempt")
        if item.executor_id is not None and item.executor_id != result.executor_id:
            raise ContractError("Executor result identity does not match assignment")
        items = _with_item(snapshot, replace(item, status="submitted", executor_id=result.executor_id))

    elif event.kind == "wave.audit_started":
        if state != "executing_wave":
            raise ContractError(f"cannot start audit from {state}")
        candidates = [item for item in items.values() if item.status == "submitted"]
        if not candidates:
            raise ContractError("audit wave requires submitted work")
        if any(item.status == "running" for item in items.values()):
            raise ContractError("cannot start audit while Executors are still running")
        updated = dict(items)
        for item in candidates:
            updated[item.id] = replace(item, status="auditing")
        items = updated
        state = "auditing_wave"

    elif event.kind == "audit.recorded":
        if state != "auditing_wave":
            raise ContractError(f"cannot record audit from {state}")
        audit_decision = AuditDecision.from_dict(event.payload)
        item = _item(snapshot, audit_decision.work_item_id)
        if item.status != "auditing" or item.attempt != audit_decision.attempt:
            raise ContractError("audit does not match active attempt")
        if item.executor_id != audit_decision.executor_id:
            raise ContractError("audit Executor identity does not match assignment")
        next_status = audit_decision.status
        if audit_decision.status == "accepted":
            verified[item.id] = audit_decision.evidence
        elif audit_decision.status in {"rework", "invalid"}:
            next_status = "blocked" if item.attempt >= snapshot.retry_limit else "rework"
        items = _with_item(snapshot, replace(item, status=next_status))  # type: ignore[arg-type]
        if not any(value.status == "auditing" for value in items.values()) and any(
            value.status == "blocked" for value in items.values()
        ):
            state = "blocked"

    elif event.kind == "human.gate_requested":
        if state not in {"managing", "executing_wave", "auditing_wave", "blocked"}:
            raise ContractError(f"cannot request human gate from {state}")
        gate = _payload_id(event.payload, "gate_type")
        if gate not in GATE_TYPES:
            raise ContractError(f"unknown human gate type: {gate}")
        if state == "executing_wave":
            if gate not in {"permission", "repeated_failure", "budget", "cancellation", "blocked"}:
                raise ContractError(f"cannot request human gate from {state}")
            updated = dict(items)
            for item in items.values():
                if item.status in {"running", "submitted", "auditing"}:
                    next_status = "blocked" if item.attempt >= snapshot.retry_limit else "rework"
                    updated[item.id] = replace(item, status=next_status)  # type: ignore[arg-type]
            items = updated
        elif state == "auditing_wave" and gate != "completion":
            updated = dict(items)
            for item in items.values():
                if item.status in {"running", "submitted", "auditing"}:
                    next_status = "blocked" if item.attempt >= snapshot.retry_limit else "rework"
                    updated[item.id] = replace(item, status=next_status)  # type: ignore[arg-type]
            items = updated
        if gate == "completion":
            if not _can_complete(replace(snapshot, work_items=items)):
                raise ContractError("cannot propose completion with unaccepted required work")
            state = "proposed_complete"
        else:
            state = "needs_input"

    elif event.kind == "human.decision_recorded":
        if state not in {"needs_input", "proposed_complete", "blocked"}:
            raise ContractError(f"cannot record human decision from {state}")
        decision_gate = _payload_id(event.payload, "gate_type")
        if decision_gate != gate:
            raise ContractError(f"human decision gate mismatch: expected {gate}, got {decision_gate}")
        human_decision = _payload_id(event.payload, "decision")
        if human_decision == "cancel":
            state = "cancelled"
        elif state == "proposed_complete" and human_decision == "approve":
            if not _can_complete(replace(snapshot, work_items=items)):
                raise ContractError("completion invariant failed")
            state = "completed"
        elif human_decision in {"approve", "continue", "instruct", "reject"}:
            state = "managing"
        else:
            raise ContractError(f"unsupported decision {human_decision} for {state}")
        gate = None

    elif event.kind == "run.blocked":
        if state in {"completed", "cancelled"}:
            raise ContractError(f"cannot block terminal run {state}")
        state = "blocked"

    elif event.kind == "run.cancelled":
        if state == "completed":
            raise ContractError("cannot cancel a completed run")
        state = "cancelled"

    return replace(
        snapshot,
        state=state,  # type: ignore[arg-type]
        version=snapshot.version + 1,
        last_seq=event.seq,
        work_items=items,
        verified_progress=verified,
        event_ids=(*snapshot.event_ids, event.id),
        pending_gate=gate,
        rounds_used=rounds,
    )


def replay(initial: RunSnapshot, events: Iterable[RunEvent]) -> RunSnapshot:
    snapshot = initial
    for event in events:
        snapshot = apply_event(snapshot, event)
    return snapshot
