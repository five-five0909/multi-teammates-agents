"""Application service used by the portable Expert Team MCP surface."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Mapping, cast
from uuid import uuid4

from .adapters.trellis import TrellisRunStore
from .adapters.claude import normalize_claude_event
from .adapters.codex import normalize_codex_event
from .core.contracts import AuditDecision, BackendEvent, ContractError, HumanDecision, RoleResult, RunEvent, TaskContract, WorkItem
from .security import redact_value


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ExpertTeamService:
    def __init__(self, repo_root: Path, *, developer: str = "expert-team") -> None:
        self.repo_root = repo_root.resolve()
        self.developer = developer

    def _task_dir(self, task_id: str, *, require_active: bool = False) -> Path:
        tasks_root = self.repo_root / ".trellis" / "tasks"
        if not tasks_root.is_dir():
            raise ContractError("managed mode requires .trellis/tasks")
        matches: list[tuple[Path, dict[str, Any]]] = []
        for task_file in tasks_root.glob("*/task.json"):
            try:
                value = json.loads(task_file.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if task_file.parent.name == task_id or value.get("id") == task_id or value.get("name") == task_id:
                if isinstance(value, dict):
                    matches.append((task_file.parent, value))
        if len(matches) != 1:
            raise ContractError(f"expected one Trellis task for {task_id}, found {len(matches)}")
        task_dir, metadata = matches[0]
        if require_active and metadata.get("status") != "in_progress":
            raise ContractError(f"managed mode requires an in_progress Trellis task; {task_id} is {metadata.get('status', 'unknown')}")
        return task_dir

    def _store(self, task_id: str) -> TrellisRunStore:
        return TrellisRunStore(self.repo_root, self._task_dir(task_id), self.developer)

    def start(self, task_id: str, run_id: str, contract: Any, work_items: Any, *, max_rounds: int = 20, retry_limit: int = 2) -> dict[str, Any]:
        if not isinstance(work_items, list):
            raise ContractError("work_items must be an array")
        parsed_contract = TaskContract.from_dict(redact_value(contract))
        parsed_items = [WorkItem.from_dict(redact_value(value)) for value in work_items]
        coordinators = self._coordinator_ids()
        dispatched_coordinators = sorted({item.role for item in parsed_items if item.role in coordinators})
        if dispatched_coordinators:
            raise ContractError(f"coordinator profiles cannot be dispatched as Executors: {', '.join(dispatched_coordinators)}")
        store = TrellisRunStore(self.repo_root, self._task_dir(task_id, require_active=True), self.developer)
        snapshot = store.create(run_id, parsed_contract, parsed_items, max_rounds=max_rounds, retry_limit=retry_limit)
        snapshot = store.append(self._event(snapshot, "run.managing", {}), owner="mcp-start")
        return snapshot.to_dict()

    def status(self, task_id: str, run_id: str) -> dict[str, Any]:
        return self._store(task_id).load(run_id).to_dict()

    def next(self, task_id: str, run_id: str, action: str, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ContractError("payload must be an object")
        kinds = {
            "manage": "run.managing",
            "start_execution": "wave.execution_started",
            "start_audit": "wave.audit_started",
            "request_gate": "human.gate_requested",
            "block": "run.blocked",
        }
        try:
            kind = kinds[action]
        except KeyError as error:
            raise ContractError(f"unsupported next action: {action}") from error
        store = self._store(task_id)
        current = store.load(run_id)
        transition = self._event(current, kind, payload)
        updated = store.append(transition, owner="mcp-next")
        if action == "start_execution":
            store.record_round(run_id, {"schema_version": 1, "round": updated.rounds_used, "event_id": transition.id, "work_item_ids": list(payload.get("work_item_ids", [])), "state_version": updated.version, "timestamp": transition.timestamp})
        return updated.to_dict()

    def submit_result(self, task_id: str, run_id: str, value: Any) -> dict[str, Any]:
        result = RoleResult.from_dict(redact_value(value))
        store = self._store(task_id)
        current = store.load(run_id)
        updated = store.append(self._event(current, "executor.result_submitted", result.to_dict()), owner="mcp-result")
        store.record_role_result(run_id, result)
        return updated.to_dict()

    def submit_audit(self, task_id: str, run_id: str, value: Any) -> dict[str, Any]:
        decision = AuditDecision.from_dict(redact_value(value))
        store = self._store(task_id)
        current = store.load(run_id)
        updated = store.append(self._event(current, "audit.recorded", decision.to_dict()), owner="mcp-audit")
        store.record_audit(run_id, decision)
        return updated.to_dict()

    def answer(self, task_id: str, run_id: str, value: Any) -> dict[str, Any]:
        decision = HumanDecision.from_dict(redact_value(value))
        store = self._store(task_id)
        current = store.load(run_id)
        payload = {"decision": decision.decision, "gate_type": decision.gate_type, "actor": decision.actor, "instruction": decision.instruction}
        updated = store.append(self._event(current, "human.decision_recorded", payload), owner="mcp-answer")
        store.record_human_decision(run_id, decision)
        if updated.state == "completed":
            lines = [f"# Expert Team Run {run_id}", "", f"Goal: {updated.contract.goal}", "", "## Verified progress", ""]
            for item_id, evidence in updated.verified_progress.items():
                lines.append(f"- `{item_id}`: {', '.join(evidence)}")
            lines.extend(["", f"Rounds used: {updated.rounds_used}/{updated.max_rounds}", f"Approved by: {decision.actor}", f"Completed at: {decision.timestamp}"])
            store.write_final_report(run_id, "\n".join(lines))
        return updated.to_dict()

    def resume(self, task_id: str, run_id: str) -> dict[str, Any]:
        snapshot = self._store(task_id).load(run_id)
        return {
            "run_id": snapshot.run_id,
            "state": snapshot.state,
            "version": snapshot.version,
            "goal": snapshot.contract.goal,
            "verified_progress": {key: list(value) for key, value in snapshot.verified_progress.items()},
            "unresolved_work": [item.to_dict() for item in snapshot.work_items.values() if item.status not in {"accepted", "cancelled"}],
            "pending_gate": snapshot.pending_gate,
            "budget": {"rounds_used": snapshot.rounds_used, "max_rounds": snapshot.max_rounds, "retry_limit": snapshot.retry_limit},
        }

    def cancel(self, task_id: str, run_id: str, payload: Mapping[str, Any] | None = None) -> dict[str, Any]:
        store = self._store(task_id)
        current = store.load(run_id)
        return store.append(self._event(current, "run.cancelled", payload or {}), owner="mcp-cancel").to_dict()

    def record_host_event(self, task_id: str, run_id: str, host: str, role: str, value: Any) -> dict[str, Any]:
        if role not in {"manager", "executor", "auditor"}:
            raise ContractError(f"unsupported role: {role}")
        if host == "codex":
            normalized = normalize_codex_event(value, role=role)  # type: ignore[arg-type]
        elif host == "claude":
            normalized = normalize_claude_event(value, role=role)  # type: ignore[arg-type]
        else:
            raise ContractError(f"unsupported host: {host}")
        normalized = BackendEvent.from_dict(redact_value(normalized.to_dict()))
        store = self._store(task_id)
        self.record_backend_event(task_id, run_id, normalized)
        return normalized.to_dict()

    def record_episode_event(
        self,
        task_id: str,
        run_id: str,
        kind: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        allowed = {
            "episode.started", "episode.completed", "episode.failed",
            "episode.timeout", "episode.cancelled", "episode.abandoned",
        }
        if kind not in allowed:
            raise ContractError(f"unsupported episode event: {kind}")
        store = self._store(task_id)
        current = store.load(run_id)
        return store.append(self._event(current, kind, payload), owner="supervisor").to_dict()

    def record_episode_trace(
        self,
        task_id: str,
        run_id: str,
        episode_id: str,
        value: Mapping[str, object],
    ) -> str:
        safe_value = cast(dict[str, object], redact_value(dict(value)))
        path = self._store(task_id).record_episode_trace(run_id, episode_id, safe_value)
        return path.relative_to(self.repo_root).as_posix()

    def record_backend_event(self, task_id: str, run_id: str, event: Any) -> None:
        parsed_value = event.to_dict() if isinstance(event, BackendEvent) else event
        parsed = BackendEvent.from_dict(redact_value(parsed_value))
        self._store(task_id).record_backend_event(run_id, parsed)

    def events(self, task_id: str, run_id: str) -> tuple[RunEvent, ...]:
        return self._store(task_id).read_events(run_id)

    def load_role_result(self, task_id: str, run_id: str, work_item_id: str, attempt: int) -> RoleResult:
        return self._store(task_id).load_role_result(run_id, work_item_id, attempt)

    @staticmethod
    def _coordinator_ids() -> set[str]:
        registry_path = Path(__file__).resolve().parents[1] / "skills" / "expert-team" / "references" / "agent-registry.json"
        try:
            value = json.loads(registry_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ContractError("canonical expert registry is unavailable") from error
        agents = value.get("agents") if isinstance(value, dict) else None
        if not isinstance(agents, list):
            raise ContractError("canonical expert registry is invalid")
        return {agent["id"] for agent in agents if isinstance(agent, dict) and agent.get("kind") == "coordinator" and isinstance(agent.get("id"), str)}

    @staticmethod
    def _event(snapshot: Any, kind: str, payload: Mapping[str, Any]) -> RunEvent:
        safe_payload = redact_value(dict(payload))
        return RunEvent.from_dict({"schema_version": 1, "id": str(uuid4()), "run_id": snapshot.run_id, "seq": snapshot.last_seq + 1, "expected_version": snapshot.version, "kind": kind, "timestamp": _now(), "payload": safe_payload})
