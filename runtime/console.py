"""Public, privacy-bounded terminal views for managed Expert Team runs."""

from __future__ import annotations

from datetime import datetime
import re
from typing import Any, Mapping

from .core.contracts import AuditDecision, ContractError, RoleResult, RunEvent, RunSnapshot
from .service import ExpertTeamService


_SECRET_PATTERNS = (
    re.compile(r"(?i)\b(?:api[_ -]?key|token|password|secret|authorization)\b\s*[:=]\s*[^\s,;]+"),
    re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=-]+"),
    re.compile(r"\bsk-[a-zA-Z0-9_-]{8,}\b"),
)
_SYNC_KINDS = {
    "run.managing",
    "wave.execution_started",
    "wave.audit_started",
    "executor.result_submitted",
    "audit.recorded",
    "human.gate_requested",
    "human.decision_recorded",
    "run.blocked",
    "run.cancelled",
    "episode.started",
    "episode.completed",
    "episode.failed",
    "episode.timeout",
    "episode.cancelled",
    "episode.abandoned",
}


def _safe_text(value: object, *, limit: int = 320) -> str:
    text = " ".join(str(value).split())
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[redacted]", text)
    return text[:limit] + ("…" if len(text) > limit else "")


def _safe_strings(values: object, *, limit: int = 8) -> list[str]:
    if not isinstance(values, (list, tuple)):
        return []
    return [_safe_text(value, limit=180) for value in values[:limit]]


def _payload_string(payload: Mapping[str, Any], key: str) -> str | None:
    value = payload.get(key)
    return value if isinstance(value, str) and value else None


def _payload_strings(payload: Mapping[str, Any], key: str) -> list[str]:
    value = payload.get(key)
    return _safe_strings(value)


def _duration_ms(started: str | None, finished: str | None) -> int | None:
    if not started or not finished:
        return None
    try:
        start = datetime.fromisoformat(started.replace("Z", "+00:00"))
        end = datetime.fromisoformat(finished.replace("Z", "+00:00"))
    except ValueError:
        return None
    return max(0, round((end - start).total_seconds() * 1000))


def _relative_path(service: ExpertTeamService, path: object) -> str | None:
    if not hasattr(path, "relative_to"):
        return None
    try:
        return path.relative_to(service.repo_root).as_posix()  # type: ignore[union-attr]
    except ValueError:
        return None


def _trace_dir(service: ExpertTeamService, store: Any, run_id: str) -> Any:
    canonical = store.trace_dir(run_id)
    if canonical.exists():
        return canonical
    workspace_root = service.repo_root / ".trellis" / "workspace"
    candidates = sorted(workspace_root.glob(f"*/traces/{run_id}"))
    return candidates[0] if len(candidates) == 1 else canonical


def _episode_index(events: tuple[RunEvent, ...]) -> dict[str, dict[str, Any]]:
    episodes: dict[str, dict[str, Any]] = {}
    for event in events:
        if not event.kind.startswith("episode."):
            continue
        episode_id = _payload_string(event.payload, "episode_id")
        role = _payload_string(event.payload, "role")
        if episode_id is None or role is None:
            continue
        current = episodes.setdefault(
            episode_id,
            {
                "episode_id": episode_id,
                "role": role,
                "host": _payload_string(event.payload, "host") or "unknown",
                "work_item_id": _payload_string(event.payload, "work_item_id"),
                "started_at": None,
                "finished_at": None,
                "status": "unknown",
                "trace_ref": None,
                "event_seq": event.seq,
            },
        )
        if event.kind == "episode.started":
            current["started_at"] = event.timestamp
            current["event_seq"] = event.seq
        else:
            current["finished_at"] = event.timestamp
            current["status"] = _payload_string(event.payload, "status") or event.kind.removeprefix("episode.")
            current["trace_ref"] = _payload_string(event.payload, "trace_ref")
    return episodes


def _parse_result(event: RunEvent) -> RoleResult | None:
    if event.kind != "executor.result_submitted":
        return None
    try:
        return RoleResult.from_dict(event.payload)
    except ContractError:
        return None


def _parse_audit(event: RunEvent) -> AuditDecision | None:
    if event.kind != "audit.recorded":
        return None
    try:
        return AuditDecision.from_dict(event.payload)
    except ContractError:
        return None


def _manager_view(payload: Mapping[str, Any], *, fallback: str = "Manager decision recorded; details unavailable") -> dict[str, Any]:
    action = _payload_string(payload, "manager_action")
    message = _payload_string(payload, "manager_message")
    return {
        "profile": "manager",
        "action": action or "execute",
        "message": _safe_text(message or fallback),
        "selected_work_item_ids": _payload_strings(payload, "work_item_ids"),
    }


def _episode_for_result(
    episodes: list[dict[str, Any]],
    result: RoleResult,
    used: set[str],
) -> dict[str, Any] | None:
    for episode in episodes:
        if episode["episode_id"] in used:
            continue
        if episode["role"] == "executor" and episode.get("work_item_id") == result.work_item_id:
            used.add(episode["episode_id"])
            return episode
    return None


def build_run_summary(
    service: ExpertTeamService,
    task_id: str,
    run_id: str,
    snapshot: RunSnapshot | None = None,
) -> dict[str, Any]:
    """Build a stable public projection without reading raw host trajectories."""

    current = snapshot or RunSnapshot.from_dict(service.status(task_id, run_id))
    events = service.events(task_id, run_id)
    episodes_by_id = _episode_index(events)
    episode_list = list(episodes_by_id.values())
    executor_episodes = [episode for episode in episode_list if episode["role"] == "executor"]
    results: dict[tuple[str, int], tuple[RoleResult, int]] = {}
    audits: dict[tuple[str, int], tuple[AuditDecision, int]] = {}
    execution_events: list[RunEvent] = []
    for event in events:
        if event.kind == "wave.execution_started":
            execution_events.append(event)
        result = _parse_result(event)
        if result is not None:
            results[(result.work_item_id, result.attempt)] = (result, event.seq)
        audit = _parse_audit(event)
        if audit is not None:
            audits[(audit.work_item_id, audit.attempt)] = (audit, event.seq)

    rounds: list[dict[str, Any]] = []
    used_episode_ids: set[str] = set()
    for index, event in enumerate(execution_events, start=1):
        payload = event.payload
        raw_round = payload.get("round")
        round_number = raw_round if isinstance(raw_round, int) and raw_round > 0 else index
        selected_ids = _payload_strings(payload, "work_item_ids")
        manager = _manager_view(payload)
        manager["selected_work_item_ids"] = selected_ids or manager["selected_work_item_ids"]
        manager["dependencies"] = {
            item_id: list(current.work_items[item_id].depends_on)
            for item_id in selected_ids
            if item_id in current.work_items
        }
        next_execution_seq = execution_events[index].seq if index < len(execution_events) else None
        executors: list[dict[str, Any]] = []
        for item_id in selected_ids:
            item = current.work_items.get(item_id)
            matching = [
                entry
                for key, entry in results.items()
                if key[0] == item_id
                and entry[1] > event.seq
                and (next_execution_seq is None or entry[1] < next_execution_seq)
            ]
            if not matching:
                matching = [entry for key, entry in results.items() if key[0] == item_id]
            matching.sort(key=lambda entry: entry[0].attempt)
            result_entry = matching[-1] if matching else None
            if result_entry is not None:
                result, result_seq = result_entry
                episode = _episode_for_result(executor_episodes, result, used_episode_ids)
                audit_entry = audits.get((result.work_item_id, result.attempt))
                audit = audit_entry[0] if audit_entry else None
                work_status = audit.status if audit is not None else item.status if item else "unknown"
                executor = {
                    "profile": item.role if item else "unknown",
                    "role": "executor",
                    "work_item_id": result.work_item_id,
                    "objective": _safe_text(item.objective) if item else "not recorded",
                    "status": work_status,
                    "dependencies": list(item.depends_on) if item else [],
                    "attempt": result.attempt,
                    "summary": _safe_text(result.summary),
                    "failure": _safe_text(result.failure) if result.failure else None,
                    "evidence_count": len(result.evidence),
                    "episode": _public_episode(episode, result_seq),
                    "audit": _public_audit(audit),
                }
            else:
                candidates = [episode for episode in executor_episodes if episode.get("work_item_id") == item_id]
                episode = candidates[-1] if candidates else None
                executor = {
                    "profile": item.role if item else "unknown",
                    "role": "executor",
                    "work_item_id": item_id,
                    "objective": _safe_text(item.objective) if item else "not recorded",
                    "status": item.status if item else "unknown",
                    "attempt": item.attempt if item else 0,
                    "summary": "Executor result not recorded",
                    "failure": None,
                    "evidence_count": 0,
                    "episode": _public_episode(episode, event.seq),
                    "audit": None,
                    "dependencies": list(item.depends_on) if item else [],
                }
            executors.append(executor)
        rounds.append({"round": round_number, "manager": manager, "executors": executors})

    for event in events:
        if event.kind != "human.gate_requested" or "manager_action" not in event.payload:
            continue
        rounds.append(
            {
                "round": current.rounds_used or len(rounds) + 1,
                "manager": _manager_view(event.payload, fallback="Manager requested a human gate"),
                "executors": [],
            }
        )

    task_dir = service._task_dir(task_id)  # noqa: SLF001 - renderer is a runtime projection.
    store = service._store(task_id)  # noqa: SLF001 - keeps Trellis paths canonical.
    run_dir = store.run_dir(run_id)
    trace_dir = _trace_dir(service, store, run_id)
    final_report = run_dir / "final-report.md"
    sync = [_public_sync(event) for event in events if event.kind in _SYNC_KINDS]
    return {
        "task_id": task_id,
        "goal": _safe_text(current.contract.goal),
        "run_id": current.run_id,
        "state": current.state,
        "rounds_used": current.rounds_used,
        "max_rounds": current.max_rounds,
        "verified_progress": {key: _safe_strings(value) for key, value in current.verified_progress.items()},
        "pending_gate": current.pending_gate,
        "rounds": rounds,
        "episodes": [_public_episode(episode, episode.get("event_seq")) for episode in episode_list],
        "sync": sync,
        "trellis": {
            "state_file": _relative_path(service, run_dir / "state.json"),
            "events_file": _relative_path(service, run_dir / "events.jsonl"),
            "trace_dir": _relative_path(service, trace_dir),
            "final_report": _relative_path(service, final_report) if final_report.is_file() else None,
            "task_dir": _relative_path(service, task_dir),
        },
    }


def _public_episode(episode: Mapping[str, Any] | None, fallback_seq: int | None) -> dict[str, Any] | None:
    if episode is None:
        return None
    duration = _duration_ms(episode.get("started_at"), episode.get("finished_at"))
    return {
        "episode_id": _safe_text(episode.get("episode_id", "unknown"), limit=140),
        "host": _safe_text(episode.get("host", "unknown"), limit=40),
        "status": _safe_text(episode.get("status", "unknown"), limit=40),
        "duration_ms": duration,
        "trace_ref": _safe_text(episode["trace_ref"], limit=240) if episode.get("trace_ref") else None,
        "event_seq": episode.get("event_seq", fallback_seq),
    }


def _public_audit(audit: AuditDecision | None) -> dict[str, Any]:
    if audit is None:
        return {"status": "unavailable", "fail_closed": True, "message": "audit unavailable; result is not verified"}
    return {
        "status": audit.status,
        "integrity": audit.integrity,
        "contract_alignment": audit.contract_alignment,
        "evidence_count": len(audit.evidence),
        "findings": _safe_strings(audit.findings),
        "required_rework": _safe_strings(audit.required_rework),
        "auditor_profile": "independent-auditor",
    }


def _public_sync(event: RunEvent) -> dict[str, Any]:
    payload = event.payload
    result: dict[str, Any] = {"seq": event.seq, "kind": event.kind}
    for key in ("role", "host", "status", "episode_id", "work_item_id", "gate_type", "trace_ref"):
        value = payload.get(key)
        if isinstance(value, (str, int)):
            result[key] = _safe_text(value, limit=240) if isinstance(value, str) else value
    return result


def render_narrative(summary: Mapping[str, Any]) -> str:
    """Render only public summaries; no raw model stream or command metadata."""

    verified = summary.get("verified_progress")
    verified_count = len(verified) if isinstance(verified, Mapping) else 0
    lines = [
        "Expert Team · managed run",
        f"Goal: {summary.get('goal', 'not recorded')}",
        f"Run: {summary.get('run_id', 'unknown')}  State: {summary.get('state', 'unknown')}  "
        f"Rounds: {summary.get('rounds_used', 0)}/{summary.get('max_rounds', 0)}  "
        f"Verified items: {verified_count}  Pending gate: {summary.get('pending_gate') or 'none'}",
        "",
        "Rounds",
    ]
    rounds = summary.get("rounds")
    if isinstance(rounds, list) and rounds:
        for round_data in rounds:
            if not isinstance(round_data, Mapping):
                continue
            manager = round_data.get("manager")
            lines.append(f"  Round {round_data.get('round', '?')} · Manager (manager)")
            if isinstance(manager, Mapping):
                selected = ", ".join(str(value) for value in manager.get("selected_work_item_ids", [])) or "none"
                lines.append(f"    Decision: {manager.get('action', 'unknown')} · {manager.get('message', '')}")
                lines.append(f"    Selected: {selected}")
                dependencies = manager.get("dependencies")
                if isinstance(dependencies, Mapping):
                    dependency_text = "; ".join(
                        f"{item_id}<-{', '.join(str(value) for value in values) or 'none'}"
                        for item_id, values in dependencies.items()
                    )
                    if dependency_text:
                        lines.append(f"    Dependencies: {dependency_text}")
            executors = round_data.get("executors")
            if isinstance(executors, list):
                for executor in executors:
                    if not isinstance(executor, Mapping):
                        continue
                    lines.append(
                        f"    Executor · {executor.get('profile', 'unknown')} · {executor.get('work_item_id', 'unknown')} · "
                        f"{executor.get('status', 'unknown')} · {executor.get('summary', '')}"
                    )
                    dependencies = executor.get("dependencies")
                    if isinstance(dependencies, list) and dependencies:
                        lines.append(f"      Dependencies: {', '.join(str(value) for value in dependencies)}")
                    episode = executor.get("episode")
                    if isinstance(episode, Mapping):
                        duration = episode.get("duration_ms")
                        duration_text = f"{duration} ms" if isinstance(duration, int) else "duration unavailable"
                        lines.append(f"      Episode: {episode.get('status', 'unknown')} · {duration_text}")
                    audit = executor.get("audit")
                    if isinstance(audit, Mapping) and audit.get("status") == "unavailable":
                        lines.append("      Auditor · unavailable · fail-closed (result not verified)")
                    elif isinstance(audit, Mapping):
                        lines.append(
                            f"      Auditor · {audit.get('auditor_profile', 'independent-auditor')} · "
                            f"{audit.get('status', 'unknown')} · integrity={audit.get('integrity', 'unknown')} · "
                            f"alignment={audit.get('contract_alignment', 'unknown')} · "
                            f"evidence={audit.get('evidence_count', 0)}"
                        )
                        rework = audit.get("required_rework")
                        if isinstance(rework, list) and rework:
                            lines.append(f"        Rework: {'; '.join(str(value) for value in rework)}")
    else:
        lines.append("  No round narrative recorded; this run predates the console metadata.")

    lines.extend(["", "Trellis sync"])
    sync = summary.get("sync")
    if isinstance(sync, list) and sync:
        for event in sync:
            if not isinstance(event, Mapping):
                continue
            details = " ".join(
                f"{key}={event[key]}"
                for key in ("role", "work_item_id", "status", "gate_type", "trace_ref")
                if key in event
            )
            lines.append(f"  #{event.get('seq', '?')} {event.get('kind', 'unknown')}" + (f" · {details}" if details else ""))
    else:
        lines.append("  No synchronization events recorded.")

    trellis = summary.get("trellis")
    if isinstance(trellis, Mapping):
        lines.extend(["", "Trellis references"])
        for label in ("state_file", "events_file", "trace_dir", "final_report"):
            value = trellis.get(label)
            if value:
                lines.append(f"  {label}: {value}")
    return "\n".join(lines)
