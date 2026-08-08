from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "hooks" / "expert_team_entry.py"


def run_hook(payload: dict[str, object]) -> dict[str, object]:
    completed = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        cwd=ROOT,
        check=True,
    )
    return json.loads(completed.stdout) if completed.stdout.strip() else {}


class EntryHookTests(unittest.TestCase):
    def test_prompt_submit_records_gate_and_source_event(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            result = run_hook(
                {
                    "event": "UserPromptSubmit",
                    "prompt": "$expert-team explain this function",
                    "cwd": temporary,
                    "session_id": "hook-test",
                    "event_id": "evt-hook",
                }
            )
            context = result["hookSpecificOutput"]["additionalContext"]  # type: ignore[index]
            self.assertIn("invocation_id=", context)
            self.assertIn("selection_required", context)
            gate_files = list((Path(temporary) / ".expert-team" / "entry-gates" / "hook-test").glob("*.json"))
            self.assertEqual(1, len(gate_files))
            self.assertEqual("evt-hook", json.loads(gate_files[0].read_text(encoding="utf-8"))["source_event_id"])

    def test_pre_tool_use_allows_read_only_but_blocks_source_write(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            run_hook(
                {
                    "event": "UserPromptSubmit",
                    "prompt": "$expert-team explain this function",
                    "cwd": temporary,
                    "session_id": "hook-test",
                    "event_id": "evt-hook",
                }
            )
            read_only = run_hook({"event": "PreToolUse", "tool_name": "shell_command", "command": "git status", "cwd": temporary, "session_id": "hook-test"})
            self.assertEqual({}, read_only)
            blocked = run_hook({"event": "PreToolUse", "tool_name": "apply_patch", "input": "*** Update File: src/app.py", "cwd": temporary, "session_id": "hook-test"})
            self.assertEqual("deny", blocked["hookSpecificOutput"]["permissionDecision"])  # type: ignore[index]


if __name__ == "__main__":
    unittest.main()
