"""Crash-recoverable storage for managed runs inside a Trellis task."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from typing import Iterator

from ...core.codec import decode_events, encode_event
from ...core.contracts import ContractError, RunEvent, RunSnapshot, TaskContract, WorkItem
from ...core.contracts import AuditDecision, BackendEvent, HumanDecision, RoleResult
from ...core.reducer import apply_event, create_snapshot, replay


SAFE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")


class LeaseConflict(ContractError):
    """Raised when another controller owns a non-expired run lease."""


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ContractError(f"missing run file: {path.name}") from error
    except json.JSONDecodeError as error:
        raise ContractError(f"invalid JSON in {path.name}: {error.msg}") from error


def _atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    except BaseException:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass
        raise


@dataclass(frozen=True)
class TrellisRunStore:
    repo_root: Path
    task_dir: Path
    developer: str

    def __post_init__(self) -> None:
        root = self.repo_root.resolve()
        task = self.task_dir.resolve()
        tasks_root = (root / ".trellis" / "tasks").resolve()
        if not _inside(task, tasks_root) or task == tasks_root:
            raise ContractError("task_dir must identify one task under .trellis/tasks")
        if not SAFE_ID.fullmatch(self.developer):
            raise ContractError("developer contains unsafe path characters")
        object.__setattr__(self, "repo_root", root)
        object.__setattr__(self, "task_dir", task)

    def run_dir(self, run_id: str) -> Path:
        if not SAFE_ID.fullmatch(run_id):
            raise ContractError("run_id contains unsafe path characters")
        path = (self.task_dir / "runs" / run_id).resolve()
        runs_root = (self.task_dir / "runs").resolve()
        if not _inside(path, runs_root):
            raise ContractError("run path escapes task runs directory")
        return path

    def trace_dir(self, run_id: str) -> Path:
        self.run_dir(run_id)
        return self.repo_root / ".trellis" / "workspace" / self.developer / "traces" / run_id

    def create(
        self,
        run_id: str,
        contract: TaskContract,
        work_items: list[WorkItem],
        *,
        max_rounds: int = 20,
        retry_limit: int = 2,
    ) -> RunSnapshot:
        directory = self.run_dir(run_id)
        directory.mkdir(parents=True, exist_ok=False)
        snapshot = create_snapshot(run_id, contract, work_items, max_rounds=max_rounds, retry_limit=retry_limit)
        _atomic_json(directory / "contract.json", contract.to_dict())
        _atomic_json(directory / "initial.json", snapshot.to_dict())
        _atomic_json(directory / "state.json", snapshot.to_dict())
        for name in ("events.jsonl", "rounds.jsonl", "decisions.jsonl"):
            (directory / name).write_text("", encoding="utf-8", newline="\n")
        (directory / "work-items").mkdir()
        (directory / "audits").mkdir()
        return snapshot

    def load(self, run_id: str, *, repair_stale_snapshot: bool = True) -> RunSnapshot:
        directory = self.run_dir(run_id)
        initial = RunSnapshot.from_dict(_read_json(directory / "initial.json"))
        if initial.run_id != run_id:
            raise ContractError("initial snapshot run_id mismatch")
        event_path = directory / "events.jsonl"
        try:
            lines = event_path.read_text(encoding="utf-8").splitlines()
        except FileNotFoundError as error:
            raise ContractError("missing run file: events.jsonl") from error
        reconstructed = replay(initial, decode_events(lines))
        persisted = RunSnapshot.from_dict(_read_json(directory / "state.json"))
        if persisted.run_id != run_id:
            raise ContractError("state snapshot run_id mismatch")
        if persisted.version > reconstructed.version:
            raise ContractError("state snapshot is ahead of the authoritative event log")
        if persisted != reconstructed:
            if not repair_stale_snapshot:
                raise ContractError("state snapshot does not match event replay")
            _atomic_json(directory / "state.json", reconstructed.to_dict())
        return reconstructed

    def append(self, event: RunEvent, *, owner: str, lease_seconds: int = 30) -> RunSnapshot:
        self.run_dir(event.run_id)
        with self.lease(event.run_id, owner=owner, lease_seconds=lease_seconds):
            current = self.load(event.run_id)
            updated = apply_event(current, event)
            if updated is current:
                return current
            event_path = self.run_dir(event.run_id) / "events.jsonl"
            with event_path.open("a", encoding="utf-8", newline="\n") as handle:
                handle.write(encode_event(event) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            _atomic_json(self.run_dir(event.run_id) / "state.json", updated.to_dict())
            return updated

    def record_role_result(self, run_id: str, result: RoleResult) -> None:
        if result.work_item_id not in self.load(run_id).work_items:
            raise ContractError(f"unknown work item: {result.work_item_id}")
        directory = self._record_directory(run_id, "work-items", result.work_item_id)
        _atomic_json(directory / f"attempt-{result.attempt}.json", result.to_dict())

    def load_role_result(self, run_id: str, work_item_id: str, attempt: int) -> RoleResult:
        directory = self._record_directory(run_id, "work-items", work_item_id)
        return RoleResult.from_dict(_read_json(directory / f"attempt-{attempt}.json"))

    def record_audit(self, run_id: str, decision: AuditDecision) -> None:
        if decision.work_item_id not in self.load(run_id).work_items:
            raise ContractError(f"unknown work item: {decision.work_item_id}")
        directory = self._record_directory(run_id, "audits", decision.work_item_id)
        _atomic_json(directory / f"attempt-{decision.attempt}.json", decision.to_dict())

    def record_human_decision(self, run_id: str, decision: HumanDecision) -> None:
        self._append_jsonl(self.run_dir(run_id) / "decisions.jsonl", decision.to_dict())

    def record_round(self, run_id: str, value: dict[str, object]) -> None:
        self.load(run_id)
        self._append_jsonl(self.run_dir(run_id) / "rounds.jsonl", value)

    def record_backend_event(self, run_id: str, event: BackendEvent) -> None:
        self.load(run_id)
        directory = self.trace_dir(run_id)
        directory.mkdir(parents=True, exist_ok=True)
        self._append_jsonl(directory / "backend-events.jsonl", event.to_dict())

    def record_episode_trace(self, run_id: str, episode_id: str, value: dict[str, object]) -> Path:
        self.load(run_id)
        if not SAFE_ID.fullmatch(episode_id):
            raise ContractError("episode_id contains unsafe path characters")
        directory = self.trace_dir(run_id) / "episodes"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{episode_id}.json"
        _atomic_json(path, value)
        return path

    def read_events(self, run_id: str) -> tuple[RunEvent, ...]:
        path = self.run_dir(run_id) / "events.jsonl"
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except FileNotFoundError as error:
            raise ContractError("missing run file: events.jsonl") from error
        return tuple(decode_events(lines))

    def write_final_report(self, run_id: str, report: str) -> None:
        snapshot = self.load(run_id)
        if snapshot.state != "completed":
            raise ContractError("final report requires a completed run")
        if not report.strip():
            raise ContractError("final report must not be empty")
        path = self.run_dir(run_id) / "final-report.md"
        descriptor, temp_name = tempfile.mkstemp(prefix=".final-report.", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(report.rstrip() + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, path)
        except BaseException:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
            raise

    @staticmethod
    def _append_jsonl(path: Path, value: object) -> None:
        with path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    def _record_directory(self, run_id: str, category: str, work_item_id: str) -> Path:
        if category not in {"work-items", "audits"}:
            raise ContractError("unknown record category")
        if not SAFE_ID.fullmatch(work_item_id):
            raise ContractError("work_item_id contains unsafe path characters")
        directory = (self.run_dir(run_id) / category / work_item_id).resolve()
        category_root = (self.run_dir(run_id) / category).resolve()
        if not _inside(directory, category_root):
            raise ContractError("record path escapes run directory")
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    @contextmanager
    def lease(self, run_id: str, *, owner: str, lease_seconds: int = 30) -> Iterator[None]:
        if not SAFE_ID.fullmatch(owner):
            raise ContractError("lease owner contains unsafe path characters")
        if lease_seconds < 1:
            raise ContractError("lease_seconds must be positive")
        path = self.run_dir(run_id) / ".lease.json"
        expires = _utc_now() + timedelta(seconds=lease_seconds)
        payload = {"owner": owner, "expires_at": expires.isoformat()}
        while True:
            try:
                descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                existing = _read_json(path)
                if not isinstance(existing, dict) or not isinstance(existing.get("expires_at"), str):
                    raise LeaseConflict("run lease is malformed")
                try:
                    existing_expiry = datetime.fromisoformat(existing["expires_at"])
                except ValueError as error:
                    raise LeaseConflict("run lease expiry is malformed") from error
                if existing_expiry > _utc_now():
                    raise LeaseConflict(f"run lease is held by {existing.get('owner', 'unknown')}")
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
                continue
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(payload, handle, ensure_ascii=False)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            break
        try:
            yield
        finally:
            try:
                current = _read_json(path)
            except ContractError:
                current = None
            if isinstance(current, dict) and current.get("owner") == owner:
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
