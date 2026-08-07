from __future__ import annotations

import asyncio
import json
from pathlib import Path
import re
import tempfile
import unittest
from typing import Literal

from runtime.adapters.base import (
    CancellationResult,
    EpisodeRequest,
    EpisodeResult,
    HostCapabilities,
)
from runtime.config import RoleConfig, RuntimeConfig
from runtime.service import ExpertTeamService
from runtime.supervisor import ManagedRunSupervisor


class ScriptedAdapter:
    host: Literal["codex"] = "codex"

    def __init__(
        self,
        *,
        invalid_manager: bool = False,
        mutate_during_audit: bool = False,
        manager_permission: bool = False,
    ) -> None:
        self.invalid_manager = invalid_manager
        self.mutate_during_audit = mutate_during_audit
        self.manager_permission = manager_permission
        self.requests: list[EpisodeRequest] = []

    async def probe(self) -> HostCapabilities:
        return HostCapabilities("codex", True, "fake", "fake 1")

    async def cancel(self, episode_id: str) -> CancellationResult:
        return CancellationResult(episode_id, False, False)

    async def run_episode(self, request: EpisodeRequest, event_sink=None, cancellation=None) -> EpisodeResult:
        self.requests.append(request)
        if request.role == "manager" and self.manager_permission:
            return EpisodeResult(
                request.episode_id,
                "codex",
                request.role,
                "permission_required",
                "",
                (),
                1,
                1,
                error="approval required",
            )
        if request.role == "manager":
            if self.invalid_manager:
                output = "not-json"
            elif '"id":"build"' in request.prompt:
                output = json.dumps({"schema_version": 1, "action": "execute", "work_item_ids": ["build"], "message": "first"})
            elif '"id":"verify"' in request.prompt:
                output = json.dumps({"schema_version": 1, "action": "execute", "work_item_ids": ["verify"], "message": "second"})
            else:
                output = json.dumps({"schema_version": 1, "action": "propose_complete", "work_item_ids": [], "message": "done"})
        elif request.role == "executor":
            assert request.work_item_id is not None
            item_id = request.work_item_id
            executor_id = _json_string(request.prompt, "executor_id")
            attempt = _json_integer(request.prompt, "attempt")
            output = json.dumps(
                {
                    "schema_version": 1,
                    "work_item_id": item_id,
                    "attempt": attempt,
                    "executor_id": executor_id,
                    "summary": "done",
                    "artifacts": [],
                    "evidence": [f"evidence:{item_id}"],
                    "checks": ["checked"],
                    "risks": [],
                }
            )
        else:
            if self.mutate_during_audit:
                (request.workspace / f"auditor-mutated-{len(self.requests)}.txt").write_text("forbidden", encoding="utf-8")
            payload = json.loads(request.prompt.split("\n")[-1])
            result = payload["executor_result"]
            output = json.dumps(
                {
                    "schema_version": 1,
                    "work_item_id": result["work_item_id"],
                    "attempt": result["attempt"],
                    "auditor_id": payload["auditor_id"],
                    "executor_id": result["executor_id"],
                    "status": "accepted",
                    "integrity": "clean",
                    "contract_alignment": "aligned",
                    "evidence": result["evidence"],
                    "findings": [],
                    "required_rework": [],
                }
            )
        return EpisodeResult(request.episode_id, "codex", request.role, "done", output, (), 1, 0)


def _json_string(prompt: str, name: str) -> str:
    match = re.search(rf'"{name}":"([^"]+)"', prompt)
    assert match is not None
    return match.group(1)


def _json_integer(prompt: str, name: str) -> int:
    match = re.search(rf'"{name}":(\d+)', prompt)
    assert match is not None
    return int(match.group(1))


class SupervisorTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.task = self.root / ".trellis" / "tasks" / "08-07-example"
        self.task.mkdir(parents=True)
        (self.task / "task.json").write_text(
            json.dumps({"id": "example", "name": "example", "status": "in_progress"}),
            encoding="utf-8",
        )
        self.service = ExpertTeamService(self.root, developer="tester")
        contract = {"schema_version": 1, "goal": "two rounds", "constraints": [], "deliverables": ["out"], "acceptance_criteria": ["audited"]}
        items = [
            {"schema_version": 1, "id": "build", "objective": "build", "role": "coder", "mode": "write", "required": True, "depends_on": [], "ownership": ["src"], "evidence_required": ["evidence"]},
            {"schema_version": 1, "id": "verify", "objective": "verify", "role": "reviewer", "mode": "verify", "required": True, "depends_on": ["build"], "ownership": [], "evidence_required": ["evidence"]},
        ]
        self.service.start("example", "run-1", contract, items, max_rounds=4, retry_limit=2)
        role = RoleConfig("codex", None, 5, 20_000, 20_000)
        self.config = RuntimeConfig(self.root, 4, 2, 2, True, {"manager": role, "executor": role, "auditor": role})

    async def asyncSetUp(self) -> None:
        asyncio.get_running_loop().slow_callback_duration = 1.0

    def tearDown(self) -> None:
        self.temporary.cleanup()

    async def test_one_run_call_drives_two_complete_rounds_and_opens_completion_gate(self) -> None:
        adapter = ScriptedAdapter()
        outcome = await ManagedRunSupervisor(self.service, self.config, {"codex": adapter}).run("example", "run-1")
        self.assertEqual("proposed_complete", outcome.snapshot.state)
        self.assertEqual({"build", "verify"}, set(outcome.snapshot.verified_progress))
        self.assertEqual(2, outcome.snapshot.rounds_used)
        self.assertEqual(7, len(adapter.requests))
        self.assertEqual(7, len({request.episode_id for request in adapter.requests}))
        self.assertTrue(all(request.read_only for request in adapter.requests if request.role == "auditor"))
        trace_dir = self.root / ".trellis" / "workspace" / "tester" / "traces" / "run-1" / "episodes"
        self.assertEqual(7, len(list(trace_dir.glob("*.json"))))

    async def test_repeated_invalid_manager_output_opens_gate_without_execution(self) -> None:
        adapter = ScriptedAdapter(invalid_manager=True)
        outcome = await ManagedRunSupervisor(self.service, self.config, {"codex": adapter}).run("example", "run-1")
        self.assertEqual("needs_input", outcome.snapshot.state)
        self.assertEqual("repeated_failure", outcome.snapshot.pending_gate)
        self.assertEqual(0, outcome.snapshot.rounds_used)
        self.assertEqual(["manager", "manager"], [request.role for request in adapter.requests])

    async def test_manager_permission_request_opens_explicit_gate(self) -> None:
        adapter = ScriptedAdapter(manager_permission=True)
        outcome = await ManagedRunSupervisor(self.service, self.config, {"codex": adapter}).run("example", "run-1")
        self.assertEqual("needs_input", outcome.snapshot.state)
        self.assertEqual("permission", outcome.snapshot.pending_gate)

    async def test_completion_gate_can_be_approved_by_configured_policy(self) -> None:
        adapter = ScriptedAdapter()
        config = RuntimeConfig(
            self.root,
            4,
            2,
            2,
            False,
            self.config.roles,
        )
        outcome = await ManagedRunSupervisor(self.service, config, {"codex": adapter}).run("example", "run-1")
        self.assertEqual("completed", outcome.snapshot.state)

    async def test_auditor_workspace_mutation_rejects_acceptance_fail_closed(self) -> None:
        adapter = ScriptedAdapter(mutate_during_audit=True)
        outcome = await ManagedRunSupervisor(self.service, self.config, {"codex": adapter}).run("example", "run-1")
        self.assertEqual("needs_input", outcome.snapshot.state)
        self.assertEqual("blocked", outcome.snapshot.pending_gate)
        self.assertNotIn("build", outcome.snapshot.verified_progress)
        audit_path = self.task / "runs" / "run-1" / "audits" / "build" / "attempt-2.json"
        audit = json.loads(audit_path.read_text(encoding="utf-8"))
        self.assertEqual("invalid", audit["status"])
        self.assertEqual("dirty", audit["integrity"])

    async def test_restart_marks_inflight_executor_abandoned_and_retries_without_accepting_it(self) -> None:
        self.service.next(
            "example",
            "run-1",
            "start_execution",
            {"work_item_ids": ["build"], "executor_id": "executor-abandoned"},
        )
        self.service.record_episode_event(
            "example",
            "run-1",
            "episode.started",
            {
                "episode_id": "abandoned-episode",
                "role": "executor",
                "host": "codex",
                "work_item_id": "build",
            },
        )
        adapter = ScriptedAdapter()
        outcome = await ManagedRunSupervisor(self.service, self.config, {"codex": adapter}).run("example", "run-1")
        self.assertEqual("proposed_complete", outcome.snapshot.state)
        self.assertEqual(2, outcome.snapshot.work_items["build"].attempt)
        abandoned = [event for event in self.service.events("example", "run-1") if event.kind == "episode.abandoned"]
        self.assertEqual(1, len(abandoned))
        self.assertEqual("abandoned-episode", abandoned[0].payload["episode_id"])


if __name__ == "__main__":
    unittest.main()
