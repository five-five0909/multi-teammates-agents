from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from runtime.core.contracts import ContractError
from runtime.routing import build_mode_assessment, qualify_execution_tier
from runtime.server.mcp_stdio import MCPServer
from runtime.service import ExpertTeamService


CONTRACT = {
    "schema_version": 1,
    "goal": "Ship an audited artifact",
    "constraints": [],
    "deliverables": ["artifact"],
    "acceptance_criteria": ["accepted"],
}
ITEMS = [
    {
        "schema_version": 1,
        "id": "research",
        "objective": "Research",
        "role": "researcher",
        "mode": "read",
        "required": True,
        "depends_on": [],
        "ownership": [],
        "evidence_required": ["source"],
    }
]


class EntryGateTests(unittest.TestCase):
    def test_policy_floor_cannot_be_lowered_by_legacy_lightweight(self) -> None:
        self.assertEqual("managed", qualify_execution_tier("Build", explicit="lightweight", durable_audit=True))
        assessment = build_mode_assessment(
            "Build",
            invocation_id="invocation",
            explicit="lightweight",
            task_status="in_progress",
            task_id="task",
        )
        self.assertEqual("managed", assessment.policy_floor)
        self.assertEqual(("managed",), assessment.allowed_tiers)
        self.assertEqual("policy_locked", assessment.decision_state)

    def test_selection_is_required_when_both_tiers_are_legal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            service = ExpertTeamService(Path(temporary), session_id="session")
            prepared = service.prepare("Explain one function", host_mode="inline", intent="analysis", source_event_id="evt-1")
            repeated = service.prepare("Explain one function", host_mode="inline", intent="analysis", invocation_id=prepared["invocation_id"], source_event_id="evt-1")
            self.assertEqual(prepared["assessment_fingerprint"], repeated["assessment_fingerprint"])
            self.assertEqual("selection_required", prepared["decision_state"])
            self.assertIsNone(prepared["execution_tier"])
            with self.assertRaisesRegex(ContractError, "mode_selection_required"):
                service.qualify(
                    "Explain one function",
                    invocation_id=prepared["invocation_id"],
                    contract=CONTRACT,
                    work_items=ITEMS,
                )

            with self.assertRaisesRegex(ContractError, "source_event_id"):
                service.select_mode(
                    prepared["invocation_id"],
                    "lightweight",
                    actor="user",
                    source="host_single_select",
                    verification="verified",
                )
            decision = service.select_mode(
                prepared["invocation_id"],
                "lightweight",
                actor="user",
                source="host_single_select",
                verification="verified",
                source_event_id="evt-1",
            )
            self.assertEqual("lightweight", decision["selected_tier"])

    def test_managed_receipt_is_required_bound_and_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            task = root / ".trellis" / "tasks" / "task"
            task.mkdir(parents=True)
            metadata = {"id": "task", "name": "task", "status": "in_progress"}
            (task / "task.json").write_text(json.dumps(metadata), encoding="utf-8")
            service = ExpertTeamService(root, developer="tester", session_id="session")
            prepared = service.prepare("Cross-session audited build", task_id="task", host_mode="inline")
            qualified = service.qualify(
                "Cross-session audited build",
                invocation_id=prepared["invocation_id"],
                task_id="task",
                contract=CONTRACT,
                work_items=ITEMS,
            )
            with self.assertRaisesRegex(ContractError, "receipt"):
                service.start("task", "run", CONTRACT, ITEMS, require_receipt=True)
            first = service.start("task", "run", CONTRACT, ITEMS, receipt=qualified["receipt"], require_receipt=True)
            second = service.start("task", "run", CONTRACT, ITEMS, receipt=qualified["receipt"], require_receipt=True)
            self.assertEqual(first, second)
            service.require_qualified_run("task", "run")
            projection = service.compliance("task", "run", prepared["invocation_id"])
            self.assertEqual("partial", projection["result"])
            self.assertEqual("main-session-sequential", projection["qualification"]["execution_mode"])
            metadata["status"] = "planning"
            (task / "task.json").write_text(json.dumps(metadata), encoding="utf-8")
            with self.assertRaisesRegex(ContractError, "in_progress"):
                service.start("task", "other-run", CONTRACT, ITEMS, receipt=qualified["receipt"], require_receipt=True)

    def test_mcp_qualify_cannot_skip_prepare_or_accept_string_graph(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            server = MCPServer(ExpertTeamService(Path(temporary)))
            response = server.dispatch(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": "expert_team_qualify",
                        "arguments": {
                            "request": "Build",
                            "invocation_id": "missing",
                            "contract": CONTRACT,
                            "work_items": ["not-a-work-item"],
                        },
                    },
                }
            )
            assert response is not None
            self.assertTrue(response["result"]["isError"])

    def test_stale_host_and_untrusted_workspace_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            untrusted = ExpertTeamService(root, workspace_trusted=False)
            with self.assertRaisesRegex(ContractError, "workspace_unbound"):
                untrusted.prepare("Explain one function", intent="analysis")
            service = ExpertTeamService(root, session_id="session")
            with self.assertRaisesRegex(ContractError, "stale_session"):
                service.prepare("Explain one function", intent="analysis", host_package_version="0.3.3")

    def test_required_independent_audit_cannot_be_claimed_in_inline_host(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            task = root / ".trellis" / "tasks" / "task"
            task.mkdir(parents=True)
            (task / "task.json").write_text(json.dumps({"id": "task", "status": "in_progress"}), encoding="utf-8")
            service = ExpertTeamService(root, session_id="session")
            prepared = service.prepare(
                "Audited build",
                task_id="task",
                host_mode="inline",
                requires_independent_audit=True,
            )
            with self.assertRaisesRegex(ContractError, "capability_blocked"):
                service.qualify("Audited build", invocation_id=prepared["invocation_id"], task_id="task", contract=CONTRACT, work_items=ITEMS)


if __name__ == "__main__":
    unittest.main()
