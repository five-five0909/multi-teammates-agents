from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
import tempfile
import unittest

from runtime.audit_guard import diff_workspace, snapshot_workspace
from runtime.config import load_runtime_config
from runtime.core.contracts import ContractError, RoleResult, TaskContract, WorkItem
from runtime.core.reducer import create_snapshot
from runtime.prompts import (
    build_auditor_prompt,
    build_executor_prompt,
    build_manager_prompt,
    parse_audit_decision,
    parse_manager_decision,
    parse_role_result,
)
from runtime.routing import qualify_execution_tier


def contract() -> TaskContract:
    return TaskContract.from_dict(
        {
            "schema_version": 1,
            "goal": "Ship audited output",
            "constraints": ["safe"],
            "deliverables": ["artifact"],
            "acceptance_criteria": ["verified"],
        }
    )


def item() -> WorkItem:
    return WorkItem.from_dict(
        {
            "schema_version": 1,
            "id": "build",
            "objective": "Build artifact",
            "role": "coder",
            "mode": "write",
            "required": True,
            "depends_on": [],
            "ownership": ["src"],
            "evidence_required": ["test"],
        }
    )


class ConfigurationTests(unittest.TestCase):
    def test_precedence_is_explicit_then_project_then_environment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config_dir = root / ".expert-team"
            config_dir.mkdir()
            (config_dir / "config.toml").write_text(
                "[run]\nhost='claude'\nmax_rounds=7\n[run.roles.auditor]\nmodel='strong'\n",
                encoding="utf-8",
            )
            loaded = load_runtime_config(
                root,
                {"max_rounds": 9},
                {"EXPERT_TEAM_HOST": "codex", "EXPERT_TEAM_MAX_ROUNDS": "3"},
            )
            self.assertEqual(9, loaded.max_rounds)
            self.assertEqual("claude", loaded.role("manager").host)
            self.assertEqual("strong", loaded.role("auditor").model)

    def test_per_role_environment_fallback_is_overridden_by_project(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config_dir = root / ".expert-team"
            config_dir.mkdir()
            (config_dir / "config.toml").write_text(
                "[run.roles.executor]\nhost='claude'\n",
                encoding="utf-8",
            )
            loaded = load_runtime_config(
                root,
                environ={
                    "EXPERT_TEAM_EXECUTOR_HOST": "codex",
                    "EXPERT_TEAM_EXECUTOR_MODEL": "env-model",
                    "EXPERT_TEAM_EXECUTOR_TIMEOUT_SECONDS": "17",
                },
            )
            self.assertEqual("claude", loaded.role("executor").host)
            self.assertEqual("env-model", loaded.role("executor").model)
            self.assertEqual(17, loaded.role("executor").timeout_seconds)

    def test_config_rejects_persisted_secrets_and_unknown_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / ".expert-team"
            directory.mkdir()
            (directory / "config.toml").write_text("[run]\napi_key='nope'\n", encoding="utf-8")
            with self.assertRaisesRegex(ContractError, "must not persist secrets"):
                load_runtime_config(root)


class RoutingTests(unittest.TestCase):
    def test_bounded_request_is_lightweight_and_qualifiers_are_managed(self) -> None:
        self.assertEqual("lightweight", qualify_execution_tier("Explain this function"))
        self.assertEqual("managed", qualify_execution_tier("跨会话持续执行这个项目"))
        self.assertEqual("managed", qualify_execution_tier("Build", dependency_waves=2))
        self.assertEqual("lightweight", qualify_execution_tier("Build", explicit="lightweight", durable_audit=True))


class WorkspaceGuardTests(unittest.TestCase):
    def test_add_change_delete_and_type_change_are_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            changed = root / "changed.txt"
            deleted = root / "deleted.txt"
            type_changed = root / "type"
            changed.write_text("before", encoding="utf-8")
            deleted.write_text("delete", encoding="utf-8")
            type_changed.write_text("file", encoding="utf-8")
            before = snapshot_workspace(root)
            changed.write_text("after", encoding="utf-8")
            deleted.unlink()
            type_changed.unlink()
            type_changed.mkdir()
            (root / "added.txt").write_text("add", encoding="utf-8")
            diff = diff_workspace(before, snapshot_workspace(root))
            self.assertEqual(("added.txt",), diff.added)
            self.assertEqual(("deleted.txt",), diff.deleted)
            self.assertEqual(("changed.txt",), diff.changed)
            self.assertEqual(("type",), diff.type_changed)
            self.assertFalse(diff.clean)

    def test_hash_limit_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "large.bin").write_bytes(b"12345")
            snapshot = snapshot_workspace(root, max_hash_bytes=2)
            self.assertFalse(snapshot.complete)
            self.assertIn("hash limit", snapshot.errors[0])


class PromptTests(unittest.TestCase):
    def test_manager_prompt_is_bounded_and_decision_is_dependency_checked(self) -> None:
        snapshot = create_snapshot("run-1", contract(), [item()])
        prompt = build_manager_prompt(snapshot, max_chars=4_000)
        self.assertLessEqual(len(prompt), 4_000)
        decision = parse_manager_decision(
            json.dumps({"schema_version": 1, "action": "execute", "work_item_ids": ["build"], "message": "ready"}),
            snapshot,
        )
        self.assertEqual(("build",), decision.work_item_ids)
        with self.assertRaisesRegex(ContractError, "unknown fields|exactly"):
            parse_manager_decision(json.dumps({"schema_version": 1, "action": "cancel", "work_item_ids": [], "message": "", "extra": 1}), snapshot)

    def test_executor_and_auditor_outputs_are_identity_bound(self) -> None:
        original = item()
        active = replace(original, status="running", attempt=1, executor_id="executor-1")
        snapshot = replace(create_snapshot("run-1", contract(), [original]), work_items={"build": active})
        executor_prompt = build_executor_prompt(snapshot, original, executor_id="executor-1", max_chars=4_000)
        self.assertIn("fresh context", executor_prompt)
        self.assertIn('"artifacts"', executor_prompt)
        self.assertIn('"checks"', executor_prompt)
        self.assertIn('"risks"', executor_prompt)
        result_value = {
            "schema_version": 1,
            "work_item_id": "build",
            "attempt": 1,
            "executor_id": "executor-1",
            "summary": "done",
            "artifacts": ["src/out.txt"],
            "evidence": ["test"],
            "checks": ["passed"],
            "risks": [],
        }
        result = parse_role_result(json.dumps(result_value), item=active, executor_id="executor-1")
        self.assertIsInstance(result, RoleResult)
        auditor_prompt = build_auditor_prompt(snapshot, active, result, auditor_id="auditor-1", max_chars=6_000)
        self.assertIn("read-only", auditor_prompt)
        self.assertIn('"status"', auditor_prompt)
        self.assertIn('"contract_alignment"', auditor_prompt)
        self.assertIn('"required_rework"', auditor_prompt)
        audit_value = {
            "schema_version": 1,
            "work_item_id": "build",
            "attempt": 1,
            "auditor_id": "auditor-1",
            "executor_id": "executor-1",
            "status": "accepted",
            "integrity": "clean",
            "contract_alignment": "aligned",
            "evidence": ["test"],
            "findings": [],
            "required_rework": [],
        }
        audit = parse_audit_decision(json.dumps(audit_value), item=active, executor_id="executor-1", auditor_id="auditor-1")
        self.assertEqual("accepted", audit.status)


if __name__ == "__main__":
    unittest.main()
