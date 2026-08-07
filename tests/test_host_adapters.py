from __future__ import annotations

import json
from pathlib import Path
import unittest

from runtime.adapters.claude import normalize_claude_event
from runtime.adapters.codex import normalize_codex_event
from runtime.core.contracts import ContractError


ROOT = Path(__file__).resolve().parents[1]


class HostAdapterTests(unittest.TestCase):
    def test_command_events_normalize_to_same_semantics(self) -> None:
        codex_raw = json.loads((ROOT / "tests" / "fixtures" / "adapters" / "codex-command.json").read_text(encoding="utf-8"))
        claude_raw = json.loads((ROOT / "tests" / "fixtures" / "adapters" / "claude-command.json").read_text(encoding="utf-8"))
        codex = normalize_codex_event(codex_raw, role="executor")
        claude = normalize_claude_event(claude_raw, role="executor")
        self.assertEqual("completed", codex.status)
        self.assertEqual("progress", claude.status)
        self.assertEqual(("python -m unittest",), codex.references)
        self.assertEqual(codex.references, claude.references)
        self.assertEqual("Bash", claude.tool)

    def test_permission_events_remain_visible(self) -> None:
        codex = normalize_codex_event({"type": "approval.requested", "id": "approval-1"}, role="executor")
        claude = normalize_claude_event({"type": "permission_request", "uuid": "permission-1"}, role="auditor")
        self.assertEqual("permission_required", codex.status)
        self.assertEqual("permission_required", claude.status)

    def test_invalid_raw_event_fails_at_adapter_boundary(self) -> None:
        with self.assertRaisesRegex(ContractError, "event type"):
            normalize_codex_event({}, role="manager")
        with self.assertRaisesRegex(ContractError, "source id"):
            normalize_claude_event({"type": "assistant"}, role="manager")

    def test_runtime_contains_no_permission_bypass_flags(self) -> None:
        forbidden = ("dangerously-bypass-approvals-and-sandbox", "dangerously-skip-permissions")
        for directory in (ROOT / "runtime", ROOT / "scripts", ROOT / "skills"):
            for path in directory.rglob("*"):
                if path.is_file() and path.suffix in {".py", ".md", ".json"}:
                    text = path.read_text(encoding="utf-8")
                    for marker in forbidden:
                        self.assertNotIn(marker, text, f"{marker} in {path}")


if __name__ == "__main__":
    unittest.main()
