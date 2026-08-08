from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from urllib.parse import parse_qs, urlparse
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "expert-team"
VALIDATOR_PATH = ROOT / "scripts" / "validate_contract.py"

spec = importlib.util.spec_from_file_location("validate_contract", VALIDATOR_PATH)
assert spec and spec.loader
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class PluginContractTests(unittest.TestCase):
    def test_manifest_matches_plugin_root(self) -> None:
        manifest = json.loads((ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(ROOT.name, manifest["name"])
        self.assertEqual("./skills/", manifest["skills"])
        self.assertIsInstance(manifest["mcpServers"], dict)
        server = manifest["mcpServers"]["expert-team"]
        self.assertEqual("node", server["command"])
        self.assertIn("PLUGIN_ROOT", server["args"][1])
        self.assertIn("CLAUDE_PLUGIN_ROOT", server["args"][1])
        self.assertNotIn("shell", server)
        self.assertNotIn("C:\\", json.dumps(server))
        for unsupported in ("hooks", "apps"):
            self.assertNotIn(unsupported, manifest)

    def test_claude_manifest_matches_shared_package(self) -> None:
        codex = json.loads((ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
        claude = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(codex["name"], claude["name"])
        self.assertEqual(codex["version"], claude["version"])
        self.assertEqual("./skills/", claude["skills"])
        self.assertNotIn("agents", claude)
        self.assertNotIn("mcpServers", claude)

    def test_claude_mcp_config_uses_compatible_plugin_root(self) -> None:
        config = json.loads((ROOT / ".mcp.json").read_text(encoding="utf-8"))
        self.assertEqual("node", config["mcpServers"]["expert-team"]["command"])
        launcher = config["mcpServers"]["expert-team"]["args"][1]
        self.assertIn("PLUGIN_ROOT", launcher)
        self.assertIn("CLAUDE_PLUGIN_ROOT", launcher)
        self.assertNotIn("shell", config["mcpServers"]["expert-team"])
        self.assertTrue((ROOT / "scripts" / "expert_team_mcp.py").is_file())
        self.assertTrue((ROOT / "scripts" / "expert_team_mcp_launcher.js").is_file())
        self.assertTrue((ROOT / "scripts" / "expert_team_ccswitch_config.js").is_file())

        codex_manifest = json.loads((ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(config["mcpServers"]["expert-team"], codex_manifest["mcpServers"]["expert-team"])

    def test_ccswitch_config_is_generated_from_the_current_checkout(self) -> None:
        generator = ROOT / "scripts" / "expert_team_ccswitch_config.js"
        with tempfile.TemporaryDirectory() as cwd:
            completed = subprocess.run(
                ["node", str(generator), "--json"],
                cwd=cwd,
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
        config = json.loads(completed.stdout)
        server = config["mcpServers"]["expert-team"]
        self.assertTrue(Path(server["command"]).is_file(), server["command"])
        self.assertEqual(str(ROOT / "scripts" / "expert_team_mcp_launcher.js"), server["args"][0])
        self.assertNotIn("PLUGIN_ROOT", json.dumps(server))
        request = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}) + "\n"
        handshake = subprocess.run(
            [server["command"], *server["args"]],
            input=request,
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
        self.assertEqual("expert-team", json.loads(handshake.stdout)["result"]["serverInfo"]["name"])

        server_only = subprocess.run(
            ["node", str(generator), "--server-json"],
            cwd=ROOT.parent,
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
        self.assertEqual(server, json.loads(server_only.stdout))

        deep_link = subprocess.run(
            ["node", str(generator), "--deeplink", "--apps", "claude,codex"],
            cwd=ROOT.parent,
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        ).stdout.strip()
        parsed = urlparse(deep_link)
        self.assertEqual("ccswitch:", parsed.scheme + ":")
        query = parse_qs(parsed.query)
        self.assertEqual(["mcp"], query["resource"])
        self.assertEqual(["claude,codex"], query["apps"])
        self.assertEqual(server["command"], json.loads(query["config"][0])["command"])

    def test_shared_mcp_launcher_starts_from_both_host_environments(self) -> None:
        config = json.loads((ROOT / ".mcp.json").read_text(encoding="utf-8"))["mcpServers"]["expert-team"]
        request = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}) + "\n"
        for variable in ("PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"):
            with self.subTest(variable=variable):
                environment = os.environ.copy()
                environment.pop("PLUGIN_ROOT", None)
                environment.pop("CLAUDE_PLUGIN_ROOT", None)
                environment[variable] = str(ROOT)
                completed = subprocess.run([config["command"], *config["args"]], input=request, capture_output=True, text=True, env=environment, timeout=10, check=True)
                response = json.loads(completed.stdout.strip())
                self.assertEqual("expert-team", response["result"]["serverInfo"]["name"])
                self.assertEqual("0.3.2", response["result"]["serverInfo"]["version"])
        environment = os.environ.copy()
        environment.pop("PLUGIN_ROOT", None)
        environment.pop("CLAUDE_PLUGIN_ROOT", None)
        completed = subprocess.run([config["command"], *config["args"]], input=request, capture_output=True, text=True, env=environment, cwd=ROOT, timeout=10, check=True)
        response = json.loads(completed.stdout.strip())
        self.assertEqual("expert-team", response["result"]["serverInfo"]["name"])

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
        ):
            self.assertTrue((SKILL / "references" / name).is_file(), name)
            self.assertIn(name, text)

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
