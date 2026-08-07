"""Deterministic lightweight/managed qualification without side effects."""

from __future__ import annotations

from typing import Literal

from .core.contracts import ContractError


ExecutionTier = Literal["lightweight", "managed"]


def qualify_execution_tier(
    request: str,
    *,
    explicit: ExecutionTier | None = None,
    dependency_waves: int = 1,
    durable_audit: bool = False,
    human_gates: bool = False,
    evidence_heavy: bool = False,
) -> ExecutionTier:
    if not request.strip():
        raise ContractError("qualification request must not be empty")
    if dependency_waves < 1:
        raise ContractError("dependency_waves must be positive")
    if explicit is not None:
        return explicit
    normalized = request.casefold()
    cross_session = any(
        marker in normalized
        for marker in (
            "cross-session", "cross session", "resume later", "long-running",
            "跨会话", "长期托管", "中断恢复", "持续执行",
        )
    )
    return "managed" if (
        cross_session or dependency_waves > 1 or durable_audit or human_gates or evidence_heavy
    ) else "lightweight"

