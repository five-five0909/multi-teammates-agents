"""Platform-neutral contracts and state transitions."""

from .contracts import (
    AuditDecision,
    BackendEvent,
    ContractError,
    HumanDecision,
    RoleResult,
    RunEvent,
    RunSnapshot,
    TaskContract,
    WorkItem,
)
from .reducer import apply_event, create_snapshot, replay

__all__ = [
    "AuditDecision",
    "BackendEvent",
    "ContractError",
    "HumanDecision",
    "RoleResult",
    "RunEvent",
    "RunSnapshot",
    "TaskContract",
    "WorkItem",
    "apply_event",
    "create_snapshot",
    "replay",
]

