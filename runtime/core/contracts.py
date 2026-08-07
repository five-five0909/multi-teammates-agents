"""Strict version-one contracts for the managed orchestration runtime."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, ClassVar, Literal, Mapping, TypeVar


SCHEMA_VERSION = 1
WorkMode = Literal["read", "write", "verify"]
WorkStatus = Literal[
    "pending", "running", "submitted", "auditing", "accepted", "rework", "blocked", "cancelled"
]
RunState = Literal[
    "initialized",
    "managing",
    "executing_wave",
    "auditing_wave",
    "needs_input",
    "blocked",
    "proposed_complete",
    "completed",
    "cancelled",
]


class ContractError(ValueError):
    """Raised when untrusted serialized data violates a runtime contract."""


T = TypeVar("T")


def _json_value(value: Any) -> Any:
    if isinstance(value, tuple):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    return value


def _object(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ContractError(f"{label} must be an object")
    return value


def _strict(data: Mapping[str, Any], required: set[str], optional: set[str], label: str) -> None:
    missing = required - data.keys()
    unknown = data.keys() - required - optional
    if missing:
        raise ContractError(f"{label} missing fields: {', '.join(sorted(missing))}")
    if unknown:
        raise ContractError(f"{label} unknown fields: {', '.join(sorted(unknown))}")


def _string(value: Any, label: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise ContractError(f"{label} must be a non-empty string")
    return value


def _strings(value: Any, label: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        raise ContractError(f"{label} must be an array of non-empty strings")
    if len(value) != len(set(value)):
        raise ContractError(f"{label} must not contain duplicates")
    return tuple(value)


def _integer(value: Any, label: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ContractError(f"{label} must be an integer >= {minimum}")
    return value


def _boolean(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise ContractError(f"{label} must be boolean")
    return value


def _enum(value: Any, allowed: set[str], label: str) -> str:
    if value not in allowed:
        raise ContractError(f"{label} must be one of: {', '.join(sorted(allowed))}")
    assert isinstance(value, str)
    return value


def _version(data: Mapping[str, Any], label: str) -> None:
    if data.get("schema_version") != SCHEMA_VERSION:
        raise ContractError(f"{label}.schema_version must be {SCHEMA_VERSION}")


@dataclass(frozen=True)
class TaskContract:
    schema_version: int
    goal: str
    constraints: tuple[str, ...]
    deliverables: tuple[str, ...]
    acceptance_criteria: tuple[str, ...]

    @classmethod
    def from_dict(cls, value: Any) -> "TaskContract":
        data = _object(value, "TaskContract")
        _strict(data, {"schema_version", "goal", "constraints", "deliverables", "acceptance_criteria"}, set(), "TaskContract")
        _version(data, "TaskContract")
        deliverables = _strings(data["deliverables"], "TaskContract.deliverables")
        criteria = _strings(data["acceptance_criteria"], "TaskContract.acceptance_criteria")
        if not deliverables or not criteria:
            raise ContractError("TaskContract requires deliverables and acceptance criteria")
        return cls(SCHEMA_VERSION, _string(data["goal"], "TaskContract.goal"), _strings(data["constraints"], "TaskContract.constraints"), deliverables, criteria)

    def to_dict(self) -> dict[str, Any]:
        return _json_value(asdict(self))


@dataclass(frozen=True)
class WorkItem:
    schema_version: int
    id: str
    objective: str
    role: str
    mode: WorkMode
    required: bool
    depends_on: tuple[str, ...]
    ownership: tuple[str, ...]
    evidence_required: tuple[str, ...]
    executor_id: str | None = None
    attempt: int = 0
    status: WorkStatus = "pending"

    @classmethod
    def from_dict(cls, value: Any) -> "WorkItem":
        data = _object(value, "WorkItem")
        required = {"schema_version", "id", "objective", "role", "mode", "required", "depends_on", "ownership", "evidence_required"}
        optional = {"executor_id", "attempt", "status"}
        _strict(data, required, optional, "WorkItem")
        _version(data, "WorkItem")
        mode = _enum(data["mode"], {"read", "write", "verify"}, "WorkItem.mode")
        ownership = _strings(data["ownership"], "WorkItem.ownership")
        if mode == "write" and not ownership:
            raise ContractError("write WorkItem requires ownership")
        if mode != "write" and ownership:
            raise ContractError("non-write WorkItem cannot claim ownership")
        executor = data.get("executor_id")
        if executor is not None:
            executor = _string(executor, "WorkItem.executor_id")
        return cls(
            SCHEMA_VERSION,
            _string(data["id"], "WorkItem.id"),
            _string(data["objective"], "WorkItem.objective"),
            _string(data["role"], "WorkItem.role"),
            mode,  # type: ignore[arg-type]
            _boolean(data["required"], "WorkItem.required"),
            _strings(data["depends_on"], "WorkItem.depends_on"),
            ownership,
            _strings(data["evidence_required"], "WorkItem.evidence_required"),
            executor,
            _integer(data.get("attempt", 0), "WorkItem.attempt"),
            _enum(data.get("status", "pending"), {"pending", "running", "submitted", "auditing", "accepted", "rework", "blocked", "cancelled"}, "WorkItem.status"),  # type: ignore[arg-type]
        )

    def to_dict(self) -> dict[str, Any]:
        return _json_value(asdict(self))


@dataclass(frozen=True)
class RoleResult:
    schema_version: int
    work_item_id: str
    attempt: int
    executor_id: str
    summary: str
    artifacts: tuple[str, ...]
    evidence: tuple[str, ...]
    checks: tuple[str, ...]
    risks: tuple[str, ...]
    failure: str | None = None

    @classmethod
    def from_dict(cls, value: Any) -> "RoleResult":
        data = _object(value, "RoleResult")
        required = {"schema_version", "work_item_id", "attempt", "executor_id", "summary", "artifacts", "evidence", "checks", "risks"}
        _strict(data, required, {"failure"}, "RoleResult")
        _version(data, "RoleResult")
        failure = data.get("failure")
        if failure is not None:
            failure = _string(failure, "RoleResult.failure")
        return cls(SCHEMA_VERSION, _string(data["work_item_id"], "RoleResult.work_item_id"), _integer(data["attempt"], "RoleResult.attempt", minimum=1), _string(data["executor_id"], "RoleResult.executor_id"), _string(data["summary"], "RoleResult.summary"), _strings(data["artifacts"], "RoleResult.artifacts"), _strings(data["evidence"], "RoleResult.evidence"), _strings(data["checks"], "RoleResult.checks"), _strings(data["risks"], "RoleResult.risks"), failure)

    def to_dict(self) -> dict[str, Any]:
        return _json_value(asdict(self))


@dataclass(frozen=True)
class AuditDecision:
    schema_version: int
    work_item_id: str
    attempt: int
    auditor_id: str
    executor_id: str
    status: Literal["accepted", "rework", "blocked", "invalid"]
    integrity: Literal["clean", "dirty"]
    contract_alignment: Literal["aligned", "misaligned"]
    evidence: tuple[str, ...]
    findings: tuple[str, ...]
    required_rework: tuple[str, ...]

    @classmethod
    def from_dict(cls, value: Any) -> "AuditDecision":
        data = _object(value, "AuditDecision")
        required = {"schema_version", "work_item_id", "attempt", "auditor_id", "executor_id", "status", "integrity", "contract_alignment", "evidence", "findings", "required_rework"}
        _strict(data, required, set(), "AuditDecision")
        _version(data, "AuditDecision")
        auditor = _string(data["auditor_id"], "AuditDecision.auditor_id")
        executor = _string(data["executor_id"], "AuditDecision.executor_id")
        if auditor == executor:
            raise ContractError("Auditor must be independent from Executor")
        status = _enum(data["status"], {"accepted", "rework", "blocked", "invalid"}, "AuditDecision.status")
        integrity = _enum(data["integrity"], {"clean", "dirty"}, "AuditDecision.integrity")
        alignment = _enum(data["contract_alignment"], {"aligned", "misaligned"}, "AuditDecision.contract_alignment")
        if status == "accepted" and (integrity != "clean" or alignment != "aligned"):
            raise ContractError("accepted audit requires clean integrity and aligned contract")
        return cls(SCHEMA_VERSION, _string(data["work_item_id"], "AuditDecision.work_item_id"), _integer(data["attempt"], "AuditDecision.attempt", minimum=1), auditor, executor, status, integrity, alignment, _strings(data["evidence"], "AuditDecision.evidence"), _strings(data["findings"], "AuditDecision.findings"), _strings(data["required_rework"], "AuditDecision.required_rework"))  # type: ignore[arg-type]

    def to_dict(self) -> dict[str, Any]:
        return _json_value(asdict(self))


@dataclass(frozen=True)
class HumanDecision:
    schema_version: int
    gate_type: Literal["ask", "blocked", "repeated_failure", "budget", "completion", "permission", "cancellation"]
    decision: Literal["approve", "reject", "continue", "cancel", "instruct"]
    actor: str
    timestamp: str
    instruction: str | None = None

    @classmethod
    def from_dict(cls, value: Any) -> "HumanDecision":
        data = _object(value, "HumanDecision")
        _strict(data, {"schema_version", "gate_type", "decision", "actor", "timestamp"}, {"instruction"}, "HumanDecision")
        _version(data, "HumanDecision")
        instruction = data.get("instruction")
        if instruction is not None:
            instruction = _string(instruction, "HumanDecision.instruction")
        decision = _enum(data["decision"], {"approve", "reject", "continue", "cancel", "instruct"}, "HumanDecision.decision")
        if decision == "instruct" and not instruction:
            raise ContractError("instruct decision requires instruction")
        return cls(SCHEMA_VERSION, _enum(data["gate_type"], {"ask", "blocked", "repeated_failure", "budget", "completion", "permission", "cancellation"}, "HumanDecision.gate_type"), decision, _string(data["actor"], "HumanDecision.actor"), _string(data["timestamp"], "HumanDecision.timestamp"), instruction)  # type: ignore[arg-type]

    def to_dict(self) -> dict[str, Any]:
        return _json_value(asdict(self))


@dataclass(frozen=True)
class BackendEvent:
    schema_version: int
    host: Literal["codex", "claude"]
    role: Literal["manager", "executor", "auditor"]
    action: str
    status: Literal["started", "progress", "completed", "failed", "permission_required", "cancelled"]
    source_id: str
    references: tuple[str, ...]
    tool: str | None = None

    @classmethod
    def from_dict(cls, value: Any) -> "BackendEvent":
        data = _object(value, "BackendEvent")
        _strict(data, {"schema_version", "host", "role", "action", "status", "source_id", "references"}, {"tool"}, "BackendEvent")
        _version(data, "BackendEvent")
        tool = data.get("tool")
        if tool is not None:
            tool = _string(tool, "BackendEvent.tool")
        return cls(SCHEMA_VERSION, _enum(data["host"], {"codex", "claude"}, "BackendEvent.host"), _enum(data["role"], {"manager", "executor", "auditor"}, "BackendEvent.role"), _string(data["action"], "BackendEvent.action"), _enum(data["status"], {"started", "progress", "completed", "failed", "permission_required", "cancelled"}, "BackendEvent.status"), _string(data["source_id"], "BackendEvent.source_id"), _strings(data["references"], "BackendEvent.references"), tool)  # type: ignore[arg-type]

    def to_dict(self) -> dict[str, Any]:
        return _json_value(asdict(self))


@dataclass(frozen=True)
class RunEvent:
    schema_version: int
    id: str
    run_id: str
    seq: int
    expected_version: int
    kind: str
    timestamp: str
    payload: Mapping[str, Any]

    @classmethod
    def from_dict(cls, value: Any) -> "RunEvent":
        data = _object(value, "RunEvent")
        _strict(data, {"schema_version", "id", "run_id", "seq", "expected_version", "kind", "timestamp", "payload"}, set(), "RunEvent")
        _version(data, "RunEvent")
        return cls(SCHEMA_VERSION, _string(data["id"], "RunEvent.id"), _string(data["run_id"], "RunEvent.run_id"), _integer(data["seq"], "RunEvent.seq", minimum=1), _integer(data["expected_version"], "RunEvent.expected_version"), _string(data["kind"], "RunEvent.kind"), _string(data["timestamp"], "RunEvent.timestamp"), _object(data["payload"], "RunEvent.payload"))

    def to_dict(self) -> dict[str, Any]:
        return _json_value(asdict(self))


@dataclass(frozen=True)
class RunSnapshot:
    schema_version: int
    run_id: str
    state: RunState
    version: int
    last_seq: int
    contract: TaskContract
    work_items: Mapping[str, WorkItem]
    verified_progress: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    event_ids: tuple[str, ...] = ()
    pending_gate: str | None = None
    rounds_used: int = 0
    max_rounds: int = 20
    retry_limit: int = 2

    @classmethod
    def from_dict(cls, value: Any) -> "RunSnapshot":
        data = _object(value, "RunSnapshot")
        required = {
            "schema_version", "run_id", "state", "version", "last_seq", "contract",
            "work_items", "verified_progress", "event_ids", "pending_gate",
            "rounds_used", "max_rounds", "retry_limit",
        }
        _strict(data, required, set(), "RunSnapshot")
        _version(data, "RunSnapshot")
        raw_items = _object(data["work_items"], "RunSnapshot.work_items")
        items: dict[str, WorkItem] = {}
        for item_id, raw_item in raw_items.items():
            if not isinstance(item_id, str):
                raise ContractError("RunSnapshot.work_items keys must be strings")
            parsed = WorkItem.from_dict(raw_item)
            if parsed.id != item_id:
                raise ContractError(f"RunSnapshot work item key mismatch: {item_id}")
            items[item_id] = parsed
        raw_verified = _object(data["verified_progress"], "RunSnapshot.verified_progress")
        verified: dict[str, tuple[str, ...]] = {}
        for item_id, evidence in raw_verified.items():
            if not isinstance(item_id, str) or item_id not in items:
                raise ContractError(f"RunSnapshot verified progress references unknown item: {item_id}")
            verified[item_id] = _strings(evidence, f"RunSnapshot.verified_progress.{item_id}")
        pending_gate = data["pending_gate"]
        if pending_gate is not None:
            pending_gate = _string(pending_gate, "RunSnapshot.pending_gate")
        return cls(
            SCHEMA_VERSION,
            _string(data["run_id"], "RunSnapshot.run_id"),
            _enum(data["state"], {"initialized", "managing", "executing_wave", "auditing_wave", "needs_input", "blocked", "proposed_complete", "completed", "cancelled"}, "RunSnapshot.state"),  # type: ignore[arg-type]
            _integer(data["version"], "RunSnapshot.version"),
            _integer(data["last_seq"], "RunSnapshot.last_seq"),
            TaskContract.from_dict(data["contract"]),
            items,
            verified,
            _strings(data["event_ids"], "RunSnapshot.event_ids"),
            pending_gate,
            _integer(data["rounds_used"], "RunSnapshot.rounds_used"),
            _integer(data["max_rounds"], "RunSnapshot.max_rounds", minimum=1),
            _integer(data["retry_limit"], "RunSnapshot.retry_limit", minimum=1),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "run_id": self.run_id,
            "state": self.state,
            "version": self.version,
            "last_seq": self.last_seq,
            "contract": self.contract.to_dict(),
            "work_items": {key: value.to_dict() for key, value in self.work_items.items()},
            "verified_progress": {key: list(value) for key, value in self.verified_progress.items()},
            "event_ids": list(self.event_ids),
            "pending_gate": self.pending_gate,
            "rounds_used": self.rounds_used,
            "max_rounds": self.max_rounds,
            "retry_limit": self.retry_limit,
        }
