"""Shell-free async process runtime shared by Codex and Claude adapters."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from typing import Any, Mapping

from .base import (
    CancellationResult,
    CancellationToken,
    EpisodeRequest,
    EpisodeResult,
    EventSink,
    HostCapabilities,
    HostName,
)
from ..core.contracts import BackendEvent, ContractError


_SECRET_PATTERN = re.compile(
    r"(?i)(api[_-]?key|auth[_-]?token|access[_-]?token|password|secret)(\s*[=:]\s*)([^\s,;]+)"
)


def redact_secrets(text: str) -> str:
    return _SECRET_PATTERN.sub(r"\1\2***REDACTED***", text)


class CommandHostAdapter:
    """Run one fresh CLI process per role episode and normalize its JSONL."""

    host: HostName

    def __init__(self, binary: str) -> None:
        if not binary.strip():
            raise ContractError("host binary must not be empty")
        self.binary = binary
        self._active: dict[str, asyncio.subprocess.Process] = {}

    def build_command(self, request: EpisodeRequest) -> Sequence[str]:
        raise NotImplementedError

    def normalize_record(
        self, record: Mapping[str, Any], request: EpisodeRequest, sequence: int
    ) -> BackendEvent:
        raise NotImplementedError

    def extract_visible_output(self, records: Sequence[Mapping[str, Any]]) -> str:
        raise NotImplementedError

    async def probe(self) -> HostCapabilities:
        resolved = shutil.which(self.binary)
        if resolved is None:
            return HostCapabilities(self.host, False, self.binary, error="binary not found on PATH")
        try:
            process = await asyncio.create_subprocess_exec(
                resolved,
                "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10)
        except (OSError, asyncio.TimeoutError) as error:
            return HostCapabilities(self.host, False, resolved, error=str(error))
        version = (stdout or stderr).decode("utf-8", errors="replace").strip()
        if process.returncode != 0:
            return HostCapabilities(
                self.host,
                False,
                resolved,
                version=version or None,
                error=f"--version exited {process.returncode}",
            )
        return HostCapabilities(self.host, True, resolved, version=version or None)

    async def run_episode(
        self,
        request: EpisodeRequest,
        event_sink: EventSink | None = None,
        cancellation: CancellationToken | None = None,
    ) -> EpisodeResult:
        if request.episode_id in self._active:
            raise ContractError(f"episode is already active: {request.episode_id}")
        command = tuple(self.build_command(request))
        self._validate_command(command)
        started = time.monotonic()
        try:
            if sys.platform == "win32":
                process = await asyncio.create_subprocess_exec(
                    *command,
                    cwd=str(request.workspace),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
                )
            else:
                process = await asyncio.create_subprocess_exec(
                    *command,
                    cwd=str(request.workspace),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    start_new_session=True,
                )
        except OSError as error:
            return EpisodeResult(
                request.episode_id,
                self.host,
                request.role,
                "error",
                "",
                (),
                int((time.monotonic() - started) * 1000),
                None,
                error=redact_secrets(str(error)),
                metadata={"command": list(command), "fresh_process": True},
            )
        self._active[request.episode_id] = process
        records: list[Mapping[str, Any]] = []
        events: list[BackendEvent] = []
        parse_errors: list[str] = []
        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        stdout_chars = 0
        stderr_chars = 0
        truncated = False

        async def read_stdout() -> None:
            nonlocal stdout_chars, truncated
            assert process.stdout is not None
            sequence = 0
            while True:
                raw = await process.stdout.readline()
                if not raw:
                    return
                line = raw.decode("utf-8", errors="replace")
                remaining = request.max_output_chars - stdout_chars
                if remaining > 0:
                    captured = line[:remaining]
                    stdout_parts.append(captured)
                    stdout_chars += len(captured)
                    truncated = truncated or len(captured) < len(line)
                else:
                    truncated = True
                if not line.strip():
                    continue
                sequence += 1
                try:
                    value = json.loads(line)
                    if not isinstance(value, Mapping):
                        raise ContractError("stream record must be an object")
                    records.append(value)
                    event = self.normalize_record(value, request, sequence)
                except (json.JSONDecodeError, ContractError) as error:
                    parse_errors.append(f"line {sequence}: {error}")
                    continue
                events.append(event)
                if event_sink is not None:
                    event_sink(event)

        async def read_stderr() -> None:
            nonlocal stderr_chars, truncated
            assert process.stderr is not None
            while True:
                raw = await process.stderr.readline()
                if not raw:
                    return
                line = raw.decode("utf-8", errors="replace")
                remaining = request.max_output_chars - stderr_chars
                if remaining > 0:
                    captured = line[:remaining]
                    stderr_parts.append(captured)
                    stderr_chars += len(captured)
                    truncated = truncated or len(captured) < len(line)
                else:
                    truncated = True

        stdout_task = asyncio.create_task(read_stdout())
        stderr_task = asyncio.create_task(read_stderr())
        wait_task = asyncio.create_task(process.wait())
        cancel_token = cancellation or CancellationToken()
        cancel_task = asyncio.create_task(cancel_token.wait())
        termination: str | None = None
        try:
            assert process.stdin is not None
            process.stdin.write(request.prompt.encode("utf-8"))
            await process.stdin.drain()
            process.stdin.close()
            done, _ = await asyncio.wait(
                {wait_task, cancel_task},
                timeout=request.timeout_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if wait_task in done:
                await wait_task
            elif cancel_task in done:
                termination = "cancelled"
                await self._terminate_process_tree(process)
                await wait_task
            else:
                termination = "timeout"
                await self._terminate_process_tree(process)
                await wait_task
        finally:
            cancel_task.cancel()
            await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
            self._active.pop(request.episode_id, None)

        stdout = redact_secrets("".join(stdout_parts))
        stderr = redact_secrets("".join(stderr_parts))
        if termination == "cancelled":
            status = "cancelled"
        elif termination == "timeout":
            status = "timeout"
        elif parse_errors:
            status = "error"
        elif process.returncode == 0:
            status = "done"
        else:
            status = "permission_required" if any(
                event.status == "permission_required" for event in events
            ) else "error"
        error_parts = list(parse_errors)
        if status not in {"done", "cancelled"} and stderr.strip():
            error_parts.append(stderr[-2000:])
        return EpisodeResult(
            request.episode_id,
            self.host,
            request.role,
            status,  # type: ignore[arg-type]
            self.extract_visible_output(records).strip(),
            tuple(events),
            int((time.monotonic() - started) * 1000),
            process.returncode,
            error="\n".join(error_parts).strip() or None,
            raw_stdout=stdout,
            raw_stderr=stderr,
            metadata={
                "command": list(command),
                "fresh_process": True,
                "read_only": request.read_only,
                "permission_posture": request.permission_posture,
                "output_truncated": truncated,
                "record_count": len(records),
            },
        )

    async def cancel(self, episode_id: str) -> CancellationResult:
        process = self._active.get(episode_id)
        if process is None:
            return CancellationResult(episode_id, False, False)
        await self._terminate_process_tree(process)
        return CancellationResult(episode_id, True, process.returncode is not None)

    def _validate_command(self, command: Sequence[str]) -> None:
        forbidden = {
            "--dangerously-" + "bypass-approvals-and-sandbox",
            "--dangerously-" + "skip-permissions",
        }
        if not command or not all(isinstance(value, str) and value for value in command):
            raise ContractError("host command must be a non-empty argument list")
        overlap = forbidden.intersection(command)
        if overlap:
            raise ContractError(f"host command requests forbidden bypass: {sorted(overlap)[0]}")

    @staticmethod
    async def _terminate_process_tree(process: asyncio.subprocess.Process) -> None:
        if process.returncode is not None:
            return
        if sys.platform == "win32":
            killer = await asyncio.create_subprocess_exec(
                "taskkill",
                "/PID",
                str(process.pid),
                "/T",
                "/F",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                await asyncio.wait_for(killer.wait(), timeout=10)
            except asyncio.TimeoutError:
                killer.kill()
            if process.returncode is None:
                process.kill()
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
            await asyncio.wait_for(process.wait(), timeout=3)
        except (ProcessLookupError, asyncio.TimeoutError):
            if process.returncode is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
