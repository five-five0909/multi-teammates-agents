"""Opt-in, bounded model-backed acceptance run for one Expert Team host."""

from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.config import load_runtime_config
from runtime.core.contracts import ContractError
from runtime.service import ExpertTeamService
from runtime.supervisor import ManagedRunSupervisor


TASK_ID = "long-horizon-cross-cli-orchestration"
WORKSPACE = ROOT / "tests" / "model-e2e-workspace"


def _contract() -> dict[str, object]:
    return {
        "schema_version": 1,
        "goal": "Independently inspect and verify the fixed E2E source fixture in two rounds.",
        "constraints": [
            "Do not modify the workspace.",
            "Use only the existing e2e-source.txt fixture.",
            "Return exactly the requested JSON contract without prose.",
        ],
        "deliverables": ["Audited evidence for inspection and dependent verification."],
        "acceptance_criteria": [
            "e2e-source.txt exists and its exact trimmed content is expert-team-e2e-v1.",
            "Both required work items receive independent accepted audits.",
        ],
    }


def _work_items() -> list[dict[str, object]]:
    return [
        {
            "schema_version": 1,
            "id": "inspect-source",
            "objective": "Read e2e-source.txt and report its exact trimmed content as evidence; make no changes.",
            "role": "software-engineer",
            "mode": "read",
            "required": True,
            "depends_on": [],
            "ownership": [],
            "evidence_required": ["Exact observed content and the inspected relative path."],
        },
        {
            "schema_version": 1,
            "id": "verify-source",
            "objective": "Independently verify e2e-source.txt against the accepted dependency evidence; make no changes.",
            "role": "software-qa-engineer",
            "mode": "verify",
            "required": True,
            "depends_on": ["inspect-source"],
            "ownership": [],
            "evidence_required": ["Exact content comparison and dependency consistency."],
        },
    ]


async def _run(arguments: argparse.Namespace) -> int:
    service = ExpertTeamService(ROOT, developer="fifine")
    try:
        service.status(TASK_ID, arguments.run_id)
    except (ContractError, FileNotFoundError):
        service.start(
            TASK_ID,
            arguments.run_id,
            _contract(),
            _work_items(),
            max_rounds=4,
            retry_limit=2,
        )
    role = {
        "host": arguments.host,
        "timeout_seconds": arguments.timeout_seconds,
        "context_chars": 16_000,
        "output_chars": 32_000,
    }
    if arguments.model:
        role["model"] = arguments.model
    config = load_runtime_config(
        ROOT,
        {
            "workspace": str(WORKSPACE),
            "max_rounds": 4,
            "retry_limit": 2,
            "max_concurrency": 1,
            "human_completion_gate": True,
            "roles": {name: dict(role) for name in ("manager", "executor", "auditor")},
        },
    )
    outcome = await ManagedRunSupervisor(service, config).run(TASK_ID, arguments.run_id)
    snapshot = outcome.snapshot
    if arguments.approve_completion and snapshot.state == "proposed_complete":
        snapshot = type(snapshot).from_dict(
            service.answer(
                TASK_ID,
                arguments.run_id,
                {
                    "schema_version": 1,
                    "gate_type": "completion",
                    "decision": "approve",
                    "actor": "cost-authorized-e2e",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
        )
    print(
        json.dumps(
            {
                "proof_level": "model_backed_e2e",
                "host": arguments.host,
                "model": arguments.model,
                "run_id": arguments.run_id,
                "episode_ids": list(outcome.episodes),
                "snapshot": snapshot.to_dict(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if snapshot.state in {"proposed_complete", "completed"} else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", choices=("codex", "claude"), required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--model")
    parser.add_argument("--timeout-seconds", type=int, default=300)
    parser.add_argument("--approve-completion", action="store_true")
    parser.add_argument("--yes-cost-bearing", action="store_true")
    arguments = parser.parse_args()
    if not arguments.yes_cost_bearing:
        parser.error("model-backed E2E is opt-in; pass --yes-cost-bearing after explicit authorization")
    return asyncio.run(_run(arguments))


if __name__ == "__main__":
    raise SystemExit(main())
