"""Strict JSON/JSONL boundary for managed runtime records."""

from __future__ import annotations

import json
from typing import Iterable

from .contracts import ContractError, RunEvent


def encode_event(event: RunEvent) -> str:
    return json.dumps(event.to_dict(), ensure_ascii=False, separators=(",", ":"))


def decode_event(line: str, *, line_number: int | None = None) -> RunEvent:
    label = f"event line {line_number}" if line_number is not None else "event"
    if not line.strip():
        raise ContractError(f"{label} is empty")
    try:
        value = json.loads(line)
    except json.JSONDecodeError as error:
        raise ContractError(f"{label} is invalid JSON: {error.msg}") from error
    try:
        return RunEvent.from_dict(value)
    except ContractError as error:
        raise ContractError(f"{label} is invalid: {error}") from error


def decode_events(lines: Iterable[str]) -> list[RunEvent]:
    return [decode_event(line, line_number=index) for index, line in enumerate(lines, start=1)]

