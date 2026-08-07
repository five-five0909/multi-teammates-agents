"""Real Codex CLI episode runner with host-controlled permissions."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal, Mapping

from ..base import EpisodeRequest
from ..process import CommandHostAdapter
from .events import normalize_codex_event
from ...core.contracts import BackendEvent


class CodexAdapter(CommandHostAdapter):
    host: Literal["codex"] = "codex"

    def __init__(self, binary: str = "codex") -> None:
        super().__init__(binary)

    def build_command(self, request: EpisodeRequest) -> Sequence[str]:
        command = [self.binary, "exec", "--json", "--skip-git-repo-check"]
        if request.model:
            command.extend(["--model", request.model])
        command.append("-")
        return command

    def normalize_record(
        self, record: Mapping[str, Any], request: EpisodeRequest, sequence: int
    ) -> BackendEvent:
        value = dict(record)
        if not any(value.get(key) for key in ("thread_id", "id")):
            value["id"] = f"{request.episode_id}:{sequence}"
        return normalize_codex_event(value, role=request.role)

    def extract_visible_output(self, records: Sequence[Mapping[str, Any]]) -> str:
        texts: list[str] = []
        for record in records:
            item = record.get("item")
            if not isinstance(item, Mapping) or item.get("type") != "agent_message":
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                texts.append(text.strip())
        return "\n\n".join(texts)
