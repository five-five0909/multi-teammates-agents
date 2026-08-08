from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from runtime.console import build_run_summary, render_narrative
from runtime.server.mcp_stdio import MCPServer
from runtime.service import ExpertTeamService


CONTRACT = {
    "schema_version": 1,
    "goal": "Render a safe console summary",
    "constraints": [],
    "deliverables": ["summary"],
    "acceptance_criteria": ["audited"],
}
ITEM = {
    "schema_version": 1,
    "id": "inspect",
    "objective": "Inspect the source",
    "role": "source-inspector",
    "mode": "read",
    "required": True,
    "depends_on": [],
    "ownership": [],
    "evidence_required": ["source"],
}


class ConsoleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.task = self.root / ".trellis" / "tasks" / "08-08-console"
        self.task.mkdir(parents=True)
        (self.task / "task.json").write_text(
            '{"id":"console","name":"console","status":"in_progress"}',
            encoding="utf-8",
        )
        self.service = ExpertTeamService(self.root, developer="console-test")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_completed_summary_has_public_manager_executor_auditor_and_refs(self) -> None:
        self.service.start("console", "completed", CONTRACT, [ITEM])
        self.service.next(
            "console",
            "completed",
            "start_execution",
            {
                "work_item_ids": ["inspect"],
                "executor_id": "executor-inspect",
                "round": 1,
                "manager_action": "execute",
                "manager_message": "Inspect the source before verification token=abc123",
            },
        )
        self.service.record_episode_event(
            "console",
            "completed",
            "episode.started",
            {"episode_id": "executor-episode", "role": "executor", "host": "codex", "work_item_id": "inspect"},
        )
        self.service.record_episode_event(
            "console",
            "completed",
            "episode.completed",
            {
                "episode_id": "executor-episode",
                "role": "executor",
                "host": "codex",
                "work_item_id": "inspect",
                "status": "done",
                "trace_ref": ".trellis/workspace/console-test/traces/completed/episodes/executor-episode.json",
            },
        )
        self.service.submit_result(
            "console",
            "completed",
            {
                "schema_version": 1,
                "work_item_id": "inspect",
                "attempt": 1,
                "executor_id": "executor-inspect",
                "summary": "Found the requested source",
                "artifacts": [],
                "evidence": ["source:line-1"],
                "checks": ["read"],
                "risks": [],
            },
        )
        self.service.next("console", "completed", "start_audit", {})
        self.service.record_episode_event(
            "console",
            "completed",
            "episode.started",
            {"episode_id": "auditor-episode", "role": "auditor", "host": "codex", "work_item_id": "inspect"},
        )
        self.service.record_episode_event(
            "console",
            "completed",
            "episode.completed",
            {"episode_id": "auditor-episode", "role": "auditor", "host": "codex", "work_item_id": "inspect", "status": "done"},
        )
        self.service.submit_audit(
            "console",
            "completed",
            {
                "schema_version": 1,
                "work_item_id": "inspect",
                "attempt": 1,
                "auditor_id": "auditor-inspect",
                "executor_id": "executor-inspect",
                "status": "accepted",
                "integrity": "clean",
                "contract_alignment": "aligned",
                "evidence": ["source:line-1"],
                "findings": [],
                "required_rework": [],
            },
        )
        self.service.next("console", "completed", "request_gate", {"gate_type": "completion"})
        self.service.answer(
            "console",
            "completed",
            {
                "schema_version": 1,
                "gate_type": "completion",
                "decision": "approve",
                "actor": "host",
                "timestamp": "2026-08-08T00:00:00Z",
                "provenance": {"schema_version": 1, "gate_type": "completion", "actor": "host", "source": "host_single_select", "verification": "host_reported", "timestamp": "2026-08-08T00:00:00Z", "source_event_id": "evt-console"},
            },
        )

        summary = build_run_summary(self.service, "console", "completed")
        narrative = render_narrative(summary)
        self.assertEqual("completed", summary["state"])
        self.assertIn("Manager (manager)", narrative)
        self.assertIn("Executor · source-inspector · inspect", narrative)
        self.assertIn("Auditor · independent-auditor · accepted", narrative)
        self.assertIn("state_file", narrative)
        self.assertNotIn("stdout", narrative)
        self.assertNotIn("command", narrative)
        self.assertNotIn("abc123", narrative)

    def test_blocked_and_pending_gate_states_render_without_round_metadata(self) -> None:
        self.service.start("console", "blocked", CONTRACT, [ITEM])
        self.service.next("console", "blocked", "block", {})
        blocked = build_run_summary(self.service, "console", "blocked")
        self.assertEqual("blocked", blocked["state"])
        self.assertIn("No round narrative recorded", render_narrative(blocked))

        self.service.start("console", "rework", CONTRACT, [ITEM])
        self.service.next(
            "console",
            "rework",
            "start_execution",
            {
                "work_item_ids": ["inspect"],
                "executor_id": "executor-rework",
                "round": 1,
                "manager_action": "execute",
                "manager_message": "Retry after an incomplete first pass",
            },
        )
        self.service.submit_result(
            "console",
            "rework",
            {
                "schema_version": 1,
                "work_item_id": "inspect",
                "attempt": 1,
                "executor_id": "executor-rework",
                "summary": "Incomplete first pass",
                "artifacts": [],
                "evidence": [],
                "checks": [],
                "risks": ["missing evidence"],
            },
        )
        self.service.next("console", "rework", "start_audit", {})
        self.service.submit_audit(
            "console",
            "rework",
            {
                "schema_version": 1,
                "work_item_id": "inspect",
                "attempt": 1,
                "auditor_id": "auditor-rework",
                "executor_id": "executor-rework",
                "status": "rework",
                "integrity": "clean",
                "contract_alignment": "misaligned",
                "evidence": [],
                "findings": ["Evidence is incomplete"],
                "required_rework": ["Add source evidence"],
            },
        )
        self.service.next("console", "rework", "manage", {})
        rework = build_run_summary(self.service, "console", "rework")
        rework_narrative = render_narrative(rework)
        self.assertIn("Auditor · independent-auditor · rework", rework_narrative)
        self.assertIn("Rework: Add source evidence", rework_narrative)

        self.service.start("console", "pending", CONTRACT, [ITEM])
        self.service.next("console", "pending", "request_gate", {"gate_type": "ask", "question": "Need input"})
        pending = build_run_summary(self.service, "console", "pending")
        self.assertEqual("needs_input", pending["state"])
        self.assertEqual("ask", pending["pending_gate"])
        self.assertIn("Pending gate: ask", render_narrative(pending))

    def test_mcp_run_returns_narrative_as_text_and_projection_as_structured_content(self) -> None:
        server = MCPServer(self.service)
        server.handlers["expert_team_run"] = lambda **_: {"narrative": "public narrative", "console": {"state": "completed"}}
        response = server.dispatch(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "expert_team_run", "arguments": {"task_id": "console", "run_id": "completed"}},
            }
        )
        assert response is not None
        result = response["result"]
        self.assertEqual("public narrative", result["content"][0]["text"])
        self.assertEqual("completed", result["structuredContent"]["console"]["state"])


if __name__ == "__main__":
    unittest.main()
