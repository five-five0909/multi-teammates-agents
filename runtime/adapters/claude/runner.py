"""Real Claude Code episode runner with an explicit read-only Auditor policy."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal, Mapping

from ..base import EpisodeRequest
from ..process import CommandHostAdapter
from .events import normalize_claude_event
from ...core.contracts import BackendEvent


_AUDITOR_WRITE_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")


class ClaudeAdapter(CommandHostAdapter):
    host: Literal["claude"] = "claude"

    def __init__(self, binary: str = "claude") -> None:
        super().__init__(binary)

    def build_command(self, request: EpisodeRequest) -> Sequence[str]:
        command = [
            self.binary,
            "--print",
            "--output-format",
            "stream-json",
            "--verbose",
        ]
        if request.read_only:
            command.append("--disallowedTools")
            command.extend(_AUDITOR_WRITE_TOOLS)
        if request.model:
            command.extend(["--model", request.model])
        return command

    def normalize_record(
        self, record: Mapping[str, Any], request: EpisodeRequest, sequence: int
    ) -> BackendEvent:
        value = dict(record)
        if not any(value.get(key) for key in ("session_id", "uuid")):
            message = value.get("message")
            if not isinstance(message, Mapping) or not message.get("id"):
                value["uuid"] = f"{request.episode_id}:{sequence}"
        return normalize_claude_event(value, role=request.role)

    def extract_visible_output(self, records: Sequence[Mapping[str, Any]]) -> str:
        result_text = ""
        texts: list[str] = []
        for record in records:
            if record.get("type") == "result" and isinstance(record.get("result"), str):
                result_text = str(record["result"]).strip()
            if record.get("type") != "assistant":
                continue
            message = record.get("message")
            content = message.get("content") if isinstance(message, Mapping) else None
            if not isinstance(content, list):
                continue
            for block in content:
                if isinstance(block, Mapping) and block.get("type") == "text":
                    text = block.get("text")
                    if isinstance(text, str) and text.strip():
                        texts.append(text.strip())
        return result_text or "\n\n".join(texts)
