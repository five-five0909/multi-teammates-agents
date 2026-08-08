from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from runtime.service import ExpertTeamService


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "scripts" / "expert_team_run.py"


class LocalRunnerLifecycleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        task_dir = self.root / ".trellis" / "tasks" / "08-07-example"
        task_dir.mkdir(parents=True)
        (task_dir / "task.json").write_text(
            json.dumps({"id": "example", "name": "example", "status": "in_progress"}),
            encoding="utf-8",
        )
        self.contract_path = self.root / "contract.json"
        self.items_path = self.root / "items.json"
        self.contract_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "goal": "Complete with audit",
                    "constraints": [],
                    "deliverables": ["report"],
                    "acceptance_criteria": ["accepted"],
                }
            ),
            encoding="utf-8",
        )
        self.items_path.write_text(
            json.dumps(
                [
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
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _run(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(RUNNER), "--repo-root", str(self.root), "--task-id", "example", "--run-id", "run-1", *args],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_start_status_resume_answer_and_cancel(self) -> None:
        started = self._run(
            "--start",
            "--contract-file",
            str(self.contract_path),
            "--work-items-file",
            str(self.items_path),
            "--quiet",
        )
        self.assertEqual(0, started.returncode, started.stderr)
        self.assertEqual("managing", json.loads(started.stdout)["state"])

        status = self._run("--status", "--json")
        self.assertEqual(0, status.returncode, status.stderr)
        self.assertEqual("managing", json.loads(status.stdout)["state"])

        resumed = self._run("--resume")
        self.assertEqual(0, resumed.returncode, resumed.stderr)
        resume_payload = json.loads(resumed.stdout)
        self.assertEqual("managing", resume_payload["state"])
        self.assertNotIn("event_ids", resume_payload)

        service = ExpertTeamService(self.root, developer="tester")
        service.next("example", "run-1", "request_gate", {"gate_type": "ask", "question": "Need input"})
        decision_path = self.root / "decision.json"
        decision_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "gate_type": "ask",
                    "decision": "instruct",
                    "actor": "user",
                    "timestamp": "2026-08-08T00:00:00Z",
                    "provenance": {"schema_version": 1, "gate_type": "ask", "actor": "user", "source": "host_single_select", "verification": "verified", "timestamp": "2026-08-08T00:00:00Z", "source_event_id": "evt-cli"},
                    "instruction": "continue carefully",
                }
            ),
            encoding="utf-8",
        )
        answered = self._run("--answer", str(decision_path), "--json")
        self.assertEqual(0, answered.returncode, answered.stderr)
        self.assertEqual("managing", json.loads(answered.stdout)["state"])

        cancelled = self._run("--cancel", "--cancel-reason", "user stopped", "--quiet")
        self.assertEqual(0, cancelled.returncode, cancelled.stderr)
        self.assertEqual("cancelled", json.loads(cancelled.stdout)["state"])


if __name__ == "__main__":
    unittest.main()
