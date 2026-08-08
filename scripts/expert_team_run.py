"""Run or probe the managed Expert Team supervisor outside the MCP transport."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.adapters.claude import ClaudeAdapter
from runtime.adapters.codex import CodexAdapter
from runtime.console import build_run_summary, render_narrative
from runtime.config import load_runtime_config
from runtime.service import ExpertTeamService
from runtime.supervisor import ManagedRunSupervisor


async def _main(arguments: argparse.Namespace) -> int:
    if arguments.probe:
        capabilities = await asyncio.gather(CodexAdapter().probe(), ClaudeAdapter().probe())
        print(json.dumps([capability.__dict__ for capability in capabilities], ensure_ascii=False, indent=2))
        return 0 if any(capability.available for capability in capabilities) else 1
    if not arguments.task_id or not arguments.run_id:
        raise SystemExit("--task-id and --run-id are required unless --probe is used")
    service = ExpertTeamService(arguments.repo_root.resolve())
    config = load_runtime_config(arguments.repo_root.resolve())
    outcome = await ManagedRunSupervisor(service, config).run(arguments.task_id, arguments.run_id)
    if arguments.quiet:
        print(json.dumps({"snapshot": outcome.snapshot.to_dict(), "episode_ids": list(outcome.episodes)}, ensure_ascii=False, indent=2))
    else:
        summary = build_run_summary(service, arguments.task_id, arguments.run_id, outcome.snapshot)
        if arguments.json:
            print(json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
        else:
            print(render_narrative(summary))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--task-id")
    parser.add_argument("--run-id")
    parser.add_argument("--probe", action="store_true")
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--quiet", action="store_true", help="keep the legacy JSON result and suppress narrative output")
    output.add_argument("--json", action="store_true", help="emit the public narrative projection as compact JSON")
    return asyncio.run(_main(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
