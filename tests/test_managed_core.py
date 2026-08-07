from __future__ import annotations

import unittest

from runtime.core.codec import decode_events, encode_event
from runtime.core.contracts import AuditDecision, ContractError, RunEvent, TaskContract, WorkItem
from runtime.core.reducer import apply_event, create_snapshot, replay
from runtime.core.scheduling import validate_parallel_wave, validate_work_graph


def contract() -> TaskContract:
    return TaskContract.from_dict(
        {
            "schema_version": 1,
            "goal": "Ship an audited change",
            "constraints": ["Keep permissions visible"],
            "deliverables": ["implementation"],
            "acceptance_criteria": ["independent audit passes"],
        }
    )


def item(**overrides: object) -> WorkItem:
    value: dict[str, object] = {
        "schema_version": 1,
        "id": "build",
        "objective": "Implement the bounded change",
        "role": "software-engineer",
        "mode": "write",
        "required": True,
        "depends_on": [],
        "ownership": ["runtime/core"],
        "evidence_required": ["tests"],
    }
    value.update(overrides)
    return WorkItem.from_dict(value)


def event(seq: int, version: int, kind: str, payload: dict[str, object], *, event_id: str | None = None) -> RunEvent:
    return RunEvent.from_dict(
        {
            "schema_version": 1,
            "id": event_id or f"event-{seq}",
            "run_id": "run-1",
            "seq": seq,
            "expected_version": version,
            "kind": kind,
            "timestamp": f"2026-08-07T00:00:{seq:02d}Z",
            "payload": payload,
        }
    )


def result_payload(attempt: int = 1) -> dict[str, object]:
    return {
        "schema_version": 1,
        "work_item_id": "build",
        "attempt": attempt,
        "executor_id": "executor-1",
        "summary": "Implementation produced",
        "artifacts": ["runtime/core/reducer.py"],
        "evidence": ["test output"],
        "checks": ["unit tests"],
        "risks": [],
    }


def audit_payload(status: str = "accepted", attempt: int = 1) -> dict[str, object]:
    return {
        "schema_version": 1,
        "work_item_id": "build",
        "attempt": attempt,
        "auditor_id": "auditor-1",
        "executor_id": "executor-1",
        "status": status,
        "integrity": "clean",
        "contract_alignment": "aligned",
        "evidence": ["tests/test_managed_core.py"],
        "findings": [],
        "required_rework": [] if status == "accepted" else ["fix failing test"],
    }


class ContractTests(unittest.TestCase):
    def test_unknown_fields_are_rejected(self) -> None:
        value = contract().to_dict()
        value["surprise"] = True
        with self.assertRaisesRegex(ContractError, "unknown fields"):
            TaskContract.from_dict(value)

    def test_executor_cannot_audit_own_work(self) -> None:
        value = audit_payload()
        value["auditor_id"] = "executor-1"
        with self.assertRaisesRegex(ContractError, "independent"):
            AuditDecision.from_dict(value)

    def test_dirty_or_misaligned_audit_cannot_accept(self) -> None:
        value = audit_payload()
        value["integrity"] = "dirty"
        with self.assertRaisesRegex(ContractError, "clean integrity"):
            AuditDecision.from_dict(value)

    def test_graph_rejects_cycles(self) -> None:
        first = item(id="first", depends_on=["second"])
        second = item(id="second", depends_on=["first"], ownership=["runtime/adapters"])
        with self.assertRaisesRegex(ContractError, "dependency cycle"):
            validate_work_graph([first, second])

    def test_parallel_writes_require_disjoint_ownership(self) -> None:
        first = item(id="first", ownership=["runtime/core"])
        second = item(id="second", ownership=["runtime/core/reducer.py"])
        with self.assertRaisesRegex(ContractError, "overlaps"):
            validate_parallel_wave([first, second])
        validate_parallel_wave([first, item(id="third", ownership=["tests/adapters"])])


class ReducerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.initial = create_snapshot("run-1", contract(), [item()])

    def accepted_events(self) -> list[RunEvent]:
        return [
            event(1, 0, "run.managing", {}),
            event(2, 1, "wave.execution_started", {"work_item_ids": ["build"], "executor_id": "executor-1"}),
            event(3, 2, "executor.result_submitted", result_payload()),
            event(4, 3, "wave.audit_started", {}),
            event(5, 4, "audit.recorded", audit_payload()),
        ]

    def test_only_accepted_audit_updates_verified_progress(self) -> None:
        before_audit = replay(self.initial, self.accepted_events()[:4])
        self.assertEqual({}, before_audit.verified_progress)
        accepted = apply_event(before_audit, self.accepted_events()[4])
        self.assertEqual(("tests/test_managed_core.py",), accepted.verified_progress["build"])
        self.assertEqual("accepted", accepted.work_items["build"].status)

    def test_completion_requires_audit_and_human_gate(self) -> None:
        accepted = replay(self.initial, self.accepted_events())
        proposed = apply_event(accepted, event(6, 5, "human.gate_requested", {"gate_type": "completion"}))
        completed = apply_event(proposed, event(7, 6, "human.decision_recorded", {"decision": "approve", "gate_type": "completion"}))
        self.assertEqual("completed", completed.state)

    def test_completion_cannot_be_proposed_from_executor_claim(self) -> None:
        submitted = replay(self.initial, self.accepted_events()[:3])
        with self.assertRaisesRegex(ContractError, "cannot request human gate"):
            apply_event(submitted, event(4, 3, "human.gate_requested", {"gate_type": "completion"}))

    def test_stale_version_is_rejected(self) -> None:
        managing = apply_event(self.initial, event(1, 0, "run.managing", {}))
        with self.assertRaisesRegex(ContractError, "version conflict"):
            apply_event(managing, event(2, 0, "wave.execution_started", {"work_item_ids": ["build"], "executor_id": "executor-1"}))

    def test_duplicate_event_is_idempotent(self) -> None:
        first = event(1, 0, "run.managing", {}, event_id="stable-id")
        managing = apply_event(self.initial, first)
        self.assertIs(managing, apply_event(managing, first))

    def test_retry_limit_blocks_repeated_rejection(self) -> None:
        first_attempt = self.accepted_events()[:4] + [event(5, 4, "audit.recorded", audit_payload("rework"))]
        state = replay(self.initial, first_attempt)
        self.assertEqual("rework", state.work_items["build"].status)
        state = apply_event(state, event(6, 5, "run.managing", {}))
        state = apply_event(state, event(7, 6, "wave.execution_started", {"work_item_ids": ["build"], "executor_id": "executor-1"}))
        state = apply_event(state, event(8, 7, "executor.result_submitted", result_payload(2)))
        state = apply_event(state, event(9, 8, "wave.audit_started", {}))
        state = apply_event(state, event(10, 9, "audit.recorded", audit_payload("rework", 2)))
        self.assertEqual("blocked", state.state)
        self.assertEqual("blocked", state.work_items["build"].status)

    def test_replay_round_trip_uses_one_decoder(self) -> None:
        events = self.accepted_events()
        encoded = [encode_event(value) for value in events]
        self.assertEqual(replay(self.initial, events), replay(self.initial, decode_events(encoded)))

    def test_truncated_jsonl_tail_fails_closed(self) -> None:
        lines = [encode_event(self.accepted_events()[0]), '{"schema_version":1']
        with self.assertRaisesRegex(ContractError, "event line 2 is invalid JSON"):
            decode_events(lines)

    def test_execution_wave_rejects_overlapping_writes(self) -> None:
        initial = create_snapshot("run-1", contract(), [item(id="first"), item(id="second", ownership=["runtime/core/reducer.py"])])
        managing = apply_event(initial, event(1, 0, "run.managing", {}))
        with self.assertRaisesRegex(ContractError, "overlaps"):
            apply_event(managing, event(2, 1, "wave.execution_started", {"work_item_ids": ["first", "second"], "assignments": {"first": "executor-1", "second": "executor-2"}}))

    def test_execution_wave_assigns_distinct_executors(self) -> None:
        initial = create_snapshot("run-1", contract(), [item(id="first"), item(id="second", ownership=["tests/adapters"])])
        managing = apply_event(initial, event(1, 0, "run.managing", {}))
        running = apply_event(managing, event(2, 1, "wave.execution_started", {"work_item_ids": ["first", "second"], "assignments": {"first": "executor-1", "second": "executor-2"}}))
        self.assertEqual("executor-1", running.work_items["first"].executor_id)
        self.assertEqual("executor-2", running.work_items["second"].executor_id)

    def test_manager_waits_for_every_audit_in_wave(self) -> None:
        initial = create_snapshot("run-1", contract(), [item(id="first"), item(id="second", ownership=["tests/adapters"])])
        events = [
            event(1, 0, "run.managing", {}),
            event(2, 1, "wave.execution_started", {"work_item_ids": ["first", "second"], "assignments": {"first": "executor-1", "second": "executor-2"}}),
            event(3, 2, "executor.result_submitted", {**result_payload(), "work_item_id": "first", "executor_id": "executor-1"}),
            event(4, 3, "executor.result_submitted", {**result_payload(), "work_item_id": "second", "executor_id": "executor-2"}),
            event(5, 4, "wave.audit_started", {}),
            event(6, 5, "audit.recorded", {**audit_payload(), "work_item_id": "first", "executor_id": "executor-1"}),
        ]
        state = replay(initial, events)
        with self.assertRaisesRegex(ContractError, "await audit"):
            apply_event(state, event(7, 6, "run.managing", {}))

    def test_non_completion_human_gates_resume_or_cancel(self) -> None:
        for gate_type in ("ask", "budget", "cancellation"):
            with self.subTest(gate_type=gate_type):
                managing = apply_event(self.initial, event(1, 0, "run.managing", {}))
                gated = apply_event(managing, event(2, 1, "human.gate_requested", {"gate_type": gate_type}))
                decision = "cancel" if gate_type == "cancellation" else "instruct"
                resolved = apply_event(gated, event(3, 2, "human.decision_recorded", {"gate_type": gate_type, "decision": decision, "instruction": "continue carefully"}))
                self.assertEqual("cancelled" if decision == "cancel" else "managing", resolved.state)

    def test_human_decision_must_match_pending_gate(self) -> None:
        managing = apply_event(self.initial, event(1, 0, "run.managing", {}))
        gated = apply_event(managing, event(2, 1, "human.gate_requested", {"gate_type": "ask"}))
        with self.assertRaisesRegex(ContractError, "gate mismatch"):
            apply_event(gated, event(3, 2, "human.decision_recorded", {"gate_type": "budget", "decision": "continue"}))

    def test_blocked_and_repeated_failure_gates_can_be_resolved(self) -> None:
        managing = apply_event(self.initial, event(1, 0, "run.managing", {}))
        blocked = apply_event(managing, event(2, 1, "run.blocked", {}))
        for gate_type in ("blocked", "repeated_failure"):
            with self.subTest(gate_type=gate_type):
                gated = apply_event(blocked, event(3, 2, "human.gate_requested", {"gate_type": gate_type}))
                resolved = apply_event(gated, event(4, 3, "human.decision_recorded", {"gate_type": gate_type, "decision": "continue"}))
                self.assertEqual("managing", resolved.state)


if __name__ == "__main__":
    unittest.main()
