"""Automatic Manager -> Executor wave -> independent Auditor supervisor."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping
from uuid import uuid4

from .adapters import EpisodeRequest, EpisodeResult, HostAdapter
from .adapters.claude import ClaudeAdapter
from .adapters.codex import CodexAdapter
from .audit_guard import WorkspaceDiff, diff_workspace, snapshot_workspace
from .config import RuntimeConfig
from .core.contracts import AuditDecision, ContractError, RoleResult, RunSnapshot, WorkItem
from .prompts import (
    ManagerDecision,
    build_auditor_prompt,
    build_executor_prompt,
    build_manager_prompt,
    parse_audit_decision,
    parse_manager_decision,
    parse_role_result,
)
from .service import ExpertTeamService


@dataclass(frozen=True)
class SupervisorOutcome:
    snapshot: RunSnapshot
    episodes: tuple[str, ...]


class ManagedRunSupervisor:
    def __init__(
        self,
        service: ExpertTeamService,
        config: RuntimeConfig,
        adapters: Mapping[str, HostAdapter] | None = None,
    ) -> None:
        self.service = service
        self.config = config
        self.adapters: Mapping[str, HostAdapter] = adapters or {
            "codex": CodexAdapter(),
            "claude": ClaudeAdapter(),
        }
        missing = {binding.host for binding in config.roles.values()} - set(self.adapters)
        if missing:
            raise ContractError(f"missing host adapters: {', '.join(sorted(missing))}")

    async def run(self, task_id: str, run_id: str) -> SupervisorOutcome:
        episodes: list[str] = []
        invalid_manager_outputs = 0
        self._reconcile_abandoned(task_id, run_id)
        while True:
            snapshot = self._snapshot(task_id, run_id)
            if snapshot.state in {"completed", "cancelled", "blocked", "needs_input", "proposed_complete"}:
                return SupervisorOutcome(snapshot, tuple(episodes))
            if snapshot.state in {"executing_wave", "auditing_wave"}:
                await self._resume_wave(task_id, run_id, episodes)
                continue
            if snapshot.state != "managing":
                raise ContractError(f"supervisor cannot advance from {snapshot.state}")
            manager = self.config.role("manager")
            episode_id = self._episode_id(snapshot, "manager")
            episodes.append(episode_id)
            manager_result = await self._run_episode(
                task_id,
                run_id,
                self.adapters[manager.host],
                EpisodeRequest(
                    episode_id,
                    run_id,
                    max(1, snapshot.rounds_used + 1),
                    "manager",
                    "manager",
                    build_manager_prompt(snapshot, max_chars=manager.context_chars),
                    self.config.workspace,
                    manager.model,
                    manager.timeout_seconds,
                    manager.output_chars,
                ),
            )
            if manager_result.status == "permission_required":
                self.service.next(
                    task_id,
                    run_id,
                    "request_gate",
                    {"gate_type": "permission", "role": "manager", "episode_id": episode_id},
                )
                return SupervisorOutcome(self._snapshot(task_id, run_id), tuple(episodes))
            if manager_result.status != "done":
                invalid_manager_outputs += 1
                if invalid_manager_outputs >= snapshot.retry_limit:
                    self.service.next(task_id, run_id, "request_gate", {"gate_type": "repeated_failure"})
                    return SupervisorOutcome(self._snapshot(task_id, run_id), tuple(episodes))
                continue
            try:
                decision = parse_manager_decision(manager_result.visible_output, snapshot)
            except ContractError:
                invalid_manager_outputs += 1
                if invalid_manager_outputs >= snapshot.retry_limit:
                    self.service.next(task_id, run_id, "request_gate", {"gate_type": "repeated_failure"})
                    return SupervisorOutcome(self._snapshot(task_id, run_id), tuple(episodes))
                continue
            invalid_manager_outputs = 0
            terminal = self._apply_manager_decision(task_id, run_id, decision)
            if terminal:
                return SupervisorOutcome(self._snapshot(task_id, run_id), tuple(episodes))
            await self._execute_and_audit_wave(task_id, run_id, decision, episodes)
            after = self._snapshot(task_id, run_id)
            if after.state == "blocked":
                self.service.next(task_id, run_id, "request_gate", {"gate_type": "blocked"})
                return SupervisorOutcome(self._snapshot(task_id, run_id), tuple(episodes))
            if after.state == "auditing_wave":
                self.service.next(task_id, run_id, "manage", {})

    def _apply_manager_decision(
        self, task_id: str, run_id: str, decision: ManagerDecision
    ) -> bool:
        if decision.action == "execute":
            return False
        if decision.action == "ask":
            self.service.next(
                task_id,
                run_id,
                "request_gate",
                {
                    "gate_type": "ask",
                    "question": decision.message,
                    "manager_action": decision.action,
                    "manager_message": decision.message,
                    "work_item_ids": [],
                },
            )
        elif decision.action == "blocked":
            self.service.next(
                task_id,
                run_id,
                "request_gate",
                {
                    "gate_type": "blocked",
                    "reason": decision.message,
                    "manager_action": decision.action,
                    "manager_message": decision.message,
                    "work_item_ids": [],
                },
            )
        elif decision.action == "propose_complete":
            self.service.next(
                task_id,
                run_id,
                "request_gate",
                {
                    "gate_type": "completion",
                    "manager_action": decision.action,
                    "manager_message": decision.message,
                    "work_item_ids": [],
                },
            )
            if not self.config.human_completion_gate:
                self.service.answer(
                    task_id,
                    run_id,
                    {
                        "schema_version": 1,
                        "gate_type": "completion",
                        "decision": "approve",
                        "actor": "configured-policy",
                        "timestamp": utc_timestamp(),
                    },
                )
        else:
            self.service.cancel(
                task_id,
                run_id,
                {
                    "manager_action": decision.action,
                    "manager_message": decision.message,
                    "work_item_ids": [],
                },
            )
        return True

    async def _execute_and_audit_wave(
        self,
        task_id: str,
        run_id: str,
        decision: ManagerDecision,
        episodes: list[str],
    ) -> None:
        before = self._snapshot(task_id, run_id)
        assignments = {
            item_id: f"executor-{item_id}-{before.work_items[item_id].attempt + 1}-{uuid4().hex[:8]}"
            for item_id in decision.work_item_ids
        }
        self.service.next(
            task_id,
            run_id,
            "start_execution",
            {
                "work_item_ids": list(decision.work_item_ids),
                "assignments": assignments,
                "round": before.rounds_used + 1,
                "manager_action": decision.action,
                "manager_message": decision.message,
            },
        )
        active = self._snapshot(task_id, run_id)
        semaphore = asyncio.Semaphore(self.config.max_concurrency)

        async def execute(item_id: str) -> RoleResult:
            async with semaphore:
                item = active.work_items[item_id]
                binding = self.config.role("executor")
                episode_id = self._episode_id(active, "executor", item_id)
                episodes.append(episode_id)
                episode = await self._run_episode(
                    task_id,
                    run_id,
                    self.adapters[binding.host],
                    EpisodeRequest(
                        episode_id,
                        run_id,
                        active.rounds_used,
                        "executor",
                        item.role,
                        build_executor_prompt(active, item, executor_id=assignments[item_id], max_chars=binding.context_chars),
                        self.config.workspace,
                        binding.model,
                        binding.timeout_seconds,
                        binding.output_chars,
                        work_item_id=item.id,
                    ),
                )
                if episode.status == "done":
                    try:
                        return parse_role_result(episode.visible_output, item=item, executor_id=assignments[item_id])
                    except ContractError as error:
                        return self._failed_result(item, assignments[item_id], str(error))
                return self._failed_result(item, assignments[item_id], episode.error or episode.status)

        results = await asyncio.gather(*(execute(item_id) for item_id in decision.work_item_ids))
        by_id = {result.work_item_id: result for result in results}
        for result in results:
            self.service.submit_result(task_id, run_id, result.to_dict())
        self.service.next(task_id, run_id, "start_audit", {})
        for item_id in decision.work_item_ids:
            audit_snapshot = self._snapshot(task_id, run_id)
            item = audit_snapshot.work_items[item_id]
            result = by_id[item_id]
            decision_value, episode_id = await self._audit_item(task_id, run_id, audit_snapshot, item, result)
            episodes.append(episode_id)
            self.service.submit_audit(task_id, run_id, decision_value.to_dict())

    async def _audit_item(
        self,
        task_id: str,
        run_id: str,
        snapshot: RunSnapshot,
        item: WorkItem,
        result: RoleResult,
    ) -> tuple[AuditDecision, str]:
        binding = self.config.role("auditor")
        episode_id = self._episode_id(snapshot, "auditor", item.id)
        auditor_id = f"auditor-{item.id}-{item.attempt}-{uuid4().hex[:8]}"
        before = snapshot_workspace(self.config.workspace)
        episode = await self._run_episode(
            task_id,
            run_id,
            self.adapters[binding.host],
            EpisodeRequest(
                episode_id,
                run_id,
                snapshot.rounds_used,
                "auditor",
                "independent-auditor",
                build_auditor_prompt(snapshot, item, result, auditor_id=auditor_id, max_chars=binding.context_chars),
                self.config.workspace,
                binding.model,
                binding.timeout_seconds,
                binding.output_chars,
                read_only=True,
                work_item_id=item.id,
            ),
        )
        integrity = diff_workspace(before, snapshot_workspace(self.config.workspace))
        if episode.status == "done":
            try:
                parsed = parse_audit_decision(
                    episode.visible_output,
                    item=item,
                    executor_id=result.executor_id,
                    auditor_id=auditor_id,
                )
            except ContractError as error:
                parsed = self._invalid_audit(item, result.executor_id, auditor_id, str(error), integrity)
        else:
            parsed = self._invalid_audit(item, result.executor_id, auditor_id, episode.error or episode.status, integrity)
        if not integrity.clean:
            parsed = self._invalid_audit(item, result.executor_id, auditor_id, "Auditor workspace integrity failed", integrity)
        return parsed, episode_id

    async def _run_episode(
        self,
        task_id: str,
        run_id: str,
        adapter: HostAdapter,
        request: EpisodeRequest,
    ) -> EpisodeResult:
        base_payload = {"episode_id": request.episode_id, "role": request.role, "host": adapter.host}
        if request.work_item_id is not None:
            base_payload["work_item_id"] = request.work_item_id
        self.service.record_episode_event(task_id, run_id, "episode.started", base_payload)
        result = await adapter.run_episode(request)
        for event in result.events:
            self.service.record_backend_event(task_id, run_id, event)
        trace_ref = self.service.record_episode_trace(
            task_id,
            run_id,
            request.episode_id,
            {
                "episode_id": request.episode_id,
                "host": result.host,
                "role": result.role,
                "status": result.status,
                "duration_ms": result.duration_ms,
                "exit_code": result.exit_code,
                "error": result.error,
                "stdout": result.raw_stdout,
                "stderr": result.raw_stderr,
                "metadata": dict(result.metadata),
            },
        )
        terminal_kind = {
            "done": "episode.completed",
            "error": "episode.failed",
            "permission_required": "episode.failed",
            "timeout": "episode.timeout",
            "cancelled": "episode.cancelled",
        }[result.status]
        self.service.record_episode_event(
            task_id,
            run_id,
            terminal_kind,
            {**base_payload, "status": result.status, "trace_ref": trace_ref},
        )
        return result

    def _reconcile_abandoned(self, task_id: str, run_id: str) -> None:
        active: dict[str, dict[str, object]] = {}
        for event in self.service.events(task_id, run_id):
            if not event.kind.startswith("episode."):
                continue
            episode_id = event.payload.get("episode_id")
            if not isinstance(episode_id, str):
                continue
            if event.kind == "episode.started":
                active[episode_id] = dict(event.payload)
            else:
                active.pop(episode_id, None)
        for payload in active.values():
            self.service.record_episode_event(
                task_id,
                run_id,
                "episode.abandoned",
                {**payload, "reason": "controller restarted before terminal episode event"},
            )

    async def _resume_wave(self, task_id: str, run_id: str, episodes: list[str]) -> None:
        snapshot = self._snapshot(task_id, run_id)
        if snapshot.state == "executing_wave":
            if any(item.status == "running" for item in snapshot.work_items.values()):
                raise ContractError("cannot reconcile running work item without episode.started event")
            submitted = [item for item in snapshot.work_items.values() if item.status == "submitted"]
            if not submitted:
                self.service.next(task_id, run_id, "manage", {})
                return
            self.service.next(task_id, run_id, "start_audit", {})
            snapshot = self._snapshot(task_id, run_id)
        pending = [item for item in snapshot.work_items.values() if item.status == "auditing"]
        for item in pending:
            result = self.service.load_role_result(task_id, run_id, item.id, item.attempt)
            current = self._snapshot(task_id, run_id)
            decision, episode_id = await self._audit_item(task_id, run_id, current, current.work_items[item.id], result)
            episodes.append(episode_id)
            self.service.submit_audit(task_id, run_id, decision.to_dict())
        after = self._snapshot(task_id, run_id)
        if after.state == "auditing_wave":
            self.service.next(task_id, run_id, "manage", {})
        elif after.state == "blocked":
            self.service.next(task_id, run_id, "request_gate", {"gate_type": "blocked"})

    def _snapshot(self, task_id: str, run_id: str) -> RunSnapshot:
        return RunSnapshot.from_dict(self.service.status(task_id, run_id))

    @staticmethod
    def _episode_id(snapshot: RunSnapshot, role: str, item_id: str | None = None) -> str:
        suffix = f"-{item_id}" if item_id else ""
        return f"r{max(1, snapshot.rounds_used + (role == 'manager'))}-{role}{suffix}-{uuid4().hex[:8]}"

    @staticmethod
    def _failed_result(item: WorkItem, executor_id: str, failure: str) -> RoleResult:
        return RoleResult.from_dict(
            {
                "schema_version": 1,
                "work_item_id": item.id,
                "attempt": item.attempt,
                "executor_id": executor_id,
                "summary": "Executor episode failed",
                "artifacts": [],
                "evidence": [],
                "checks": [],
                "risks": ["unverified episode failure"],
                "failure": failure,
            }
        )

    @staticmethod
    def _invalid_audit(
        item: WorkItem,
        executor_id: str,
        auditor_id: str,
        finding: str,
        integrity: WorkspaceDiff,
    ) -> AuditDecision:
        details = [finding]
        if not integrity.clean:
            details.append(
                "workspace diff: "
                f"added={list(integrity.added)}, deleted={list(integrity.deleted)}, "
                f"changed={list(integrity.changed)}, type_changed={list(integrity.type_changed)}, "
                f"errors={list(integrity.errors)}"
            )
        return AuditDecision.from_dict(
            {
                "schema_version": 1,
                "work_item_id": item.id,
                "attempt": item.attempt,
                "auditor_id": auditor_id,
                "executor_id": executor_id,
                "status": "invalid",
                "integrity": "dirty" if not integrity.clean else "clean",
                "contract_alignment": "misaligned",
                "evidence": [],
                "findings": details,
                "required_rework": ["Run a valid independent audit"],
            }
        )


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()
