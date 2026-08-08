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
from runtime.core.contracts import ContractError
from runtime.service import ExpertTeamService
from runtime.supervisor import ManagedRunSupervisor


def _read_json(path_or_json: str | Path, *, expected: str) -> object:
    """Read a JSON file, with inline JSON as a small CLI convenience."""

    raw = str(path_or_json)
    path = Path(raw).expanduser()
    try:
        inline = raw.lstrip()
        text = path.read_text(encoding="utf-8") if inline[:1] not in {"{", "["} and path.is_file() else raw
    except OSError as error:
        raise ContractError(f"cannot read {expected} JSON: {path}") from error
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        raise ContractError(f"invalid {expected} JSON: {error.msg}") from error


def _emit_summary(
    service: ExpertTeamService,
    arguments: argparse.Namespace,
    snapshot: dict[str, object],
    *,
    episode_ids: list[str] | None = None,
) -> None:
    """Render a public snapshot using the same projections as the MCP server."""

    if arguments.quiet:
        payload: object = snapshot if episode_ids is None else {"snapshot": snapshot, "episode_ids": episode_ids}
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    summary = build_run_summary(service, arguments.task_id, arguments.run_id)
    if arguments.json:
        print(json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
    else:
        print(render_narrative(summary))


async def _main(arguments: argparse.Namespace) -> int:
    if arguments.probe:
        capabilities = await asyncio.gather(CodexAdapter().probe(), ClaudeAdapter().probe())
        print(json.dumps([capability.__dict__ for capability in capabilities], ensure_ascii=False, indent=2))
        return 0 if any(capability.available for capability in capabilities) else 1
    if not arguments.task_id or not arguments.run_id:
        raise SystemExit("--task-id and --run-id are required unless --probe is used")
    service = ExpertTeamService(arguments.repo_root.resolve())
    if arguments.start:
        if not arguments.contract_file or not arguments.work_items_file:
            raise SystemExit("--start requires --contract-file and --work-items-file")
        contract = _read_json(arguments.contract_file, expected="TaskContract")
        work_items = _read_json(arguments.work_items_file, expected="WorkItem list")
        snapshot = service.start(
            arguments.task_id,
            arguments.run_id,
            contract,
            work_items,
            max_rounds=arguments.max_rounds,
            retry_limit=arguments.retry_limit,
        )
        _emit_summary(service, arguments, snapshot)
        return 0
    if arguments.status:
        _emit_summary(service, arguments, service.status(arguments.task_id, arguments.run_id))
        return 0
    if arguments.resume:
        print(json.dumps(service.resume(arguments.task_id, arguments.run_id), ensure_ascii=False, indent=2))
        return 0
    if arguments.answer is not None:
        decision = _read_json(arguments.answer, expected="HumanDecision")
        snapshot = service.answer(arguments.task_id, arguments.run_id, decision)
        _emit_summary(service, arguments, snapshot)
        return 0
    if arguments.cancel:
        snapshot = service.cancel(
            arguments.task_id,
            arguments.run_id,
            {"reason": arguments.cancel_reason} if arguments.cancel_reason else None,
        )
        _emit_summary(service, arguments, snapshot)
        return 0

    # The historical no-action behavior remains foreground execution.  --run
    # and --foreground make that intent explicit for scripts and documentation.
    config = load_runtime_config(arguments.repo_root.resolve())
    outcome = await ManagedRunSupervisor(service, config).run(arguments.task_id, arguments.run_id)
    _emit_summary(service, arguments, outcome.snapshot.to_dict(), episode_ids=list(outcome.episodes))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--task-id")
    parser.add_argument("--run-id")
    parser.add_argument("--probe", action="store_true")
    lifecycle = parser.add_mutually_exclusive_group()
    lifecycle.add_argument("--start", action="store_true", help="create a durable run without launching model episodes")
    lifecycle.add_argument("--foreground", "--run", dest="foreground", action="store_true", help="run the managed supervisor")
    lifecycle.add_argument("--status", action="store_true", help="show the current public run status")
    lifecycle.add_argument("--resume", action="store_true", help="show compact state for resuming a run")
    lifecycle.add_argument("--answer", metavar="DECISION_JSON", help="record a HumanDecision JSON file or inline JSON")
    lifecycle.add_argument("--cancel", action="store_true", help="cancel a run without deleting its evidence")
    parser.add_argument("--contract-file", type=Path, help="TaskContract JSON file used with --start")
    parser.add_argument("--work-items-file", type=Path, help="WorkItem array JSON file used with --start")
    parser.add_argument("--max-rounds", type=int, default=20, help="round budget used with --start")
    parser.add_argument("--retry-limit", type=int, default=2, help="per-item retry budget used with --start")
    parser.add_argument("--cancel-reason", help="optional public reason recorded with --cancel")
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--quiet", action="store_true", help="keep the legacy JSON result and suppress narrative output")
    output.add_argument("--json", action="store_true", help="emit the public narrative projection as compact JSON")
    try:
        return asyncio.run(_main(parser.parse_args()))
    except ContractError as error:
        print(f"expert-team: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
