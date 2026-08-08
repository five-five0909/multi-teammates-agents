"""Small durable entry-gate store shared by the MCP and local adapters."""

from __future__ import annotations

from datetime import datetime, timezone
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Any, Mapping
from uuid import uuid4

from .core.contracts import ContractError, DecisionProvenance


ENTRY_GATE_SCHEMA_VERSION = 2
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fingerprint(value: Any) -> str:
    """Return a stable, redaction-free fingerprint for structured values."""

    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def workspace_fingerprint(root: Path) -> str:
    return fingerprint({"workspace": str(root.resolve())})


@dataclass(frozen=True)
class ModeDecision:
    """Versioned projection of a single mode choice."""

    schema_version: int
    invocation_id: str
    selected_tier: str
    provenance: DecisionProvenance
    assessment_fingerprint: str

    @classmethod
    def from_dict(cls, value: Any) -> "ModeDecision":
        if not isinstance(value, Mapping):
            raise ContractError("ModeDecision must be an object")
        required = {"schema_version", "invocation_id", "selected_tier", "provenance", "assessment_fingerprint"}
        optional: set[str] = set()
        unknown = set(value) - required - optional
        missing = required - set(value)
        if missing or unknown:
            raise ContractError("ModeDecision fields are invalid")
        if value.get("schema_version") != 1:
            raise ContractError("ModeDecision.schema_version must be 1")
        for field in ("invocation_id", "assessment_fingerprint"):
            if not isinstance(value.get(field), str) or not str(value[field]).strip():
                raise ContractError(f"ModeDecision.{field} must be a non-empty string")
        if value["selected_tier"] not in {"managed", "lightweight", "cancel"}:
            raise ContractError("ModeDecision.selected_tier is invalid")
        provenance = DecisionProvenance.from_dict(value["provenance"])
        if provenance.gate_type != "mode_selection":
            raise ContractError("ModeDecision.provenance.gate_type must be mode_selection")
        if provenance.actor == "user" and provenance.verification != "verified":
            raise ContractError("ModeDecision user provenance must be verified")
        return cls(1, value["invocation_id"], value["selected_tier"], provenance, value["assessment_fingerprint"])

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "invocation_id": self.invocation_id,
            "selected_tier": self.selected_tier,
            "provenance": self.provenance.to_dict(),
            "assessment_fingerprint": self.assessment_fingerprint,
        }


@dataclass(frozen=True)
class QualificationReceipt:
    """Receipt required at the managed-run creation boundary."""

    schema_version: int
    qualification_id: str
    invocation_id: str
    effective_tier: str
    execution_mode: str
    task_id: str | None
    task_status: str | None
    contract_fingerprint: str
    graph_fingerprint: str
    assessment_fingerprint: str
    workspace_fingerprint: str
    issued_at: str
    task_metadata_fingerprint: str | None = None
    graph_waves: int | None = None
    work_item_ids: tuple[str, ...] | None = None
    package_version: str | None = None
    run_id: str | None = None

    @classmethod
    def from_dict(cls, value: Any) -> "QualificationReceipt":
        if not isinstance(value, Mapping):
            raise ContractError("QualificationReceipt must be an object")
        required = {"schema_version", "qualification_id", "invocation_id", "effective_tier", "execution_mode", "task_id", "task_status", "contract_fingerprint", "graph_fingerprint", "assessment_fingerprint", "workspace_fingerprint", "issued_at"}
        optional = {"task_metadata_fingerprint", "graph_waves", "work_item_ids", "package_version", "run_id"}
        if set(value) - required - optional or required - set(value):
            raise ContractError("QualificationReceipt fields are invalid")
        if value.get("schema_version") != 1:
            raise ContractError("QualificationReceipt.schema_version must be 1")
        for field in ("qualification_id", "invocation_id", "execution_mode", "contract_fingerprint", "graph_fingerprint", "assessment_fingerprint", "workspace_fingerprint", "issued_at"):
            if not isinstance(value.get(field), str) or not str(value[field]).strip():
                raise ContractError(f"QualificationReceipt.{field} must be a non-empty string")
        if value["effective_tier"] not in {"managed", "lightweight"}:
            raise ContractError("QualificationReceipt.effective_tier is invalid")
        if value.get("graph_waves") is not None and (isinstance(value["graph_waves"], bool) or not isinstance(value["graph_waves"], int) or value["graph_waves"] < 1):
            raise ContractError("QualificationReceipt.graph_waves is invalid")
        work_item_ids = value.get("work_item_ids")
        if work_item_ids is not None and (not isinstance(work_item_ids, list) or not all(isinstance(item, str) and item.strip() for item in work_item_ids)):
            raise ContractError("QualificationReceipt.work_item_ids is invalid")
        return cls(1, value["qualification_id"], value["invocation_id"], value["effective_tier"], value["execution_mode"], value.get("task_id"), value.get("task_status"), value["contract_fingerprint"], value["graph_fingerprint"], value["assessment_fingerprint"], value["workspace_fingerprint"], value["issued_at"], value.get("task_metadata_fingerprint"), value.get("graph_waves"), tuple(work_item_ids) if work_item_ids is not None else None, value.get("package_version"), value.get("run_id"))

    def to_dict(self) -> dict[str, Any]:
        required = {
            "schema_version": self.schema_version,
            "qualification_id": self.qualification_id,
            "invocation_id": self.invocation_id,
            "effective_tier": self.effective_tier,
            "execution_mode": self.execution_mode,
            "task_id": self.task_id,
            "task_status": self.task_status,
            "contract_fingerprint": self.contract_fingerprint,
            "graph_fingerprint": self.graph_fingerprint,
            "assessment_fingerprint": self.assessment_fingerprint,
            "workspace_fingerprint": self.workspace_fingerprint,
            "issued_at": self.issued_at,
        }
        optional: dict[str, Any] = {
            "task_metadata_fingerprint": self.task_metadata_fingerprint,
            "graph_waves": self.graph_waves,
            "work_item_ids": self.work_item_ids,
            "package_version": self.package_version,
            "run_id": self.run_id,
        }
        value: dict[str, Any] = {**required, **{key: item for key, item in optional.items() if item is not None}}
        if self.work_item_ids is not None:
            value["work_item_ids"] = list(self.work_item_ids)
        return value


def new_invocation_id() -> str:
    return str(uuid4())


def _atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ContractError(f"entry gate not found: {path.name}") from error
    except json.JSONDecodeError as error:
        raise ContractError(f"entry gate is invalid JSON: {error.msg}") from error
    if not isinstance(value, dict):
        raise ContractError("entry gate record must be an object")
    if value.get("schema_version") != ENTRY_GATE_SCHEMA_VERSION:
        raise ContractError("entry gate schema version is stale; refresh the plugin")
    return value


class EntryGateStore:
    """Atomic JSON records scoped to one workspace and host session."""

    def __init__(self, workspace_root: Path, *, session_id: str = "default") -> None:
        self.workspace_root = workspace_root.resolve()
        if not self.workspace_root.is_dir():
            raise ContractError("workspace_root must be an existing directory")
        if not isinstance(session_id, str) or not session_id.strip():
            raise ContractError("session_id must be a non-empty string")
        self.session_id = self._safe_id(session_id, "session_id")
        if (self.workspace_root / ".trellis").is_dir():
            base = self.workspace_root / ".trellis" / ".runtime" / "expert-team" / "entry-gates"
        else:
            base = self.workspace_root / ".expert-team" / "entry-gates"
        self.root = base / self.session_id

    @staticmethod
    def _safe_id(value: str, label: str) -> str:
        normalized = value.strip()
        if not _SAFE_ID.fullmatch(normalized):
            raise ContractError(f"{label} contains unsafe path characters")
        return normalized

    def path(self, invocation_id: str) -> Path:
        return self.root / f"{self._safe_id(invocation_id, 'invocation_id')}.json"

    def create(self, assessment: Mapping[str, Any], *, source_event_id: str | None = None) -> dict[str, Any]:
        invocation_id = assessment.get("invocation_id")
        if not isinstance(invocation_id, str) or not invocation_id.strip():
            raise ContractError("assessment.invocation_id is required")
        record = {
            "schema_version": ENTRY_GATE_SCHEMA_VERSION,
            "session_id": self.session_id,
            "invocation_id": invocation_id,
            "workspace": {
                "root": str(self.workspace_root),
                "fingerprint": workspace_fingerprint(self.workspace_root),
            },
            "assessment": dict(assessment),
            "decisions": [],
            "qualification": None,
            "state": "prepared",
            "source_event_id": source_event_id,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "version": 1,
        }
        path = self.path(invocation_id)
        existing = None
        if path.exists():
            existing = _read_json(path)
            if existing.get("assessment", {}).get("request_fingerprint") != assessment.get("request_fingerprint"):
                raise ContractError("invocation_id is already bound to a different request")
            if existing.get("assessment", {}).get("assessment_fingerprint") != assessment.get("assessment_fingerprint"):
                raise ContractError("invocation_id is already bound to a different mode assessment")
            old_tooling = existing.get("assessment", {}).get("tooling")
            new_tooling = assessment.get("tooling")
            if old_tooling != new_tooling:
                raise ContractError("stale_session: entry-gate tooling version changed; refresh and open a new session")
            if existing.get("source_event_id") != source_event_id:
                raise ContractError("invocation_id is already bound to a different source event")
            return existing
        _atomic_json(path, record)
        return record

    def load(self, invocation_id: str) -> dict[str, Any]:
        record = _read_json(self.path(invocation_id))
        workspace = record.get("workspace")
        if not isinstance(workspace, dict) or workspace.get("fingerprint") != workspace_fingerprint(self.workspace_root):
            raise ContractError("workspace_unbound: entry gate belongs to another workspace")
        return record

    def save(self, record: Mapping[str, Any]) -> dict[str, Any]:
        invocation_id = record.get("invocation_id")
        if not isinstance(invocation_id, str) or not invocation_id.strip():
            raise ContractError("entry gate invocation_id is required")
        value = dict(record)
        current = int(value.get("version", 0))
        value["version"] = current + 1
        value["updated_at"] = now_iso()
        _atomic_json(self.path(invocation_id), value)
        return value

    def add_decision(self, invocation_id: str, decision: Mapping[str, Any]) -> dict[str, Any]:
        ModeDecision.from_dict(decision)
        record = self.load(invocation_id)
        decisions = record.get("decisions")
        if not isinstance(decisions, list):
            raise ContractError("entry gate decisions are malformed")
        selected = decision.get("selected_tier")
        for existing in decisions:
            if isinstance(existing, dict) and existing.get("selected_tier") == selected:
                return record
            if isinstance(existing, dict) and existing.get("selected_tier") not in {None, selected}:
                raise ContractError("conflicting mode decision already exists; request a new invocation")
        decisions.append(dict(decision))
        record["decisions"] = decisions
        record["state"] = "mode_selected"
        return self.save(record)

    def set_qualification(self, invocation_id: str, receipt: Mapping[str, Any]) -> dict[str, Any]:
        record = self.load(invocation_id)
        existing = record.get("qualification")
        if existing is not None and existing != receipt:
            raise ContractError("invocation is already qualified with a different receipt")
        record["qualification"] = dict(receipt)
        record["state"] = "qualified"
        return self.save(record)

    @staticmethod
    def latest_decision(record: Mapping[str, Any]) -> Mapping[str, Any] | None:
        decisions = record.get("decisions")
        if not isinstance(decisions, list):
            return None
        for decision in reversed(decisions):
            if isinstance(decision, Mapping):
                return decision
        return None


def graph_waves(items: list[Any]) -> int:
    """Return the longest dependency chain, with a minimum of one wave."""

    by_id = {item.id: item for item in items}
    cache: dict[str, int] = {}

    def depth(item_id: str, visiting: set[str]) -> int:
        if item_id in cache:
            return cache[item_id]
        if item_id in visiting:
            raise ContractError(f"dependency cycle contains {item_id}")
        visiting.add(item_id)
        item = by_id[item_id]
        value = 1 + max((depth(dep, visiting) for dep in item.depends_on), default=0)
        visiting.remove(item_id)
        cache[item_id] = value
        return value

    return max((depth(item_id, set()) for item_id in by_id), default=0)


__all__ = [
    "ENTRY_GATE_SCHEMA_VERSION",
    "EntryGateStore",
    "ModeDecision",
    "QualificationReceipt",
    "fingerprint",
    "graph_waves",
    "new_invocation_id",
    "now_iso",
    "workspace_fingerprint",
]
