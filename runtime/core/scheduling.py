"""Dependency and write-ownership checks shared by all orchestration modes."""

from __future__ import annotations

from pathlib import PurePosixPath
from typing import Iterable

from .contracts import ContractError, WorkItem


def normalize_scope(scope: str) -> PurePosixPath:
    value = scope.strip().replace("\\", "/").strip("/")
    if not value:
        raise ContractError("ownership scopes must not be empty")
    path = PurePosixPath(value.casefold())
    if ".." in path.parts:
        raise ContractError(f"ownership scope escapes its root: {scope}")
    return path


def scopes_overlap(left: str, right: str) -> bool:
    a = normalize_scope(left)
    b = normalize_scope(right)
    return a == b or a in b.parents or b in a.parents


def validate_work_graph(items: Iterable[WorkItem]) -> dict[str, WorkItem]:
    by_id: dict[str, WorkItem] = {}
    for item in items:
        if item.id in by_id:
            raise ContractError(f"duplicate work item id: {item.id}")
        by_id[item.id] = item
    if not by_id:
        raise ContractError("managed run requires at least one work item")
    for item in by_id.values():
        if item.id in item.depends_on:
            raise ContractError(f"{item.id}: self dependency")
        for dependency in item.depends_on:
            if dependency not in by_id:
                raise ContractError(f"{item.id}: unknown dependency {dependency}")
        for scope in item.ownership:
            normalize_scope(scope)

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(item_id: str) -> None:
        if item_id in visiting:
            raise ContractError(f"dependency cycle contains {item_id}")
        if item_id in visited:
            return
        visiting.add(item_id)
        for dependency in by_id[item_id].depends_on:
            visit(dependency)
        visiting.remove(item_id)
        visited.add(item_id)

    for item_id in by_id:
        visit(item_id)
    return by_id


def validate_parallel_wave(items: Iterable[WorkItem]) -> None:
    writers = [item for item in items if item.mode == "write"]
    for index, left in enumerate(writers):
        for right in writers[index + 1 :]:
            for left_scope in left.ownership:
                for right_scope in right.ownership:
                    if scopes_overlap(left_scope, right_scope):
                        raise ContractError(f"write ownership overlaps between {left.id} and {right.id}")

