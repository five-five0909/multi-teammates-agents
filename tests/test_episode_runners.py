from __future__ import annotations

import asyncio
from pathlib import Path
import sys
import unittest
from typing import Any, Mapping, Sequence

from runtime.adapters.base import CancellationToken, EpisodeRequest
from runtime.adapters.claude import ClaudeAdapter
from runtime.adapters.codex import CodexAdapter
from runtime.adapters.process import CommandHostAdapter, redact_secrets
from runtime.core.contracts import BackendEvent


ROOT = Path(__file__).resolve().parents[1]
FAKE_HOST = ROOT / "tests" / "fixtures" / "fake_host.py"


class FakeAdapter(CommandHostAdapter):
    host = "codex"

    def __init__(self) -> None:
        super().__init__(sys.executable)

    def build_command(self, request: EpisodeRequest) -> Sequence[str]:
        return [self.binary, str(FAKE_HOST), request.profile]

    def normalize_record(
        self, record: Mapping[str, Any], request: EpisodeRequest, sequence: int
    ) -> BackendEvent:
        status = "permission_required" if record["type"] == "permission" else (
            "completed" if record["type"] == "result" else "started"
        )
        return BackendEvent.from_dict(
            {
                "schema_version": 1,
                "host": self.host,
                "role": request.role,
                "action": str(record["type"]),
                "status": status,
                "source_id": str(record["id"]),
                "references": [],
            }
        )

    def extract_visible_output(self, records: Sequence[Mapping[str, Any]]) -> str:
        return "\n".join(
            str(record["text"])
            for record in records
            if record.get("type") == "result" and isinstance(record.get("text"), str)
        )


def request(profile: str, *, role: str = "manager", timeout: int = 5) -> EpisodeRequest:
    return EpisodeRequest(
        episode_id=f"episode-{profile}",
        run_id="run-1",
        round_index=1,
        role=role,  # type: ignore[arg-type]
        profile=profile,
        prompt="secret=not-a-real-secret\nhello",
        workspace=ROOT,
        timeout_seconds=timeout,
        read_only=role == "auditor",
        work_item_id="build" if role != "manager" else None,
    )


class EpisodeRunnerTests(unittest.IsolatedAsyncioTestCase):
    async def test_fresh_process_streams_events_and_visible_output(self) -> None:
        adapter = FakeAdapter()
        seen: list[BackendEvent] = []
        result = await adapter.run_episode(request("success"), seen.append)
        self.assertEqual("done", result.status)
        self.assertEqual(["started", "completed"], [event.status for event in seen])
        self.assertIn("hello", result.visible_output)
        self.assertTrue(result.metadata["fresh_process"])
        self.assertNotIn("dangerously", " ".join(result.metadata["command"]))  # type: ignore[arg-type]

    async def test_malformed_stdout_fails_closed(self) -> None:
        result = await FakeAdapter().run_episode(request("malformed"))
        self.assertEqual("error", result.status)
        self.assertIn("Expecting value", result.error or "")

    async def test_timeout_terminates_process(self) -> None:
        adapter = FakeAdapter()
        result = await adapter.run_episode(request("sleep", timeout=1))
        self.assertEqual("timeout", result.status)
        self.assertFalse(adapter._active)

    async def test_cancellation_terminates_process(self) -> None:
        adapter = FakeAdapter()
        token = CancellationToken()
        task = asyncio.create_task(adapter.run_episode(request("sleep", timeout=10), cancellation=token))
        await asyncio.sleep(0.1)
        token.cancel()
        result = await task
        self.assertEqual("cancelled", result.status)
        self.assertFalse(adapter._active)

    async def test_permission_event_is_preserved(self) -> None:
        result = await FakeAdapter().run_episode(request("permission"))
        self.assertEqual("permission_required", result.status)
        self.assertEqual("permission_required", result.events[0].status)

    def test_real_runner_commands_have_no_bypass_and_auditor_is_restricted(self) -> None:
        codex = list(CodexAdapter().build_command(request("success")))
        claude = list(ClaudeAdapter().build_command(request("success", role="auditor")))
        self.assertEqual(["codex", "exec", "--json"], codex[:3])
        self.assertIn("--disallowedTools", claude)
        for command in (codex, claude):
            self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", command)
            self.assertNotIn("--dangerously-skip-permissions", command)

    def test_auditor_requires_read_only_and_secrets_are_redacted(self) -> None:
        with self.assertRaisesRegex(ValueError, "read-only"):
            EpisodeRequest("e", "r", 1, "auditor", "a", "p", ROOT, work_item_id="build")
        self.assertNotIn("hunter2", redact_secrets("API_KEY=hunter2"))


if __name__ == "__main__":
    unittest.main()
