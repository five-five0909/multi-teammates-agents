from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from runtime.server.mcp_stdio import MCPServer, TOOL_SCHEMAS
from runtime.service import ExpertTeamService
from runtime.core.contracts import BackendEvent, ContractError
from runtime.core.contracts import RunSnapshot
from runtime.prompts import build_manager_prompt


class ServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.task = self.root / ".trellis" / "tasks" / "08-07-example"
        self.task.mkdir(parents=True)
        (self.task / "task.json").write_text(json.dumps({"id": "example", "name": "example", "status": "in_progress"}), encoding="utf-8")
        self.service = ExpertTeamService(self.root, developer="tester")
        self.contract = {"schema_version": 1, "goal": "Complete with audit", "constraints": [], "deliverables": ["report"], "acceptance_criteria": ["accepted"]}
        self.items = [{"schema_version": 1, "id": "research", "objective": "Research", "role": "researcher", "mode": "read", "required": True, "depends_on": [], "ownership": [], "evidence_required": ["source"]}]

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_managed_service_full_lifecycle_and_compact_resume(self) -> None:
        started = self.service.start("example", "run-1", self.contract, self.items)
        self.assertEqual("managing", started["state"])
        self.service.next("example", "run-1", "start_execution", {"work_item_ids": ["research"], "executor_id": "executor-1"})
        result = {"schema_version": 1, "work_item_id": "research", "attempt": 1, "executor_id": "executor-1", "summary": "Found source", "artifacts": [], "evidence": ["source-1"], "checks": ["read source"], "risks": []}
        self.service.submit_result("example", "run-1", result)
        self.service.next("example", "run-1", "start_audit", {})
        audit = {"schema_version": 1, "work_item_id": "research", "attempt": 1, "auditor_id": "auditor-1", "executor_id": "executor-1", "status": "accepted", "integrity": "clean", "contract_alignment": "aligned", "evidence": ["source-1"], "findings": [], "required_rework": []}
        self.service.submit_audit("example", "run-1", audit)
        resume = self.service.resume("example", "run-1")
        self.assertEqual({"research": ["source-1"]}, resume["verified_progress"])
        self.assertEqual([], resume["unresolved_work"])
        self.assertNotIn("event_ids", resume)
        self.service.next("example", "run-1", "request_gate", {"gate_type": "completion"})
        decision = {"schema_version": 1, "gate_type": "completion", "decision": "approve", "actor": "user", "timestamp": "2026-08-07T00:00:00Z"}
        final = self.service.answer("example", "run-1", decision)
        self.assertEqual("completed", final["state"])
        run_dir = self.task / "runs" / "run-1"
        self.assertEqual(1, len((run_dir / "rounds.jsonl").read_text(encoding="utf-8").splitlines()))
        report = (run_dir / "final-report.md").read_text(encoding="utf-8")
        self.assertIn("Verified progress", report)
        self.assertIn("source-1", report)

    def test_schema_catalog_is_valid_json(self) -> None:
        schema_dir = Path(__file__).resolve().parents[1] / "schemas" / "v1"
        index = json.loads((schema_dir / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(1, index["schema_version"])
        for name in index["schemas"].values():
            value = json.loads((schema_dir / name).read_text(encoding="utf-8"))
            self.assertFalse(value["additionalProperties"])
            self.assertEqual("https://json-schema.org/draft/2020-12/schema", value["$schema"])

    def test_start_rejects_planning_task_and_coordinator_executor(self) -> None:
        metadata_path = self.task / "task.json"
        metadata_path.write_text(json.dumps({"id": "example", "name": "example", "status": "planning"}), encoding="utf-8")
        with self.assertRaisesRegex(ContractError, "in_progress"):
            self.service.start("example", "run-1", self.contract, self.items)
        metadata_path.write_text(json.dumps({"id": "example", "name": "example", "status": "in_progress"}), encoding="utf-8")
        coordinator = [{**self.items[0], "role": "software-team-lead"}]
        with self.assertRaisesRegex(ContractError, "coordinator profiles"):
            self.service.start("example", "run-1", self.contract, coordinator)

    def test_host_events_are_normalized_into_separate_trace(self) -> None:
        self.service.start("example", "run-1", self.contract, self.items)
        codex = self.service.record_host_event("example", "run-1", "codex", "executor", {"type": "item.completed", "thread_id": "thread-1", "item": {"id": "item-1", "type": "command_execution", "command": "python -m unittest"}})
        claude = self.service.record_host_event("example", "run-1", "claude", "auditor", {"type": "permission_request", "uuid": "permission-1"})
        self.assertEqual("codex", codex["host"])
        self.assertEqual("permission_required", claude["status"])
        trace = self.root / ".trellis" / "workspace" / "tester" / "traces" / "run-1" / "backend-events.jsonl"
        self.assertEqual(2, len(trace.read_text(encoding="utf-8").splitlines()))

    def test_durable_diagnostics_redact_secrets_at_service_boundary(self) -> None:
        self.service.start("example", "run-1", {**self.contract, "goal": "Ship secret=super-secret"}, self.items)
        sanitized_snapshot = RunSnapshot.from_dict(self.service.status("example", "run-1"))
        self.assertNotIn("super-secret", build_manager_prompt(sanitized_snapshot, max_chars=4_000))
        self.service.record_episode_trace(
            "example",
            "run-1",
            "episode-1",
            {"stdout": "API_KEY=super-secret", "metadata": {"token": "sk-live-secret"}},
        )
        self.service.record_backend_event(
            "example",
            "run-1",
            BackendEvent.from_dict(
                {
                    "schema_version": 1,
                    "host": "codex",
                    "role": "manager",
                    "action": "secret=super-secret",
                    "status": "progress",
                    "source_id": "sk-live-secret",
                    "references": ["password=hunter2"],
                }
            ),
        )
        self.service.next("example", "run-1", "start_execution", {"work_item_ids": ["research"], "executor_id": "executor-1"})
        self.service.submit_result(
            "example",
            "run-1",
            {
                "schema_version": 1,
                "work_item_id": "research",
                "attempt": 1,
                "executor_id": "executor-1",
                "summary": "done",
                "artifacts": [],
                "evidence": ["API_KEY=super-secret"],
                "checks": [],
                "risks": [],
            },
        )
        self.service.next("example", "run-1", "start_audit", {})
        self.service.submit_audit(
            "example",
            "run-1",
            {
                "schema_version": 1,
                "work_item_id": "research",
                "attempt": 1,
                "auditor_id": "auditor-1",
                "executor_id": "executor-1",
                "status": "accepted",
                "integrity": "clean",
                "contract_alignment": "aligned",
                "evidence": ["API_KEY=super-secret"],
                "findings": [],
                "required_rework": [],
            },
        )
        self.service.next("example", "run-1", "request_gate", {"gate_type": "completion"})
        self.service.answer(
            "example",
            "run-1",
            {
                "schema_version": 1,
                "gate_type": "completion",
                "decision": "approve",
                "actor": "user",
                "timestamp": "2026-08-08T00:00:00Z",
            },
        )
        contents = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (self.task / "runs" / "run-1").rglob("*")
            if path.is_file()
        )
        trace_contents = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (self.root / ".trellis" / "workspace").rglob("*")
            if path.is_file()
        )
        self.assertNotIn("super-secret", contents + trace_contents)
        self.assertNotIn("sk-live-secret", contents + trace_contents)
        self.assertNotIn("hunter2", contents + trace_contents)


class MCPProtocolTests(unittest.TestCase):
    def test_initialize_and_tools_list(self) -> None:
        server = MCPServer(ExpertTeamService(Path.cwd()))
        initialized = server.dispatch({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
        assert initialized is not None
        self.assertEqual("expert-team", initialized["result"]["serverInfo"]["name"])
        listed = server.dispatch({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        assert listed is not None
        self.assertEqual(set(TOOL_SCHEMAS), {tool["name"] for tool in listed["result"]["tools"]})

    def test_tool_contract_error_is_returned_as_tool_error(self) -> None:
        server = MCPServer(ExpertTeamService(Path.cwd()))
        response = server.dispatch({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "expert_team_status", "arguments": {"task_id": "missing", "run_id": "run-1"}}})
        assert response is not None
        self.assertTrue(response["result"]["isError"])

    def test_qualification_is_side_effect_free(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            server = MCPServer(ExpertTeamService(root))
            response = server.dispatch(
                {
                    "jsonrpc": "2.0",
                    "id": 4,
                    "method": "tools/call",
                    "params": {
                        "name": "expert_team_qualify",
                        "arguments": {"request": "Explain one function"},
                    },
                }
            )
            assert response is not None
            self.assertEqual("lightweight", response["result"]["structuredContent"]["execution_tier"])
            self.assertFalse((root / ".trellis").exists())


if __name__ == "__main__":
    unittest.main()
