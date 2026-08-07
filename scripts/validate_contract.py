#!/usr/bin/env python3
"""Validate deterministic expert-team task-plan fixtures."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path, PurePosixPath
from typing import Any


MODES = {"read", "write", "verify"}
STATUSES = {"pending", "running", "completed", "failed", "blocked", "cancelled"}
TERMINAL_STATUSES = {"completed", "failed", "blocked", "cancelled"}
ALLOWED_TRANSITIONS = {
    "pending": {"running", "blocked", "cancelled"},
    "running": TERMINAL_STATUSES,
}
OUTCOMES = {"success", "partial", "blocked", "failed"}


class ContractError(ValueError):
    """Raised when a task plan violates the expert-team contract."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def _normalize_scope(scope: str) -> PurePosixPath:
    value = scope.strip().replace("\\", "/").strip("/")
    _require(bool(value), "ownership scopes must not be empty")
    _require(".." not in PurePosixPath(value).parts, f"ownership scope escapes its root: {scope}")
    return PurePosixPath(value.casefold())


def scopes_overlap(left: str, right: str) -> bool:
    """Return whether two file/module scopes are equal or ancestor-related."""

    a = _normalize_scope(left)
    b = _normalize_scope(right)
    return a == b or a in b.parents or b in a.parents


def _validate_history(task_id: str, status: str, history: Any) -> None:
    _require(isinstance(history, list) and bool(history), f"{task_id}: status_history must be non-empty")
    assert isinstance(history, list)
    _require(all(item in STATUSES for item in history), f"{task_id}: unknown status in history")
    _require(history[0] == "pending", f"{task_id}: history must start at pending")
    _require(history[-1] == status, f"{task_id}: current status must match status_history")
    for previous, current in zip(history, history[1:]):
        allowed = ALLOWED_TRANSITIONS.get(previous, set())
        _require(current in allowed, f"{task_id}: invalid transition {previous} -> {current}")


def validate_plan(plan: Any) -> None:
    """Validate one task plan or raise ContractError."""

    _require(isinstance(plan, dict), "plan must be a JSON object")
    mode = plan.get("execution_mode")
    _require(mode in {"parallel", "sequential"}, "execution_mode must be parallel or sequential")
    outcome = plan.get("outcome")
    _require(outcome in OUTCOMES, "outcome must be success, partial, blocked, or failed")
    tasks = plan.get("tasks")
    _require(isinstance(tasks, list) and bool(tasks), "tasks must be a non-empty array")
    assert isinstance(tasks, list)

    by_id: dict[str, dict[str, Any]] = {}
    for index, raw_task in enumerate(tasks):
        _require(isinstance(raw_task, dict), f"task {index}: must be an object")
        task_id = raw_task.get("id")
        _require(isinstance(task_id, str) and bool(task_id.strip()), f"task {index}: id is required")
        assert isinstance(task_id, str)
        _require(task_id not in by_id, f"duplicate task id: {task_id}")
        by_id[task_id] = raw_task

    for task_id, task in by_id.items():
        _require(isinstance(task.get("objective"), str) and task["objective"].strip(), f"{task_id}: objective is required")
        _require(isinstance(task.get("role"), str) and task["role"].strip(), f"{task_id}: role is required")
        _require(task.get("mode") in MODES, f"{task_id}: invalid mode")
        _require(isinstance(task.get("required"), bool), f"{task_id}: required must be boolean")
        _require(isinstance(task.get("wave"), int) and task["wave"] >= 0, f"{task_id}: wave must be non-negative")
        _require(task.get("status") in STATUSES, f"{task_id}: invalid status")
        dependencies = task.get("depends_on")
        ownership = task.get("ownership")
        _require(isinstance(dependencies, list) and all(isinstance(item, str) for item in dependencies), f"{task_id}: depends_on must be strings")
        _require(isinstance(ownership, list) and all(isinstance(item, str) for item in ownership), f"{task_id}: ownership must be strings")
        assert isinstance(dependencies, list)
        assert isinstance(ownership, list)
        _require(len(set(dependencies)) == len(dependencies), f"{task_id}: duplicate dependency")
        _require(task_id not in dependencies, f"{task_id}: self dependency")
        if task["mode"] == "write":
            _require(bool(ownership), f"{task_id}: write task requires ownership")
        else:
            _require(not ownership, f"{task_id}: non-write task must not claim ownership")
        for scope in ownership:
            _normalize_scope(scope)
        _validate_history(task_id, task["status"], task.get("status_history"))

    for task_id, task in by_id.items():
        for dependency in task["depends_on"]:
            _require(dependency in by_id, f"{task_id}: unknown dependency {dependency}")

    _validate_acyclic(by_id)

    for task_id, task in by_id.items():
        for dependency in task["depends_on"]:
            _require(by_id[dependency]["wave"] < task["wave"], f"{task_id}: dependency {dependency} must use an earlier wave")
        dependency_statuses = [by_id[dependency]["status"] for dependency in task["depends_on"]]
        has_failed_dependency = any(status in {"failed", "blocked", "cancelled"} for status in dependency_statuses)
        if has_failed_dependency:
            _require(task["status"] in {"blocked", "cancelled"}, f"{task_id}: failed dependency requires blocked or cancelled status")
        if task["status"] in {"running", "completed"}:
            _require(all(status == "completed" for status in dependency_statuses), f"{task_id}: active or completed task has incomplete dependency")

    _validate_concurrency(mode, by_id)

    required_incomplete = [
        task_id
        for task_id, task in by_id.items()
        if task["required"] and task["status"] != "completed"
    ]
    _require(not (outcome == "success" and required_incomplete), f"success has incomplete required tasks: {', '.join(required_incomplete)}")


def _validate_acyclic(by_id: dict[str, dict[str, Any]]) -> None:
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(task_id: str) -> None:
        if task_id in visiting:
            raise ContractError(f"dependency cycle contains {task_id}")
        if task_id in visited:
            return
        visiting.add(task_id)
        for dependency in by_id[task_id]["depends_on"]:
            if dependency in by_id:
                visit(dependency)
        visiting.remove(task_id)
        visited.add(task_id)

    for task_id in by_id:
        visit(task_id)


def _validate_concurrency(mode: str, by_id: dict[str, dict[str, Any]]) -> None:
    by_wave: dict[int, list[dict[str, Any]]] = {}
    for task in by_id.values():
        by_wave.setdefault(task["wave"], []).append(task)

    if mode == "sequential":
        for wave, tasks in by_wave.items():
            _require(len(tasks) == 1, f"sequential mode has {len(tasks)} tasks in wave {wave}")
        return

    for wave, tasks in by_wave.items():
        writers = [task for task in tasks if task["mode"] == "write"]
        for index, left in enumerate(writers):
            for right in writers[index + 1 :]:
                for left_scope in left["ownership"]:
                    for right_scope in right["ownership"]:
                        _require(
                            not scopes_overlap(left_scope, right_scope),
                            f"wave {wave}: write ownership overlaps between {left['id']} and {right['id']}",
                        )


def validate_fixture(path: Path) -> tuple[bool, str]:
    with path.open("r", encoding="utf-8") as handle:
        plan = json.load(handle)
    expected = plan.pop("expected_valid", True)
    _require(isinstance(expected, bool), f"{path.name}: expected_valid must be boolean")
    try:
        validate_plan(plan)
        actual = True
        detail = "valid"
    except ContractError as error:
        actual = False
        detail = str(error)
    if actual != expected:
        raise ContractError(f"{path.name}: expected valid={expected}, got valid={actual} ({detail})")
    return actual, detail


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="JSON fixture or directory of fixtures")
    args = parser.parse_args()
    paths = sorted(args.path.glob("*.json")) if args.path.is_dir() else [args.path]
    if not paths:
        print(f"No JSON fixtures found at {args.path}", file=sys.stderr)
        return 2
    try:
        for path in paths:
            actual, detail = validate_fixture(path)
            print(f"PASS {path.name}: valid={actual} ({detail})")
    except (ContractError, OSError, json.JSONDecodeError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
