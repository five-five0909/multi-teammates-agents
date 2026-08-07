"""Executable host-adapter contracts for fresh managed role episodes.

The episode boundary is informed by LongHorizon-Harness' MIT-licensed
``CommandAgentAdapter`` at commit b1b804519c1ffe1b00e60c19290157c82e3e5c83,
but is rewritten for Trellis persistence and host-controlled permissions.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal, Mapping, Protocol

from ..core.contracts import BackendEvent, ContractError


HostName = Literal["codex", "claude"]
EpisodeRole = Literal["manager", "executor", "auditor"]
EpisodeStatus = Literal[
    "done", "error", "timeout", "cancelled", "permission_required"
]
EventSink = Callable[[BackendEvent], None]


@dataclass(frozen=True)
class HostCapabilities:
    host: HostName
    available: bool
    binary: str
    version: str | None = None
    error: str | None = None
    supports_streaming: bool = True


@dataclass(frozen=True)
class EpisodeRequest:
    episode_id: str
    run_id: str
    round_index: int
    role: EpisodeRole
    profile: str
    prompt: str
    workspace: Path
    model: str | None = None
    timeout_seconds: int = 600
    max_output_chars: int = 200_000
    permission_posture: str = "host-controlled"
    read_only: bool = False
    work_item_id: str | None = None

    def __post_init__(self) -> None:
        for label, value in (
            ("episode_id", self.episode_id),
            ("run_id", self.run_id),
            ("profile", self.profile),
            ("prompt", self.prompt),
            ("permission_posture", self.permission_posture),
        ):
            if not value.strip():
                raise ContractError(f"EpisodeRequest.{label} must not be empty")
        if self.round_index < 1:
            raise ContractError("EpisodeRequest.round_index must be positive")
        if self.timeout_seconds < 1 or self.max_output_chars < 1:
            raise ContractError("episode timeout and output budget must be positive")
        workspace = self.workspace.resolve()
        if not workspace.is_dir():
            raise ContractError("EpisodeRequest.workspace must be an existing directory")
        object.__setattr__(self, "workspace", workspace)
        if self.role == "auditor" and not self.read_only:
            raise ContractError("Auditor EpisodeRequest must be read-only")
        if self.role in {"executor", "auditor"} and not self.work_item_id:
            raise ContractError(f"{self.role} EpisodeRequest requires work_item_id")
        if self.role == "manager" and self.work_item_id is not None:
            raise ContractError("Manager EpisodeRequest cannot select work_item_id")


@dataclass(frozen=True)
class EpisodeResult:
    episode_id: str
    host: HostName
    role: EpisodeRole
    status: EpisodeStatus
    visible_output: str
    events: tuple[BackendEvent, ...]
    duration_ms: int
    exit_code: int | None
    error: str | None = None
    raw_stdout: str = field(default="", repr=False)
    raw_stderr: str = field(default="", repr=False)
    metadata: Mapping[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class CancellationResult:
    episode_id: str
    found: bool
    terminated: bool


class CancellationToken:
    """Cooperative cancellation shared by supervisor and process adapters."""

    def __init__(self) -> None:
        self._event = asyncio.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    async def wait(self) -> None:
        await self._event.wait()


class HostAdapter(Protocol):
    @property
    def host(self) -> HostName: ...

    async def probe(self) -> HostCapabilities: ...

    async def run_episode(
        self,
        request: EpisodeRequest,
        event_sink: EventSink | None = None,
        cancellation: CancellationToken | None = None,
    ) -> EpisodeResult: ...

    async def cancel(self, episode_id: str) -> CancellationResult: ...
