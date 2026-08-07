"""Fail-closed workspace snapshots for independent Auditor episodes."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
from typing import Mapping

from .core.contracts import ContractError


_EXCLUDED_ROOTS = {".git", ".trellis", ".expert-team", "__pycache__"}


@dataclass(frozen=True)
class WorkspaceEntry:
    kind: str
    size: int
    digest: str


@dataclass(frozen=True)
class WorkspaceSnapshot:
    root: Path
    entries: Mapping[str, WorkspaceEntry]
    errors: tuple[str, ...]

    @property
    def complete(self) -> bool:
        return not self.errors


@dataclass(frozen=True)
class WorkspaceDiff:
    added: tuple[str, ...]
    deleted: tuple[str, ...]
    changed: tuple[str, ...]
    type_changed: tuple[str, ...]
    errors: tuple[str, ...]

    @property
    def clean(self) -> bool:
        return not (self.added or self.deleted or self.changed or self.type_changed or self.errors)


def snapshot_workspace(
    root: Path,
    *,
    max_files: int = 20_000,
    max_hash_bytes: int = 2_000_000,
) -> WorkspaceSnapshot:
    resolved = root.resolve()
    if not resolved.is_dir():
        raise ContractError("workspace snapshot root must be an existing directory")
    if max_files < 1 or max_hash_bytes < 1:
        raise ContractError("workspace snapshot limits must be positive")
    entries: dict[str, WorkspaceEntry] = {}
    errors: list[str] = []
    paths: list[Path] = []

    def on_error(error: OSError) -> None:
        errors.append(str(error))

    for current, directories, files in os.walk(resolved, topdown=True, followlinks=False, onerror=on_error):
        current_path = Path(current)
        directories[:] = sorted(name for name in directories if name not in _EXCLUDED_ROOTS)
        for name in directories:
            paths.append(current_path / name)
        for name in sorted(files):
            if name not in _EXCLUDED_ROOTS:
                paths.append(current_path / name)
    for path in paths:
        relative = path.relative_to(resolved)
        if len(entries) >= max_files:
            errors.append(f"file limit exceeded: {max_files}")
            break
        key = relative.as_posix()
        try:
            if path.is_symlink():
                target = os.readlink(path)
                entries[key] = WorkspaceEntry("symlink", len(target), hashlib.sha256(target.encode()).hexdigest())
            elif path.is_dir():
                entries[key] = WorkspaceEntry("directory", 0, "")
            elif path.is_file():
                stat = path.stat()
                if stat.st_size > max_hash_bytes:
                    errors.append(f"file exceeds hash limit: {key}")
                    continue
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                entries[key] = WorkspaceEntry("file", stat.st_size, digest)
            else:
                entries[key] = WorkspaceEntry("other", 0, "")
        except OSError as error:
            errors.append(f"{key}: {error}")
    return WorkspaceSnapshot(resolved, entries, tuple(errors))


def diff_workspace(before: WorkspaceSnapshot, after: WorkspaceSnapshot) -> WorkspaceDiff:
    if before.root != after.root:
        raise ContractError("workspace snapshots have different roots")
    before_keys = set(before.entries)
    after_keys = set(after.entries)
    added = sorted(after_keys - before_keys)
    deleted = sorted(before_keys - after_keys)
    changed: list[str] = []
    type_changed: list[str] = []
    for key in sorted(before_keys & after_keys):
        left = before.entries[key]
        right = after.entries[key]
        if left.kind != right.kind:
            type_changed.append(key)
        elif left != right:
            changed.append(key)
    return WorkspaceDiff(
        tuple(added),
        tuple(deleted),
        tuple(changed),
        tuple(type_changed),
        (*before.errors, *after.errors),
    )
