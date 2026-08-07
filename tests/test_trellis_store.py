from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from runtime.adapters.trellis import LeaseConflict, TrellisRunStore
from runtime.core.contracts import ContractError, RunEvent, TaskContract, WorkItem


def contract() -> TaskContract:
    return TaskContract.from_dict({"schema_version": 1, "goal": "Persist safely", "constraints": [], "deliverables": ["state"], "acceptance_criteria": ["replay works"]})


def item() -> WorkItem:
    return WorkItem.from_dict({"schema_version": 1, "id": "research", "objective": "Collect evidence", "role": "researcher", "mode": "read", "required": True, "depends_on": [], "ownership": [], "evidence_required": ["source"]})


def event() -> RunEvent:
    return RunEvent.from_dict({"schema_version": 1, "id": "event-1", "run_id": "run-1", "seq": 1, "expected_version": 0, "kind": "run.managing", "timestamp": "2026-08-07T00:00:00Z", "payload": {}})


class TrellisRunStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.task = self.root / ".trellis" / "tasks" / "08-07-example"
        self.task.mkdir(parents=True)
        self.store = TrellisRunStore(self.root, self.task, "developer-1")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_create_append_and_replay(self) -> None:
        self.store.create("run-1", contract(), [item()])
        updated = self.store.append(event(), owner="controller-1")
        self.assertEqual("managing", updated.state)
        self.assertEqual(updated, self.store.load("run-1"))
        self.assertEqual(1, len((self.store.run_dir("run-1") / "events.jsonl").read_text(encoding="utf-8").splitlines()))

    def test_append_is_idempotent(self) -> None:
        self.store.create("run-1", contract(), [item()])
        first = self.store.append(event(), owner="controller-1")
        second = self.store.append(event(), owner="controller-1")
        self.assertEqual(first, second)
        self.assertEqual(1, len((self.store.run_dir("run-1") / "events.jsonl").read_text(encoding="utf-8").splitlines()))

    def test_load_repairs_snapshot_stale_after_event_append(self) -> None:
        initial = self.store.create("run-1", contract(), [item()])
        self.store.append(event(), owner="controller-1")
        state_path = self.store.run_dir("run-1") / "state.json"
        state_path.write_text(json.dumps(initial.to_dict()), encoding="utf-8")
        repaired = self.store.load("run-1")
        self.assertEqual(1, repaired.version)
        self.assertEqual(1, json.loads(state_path.read_text(encoding="utf-8"))["version"])

    def test_every_durable_transition_recovers_from_stale_snapshot(self) -> None:
        previous = self.store.create("run-1", contract(), [item()])
        payloads = [
            ("run.managing", {}),
            ("wave.execution_started", {"work_item_ids": ["research"], "executor_id": "executor-1"}),
            ("executor.result_submitted", {"schema_version": 1, "work_item_id": "research", "attempt": 1, "executor_id": "executor-1", "summary": "done", "artifacts": [], "evidence": ["source"], "checks": ["checked"], "risks": []}),
            ("wave.audit_started", {}),
            ("audit.recorded", {"schema_version": 1, "work_item_id": "research", "attempt": 1, "auditor_id": "auditor-1", "executor_id": "executor-1", "status": "accepted", "integrity": "clean", "contract_alignment": "aligned", "evidence": ["source"], "findings": [], "required_rework": []}),
        ]
        state_path = self.store.run_dir("run-1") / "state.json"
        for seq, (kind, payload) in enumerate(payloads, start=1):
            transition = RunEvent.from_dict({"schema_version": 1, "id": f"event-{seq}", "run_id": "run-1", "seq": seq, "expected_version": previous.version, "kind": kind, "timestamp": f"2026-08-07T00:00:{seq:02d}Z", "payload": payload})
            updated = self.store.append(transition, owner="controller-1")
            state_path.write_text(json.dumps(previous.to_dict()), encoding="utf-8")
            recovered = self.store.load("run-1")
            self.assertEqual(updated, recovered)
            previous = recovered

    def test_corrupt_event_tail_fails_without_advancing(self) -> None:
        self.store.create("run-1", contract(), [item()])
        (self.store.run_dir("run-1") / "events.jsonl").write_text('{"schema_version":1', encoding="utf-8")
        with self.assertRaisesRegex(ContractError, "invalid JSON"):
            self.store.load("run-1")

    def test_active_lease_rejects_second_controller(self) -> None:
        self.store.create("run-1", contract(), [item()])
        with self.store.lease("run-1", owner="controller-1"):
            with self.assertRaisesRegex(LeaseConflict, "controller-1"):
                with self.store.lease("run-1", owner="controller-2"):
                    self.fail("second lease should not be acquired")

    def test_paths_cannot_escape_trellis_task(self) -> None:
        with self.assertRaisesRegex(ContractError, "task_dir"):
            TrellisRunStore(self.root, self.root, "developer-1")
        with self.assertRaisesRegex(ContractError, "run_id"):
            self.store.run_dir("../escape")


if __name__ == "__main__":
    unittest.main()
