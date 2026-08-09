from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "expert-team"
VALIDATOR_PATH = ROOT / "scripts" / "validate_contract.py"

spec = importlib.util.spec_from_file_location("validate_contract", VALIDATOR_PATH)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class ProductContractTests(unittest.TestCase):
    def test_skill_metadata_and_references(self) -> None:
        text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\nname: expert-team\n"))
        self.assertIn("$expert-team", text)
        self.assertIn("Do not auto-trigger", text)
        for name in (
            "orchestration-contract.md",
            "workflow-routing.md",
            "agent-registry.md",
            "expert-catalog.md",
            "result-contract.md",
            "trellis-integration.md",
            "run-ledger-template.md",
            "managed-mode.md",
            "delegation-guardrails.md",
            "entry-gate.md",
        ):
            self.assertTrue((SKILL / "references" / name).is_file(), name)
            self.assertIn(name, text)
        self.assertIn("expert_team_version", text)
        self.assertIn("expert_team_start", text)
        self.assertIn("expert_team_run", text)
        self.assertIn("qualification_receipt", text)
        self.assertIn("mta update --version <exact> --yes", text)

    def test_openai_metadata_keeps_implicit_invocation(self) -> None:
        text = (SKILL / "agents" / "openai.yaml").read_text(encoding="utf-8")
        self.assertIn("$expert-team", text)
        self.assertIn("allow_implicit_invocation: true", text)

    def test_default_roles_are_present(self) -> None:
        catalog = (SKILL / "references" / "expert-catalog.md").read_text(encoding="utf-8")
        for role in (
            "Researcher",
            "Debug Engineer",
            "Full-Stack Engineer",
            "Code Reviewer",
            "QA",
            "UI Operator",
        ):
            self.assertIn(f"## {role}", catalog)

    def test_plugin_has_no_qoder_runtime_dependency(self) -> None:
        forbidden = ("qoder.sh", "webview/experts", "listBuiltinAgents")
        for path in SKILL.rglob("*"):
            if path.is_file():
                text = path.read_text(encoding="utf-8")
                for marker in forbidden:
                    self.assertNotIn(marker, text, f"{marker} in {path}")

    def test_workflow_routing_is_bounded_and_domain_safe(self) -> None:
        routing = (SKILL / "references" / "workflow-routing.md").read_text(encoding="utf-8")
        for shape in ("`direct`", "`fast`", "`bugfix`", "`standard`", "`audit`"):
            self.assertIn(shape, routing)
        for lens in ("Software", "Product", "Design", "Operations", "Security", "Database"):
            self.assertIn(f"### {lens}", routing)
        self.assertIn("two repair-and-verification rounds", routing)
        self.assertIn("Default to read-only analysis for production systems", routing)
        self.assertIn("read-only analysis for live data", routing)

    def test_all_upstream_agent_profiles_are_registered(self) -> None:
        references = SKILL / "references"
        registry = json.loads((references / "agent-registry.json").read_text(encoding="utf-8"))
        agents = registry["agents"]
        expected_ids = {
            "competitive-analyst", "critique-reviewer", "data-analyst",
            "database-optimization-expert", "design-engine-team-lead",
            "design-system-expert", "discovery-analyst", "export-specialist",
            "infrastructure-operations-expert", "product-director",
            "prototype-builder", "requirement-analyst", "roadmap-planner",
            "security-expert", "software-architect", "software-engineer",
            "software-product-manager", "software-qa-engineer",
            "software-team-lead", "user-researcher",
        }
        self.assertEqual(20, len(agents))
        self.assertEqual(expected_ids, {agent["id"] for agent in agents})
        self.assertEqual(20, len({agent["profile"] for agent in agents}))
        for agent in agents:
            profile = references / agent["profile"]
            self.assertTrue(profile.is_file(), agent["id"])
            text = profile.read_text(encoding="utf-8")
            self.assertIn(f"ID: `{agent['id']}`", text)
            self.assertIn("## Responsibilities", text)
            self.assertIn("## Boundaries and evidence", text)
            self.assertIn(agent["default_mode"], {"read", "write", "verify"})
            self.assertIn(agent["preferred_agent_type"], {"explorer", "worker", "default"})

    def test_coordinators_are_lead_playbooks(self) -> None:
        references = SKILL / "references"
        registry = json.loads((references / "agent-registry.json").read_text(encoding="utf-8"))
        coordinators = [agent for agent in registry["agents"] if agent["kind"] == "coordinator"]
        self.assertEqual(3, len(coordinators))
        for agent in coordinators:
            text = (references / agent["profile"]).read_text(encoding="utf-8")
            self.assertIn("never spawn as a nested lead", text)

    def test_claude_agents_are_generated_from_canonical_registry(self) -> None:
        references = SKILL / "references"
        registry = json.loads((references / "agent-registry.json").read_text(encoding="utf-8"))
        rendered = sorted((ROOT / "agents").glob("*.md"))
        self.assertEqual(20, len(rendered))
        self.assertEqual({agent["id"] for agent in registry["agents"]}, {path.stem for path in rendered})
        for agent in registry["agents"]:
            text = (ROOT / "agents" / f"{agent['id']}.md").read_text(encoding="utf-8")
            self.assertTrue(text.startswith(f"---\nname: {agent['id']}\n"))
            self.assertIn("Never certify your own work", text)
            if agent["kind"] == "coordinator":
                self.assertIn("Never invoke as an Executor", text)

    def test_fixture_expectations(self) -> None:
        for path in sorted((ROOT / "tests" / "fixtures").glob("*.json")):
            with self.subTest(path=path.name):
                validator.validate_fixture(path)

    def test_scope_overlap_is_case_and_separator_safe(self) -> None:
        self.assertTrue(validator.scopes_overlap("SRC\\API", "src/api/routes"))
        self.assertFalse(validator.scopes_overlap("src/api", "src/application"))

    def test_cycle_fixture_reaches_cycle_detection(self) -> None:
        path = ROOT / "tests" / "fixtures" / "cycle.json"
        plan = json.loads(path.read_text(encoding="utf-8"))
        plan.pop("expected_valid")
        with self.assertRaisesRegex(validator.ContractError, "dependency cycle"):
            validator.validate_plan(plan)

    def test_normal_run_does_not_create_runtime_directory(self) -> None:
        self.assertFalse((ROOT / ".expert-team").exists())


if __name__ == "__main__":
    unittest.main()
