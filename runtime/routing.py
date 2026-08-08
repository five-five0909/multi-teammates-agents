"""Single, deterministic owner for Expert Team mode policy.

The old router treated ``explicit=lightweight`` as an override.  That made a
caller-provided hint stronger than facts such as an active Trellis task or a
required audit.  This module now returns a structured assessment for the
entry gate; the small ``qualify_execution_tier`` projection remains only for
legacy read-only callers.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any, Literal, Mapping

from .core.contracts import ContractError


ExecutionTier = Literal["lightweight", "managed"]
DecisionState = Literal["policy_locked", "selection_required", "resolved", "stale_session"]

ROUTING_SCHEMA_VERSION = 2


def _fingerprint(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _contains_any(value: str, markers: tuple[str, ...]) -> bool:
    return any(marker in value for marker in markers)


@dataclass(frozen=True)
class ModeAssessment:
    schema_version: int
    invocation_id: str
    request_fingerprint: str
    intent: Literal["analysis", "implementation", "audit"]
    invocation_kind: Literal["explicit", "implicit"]
    policy_floor: ExecutionTier
    allowed_tiers: tuple[ExecutionTier, ...]
    recommended_tier: ExecutionTier
    decision_state: DecisionState
    reasons: tuple[Mapping[str, str], ...]
    host: Mapping[str, Any]
    trellis: Mapping[str, Any]
    next_action: str

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "ModeAssessment":
        if not isinstance(value, Mapping):
            raise ContractError("ModeAssessment must be an object")
        required = {
            "schema_version", "invocation_id", "request_fingerprint", "intent", "invocation_kind",
            "policy_floor", "allowed_tiers", "recommended_tier", "decision_state", "reasons",
            "host", "trellis", "next_action",
        }
        unknown = set(value) - required
        missing = required - set(value)
        if missing or unknown:
            raise ContractError(
                f"ModeAssessment fields invalid; missing={','.join(sorted(missing))}; unknown={','.join(sorted(unknown))}"
            )
        if value["schema_version"] != ROUTING_SCHEMA_VERSION:
            raise ContractError("ModeAssessment.schema_version is stale")
        allowed = value["allowed_tiers"]
        if not isinstance(allowed, list) or not allowed or any(item not in {"lightweight", "managed"} for item in allowed):
            raise ContractError("ModeAssessment.allowed_tiers is invalid")
        reasons = value["reasons"]
        if not isinstance(reasons, list) or not all(isinstance(item, Mapping) for item in reasons):
            raise ContractError("ModeAssessment.reasons is invalid")
        for field in ("invocation_id", "request_fingerprint", "next_action"):
            if not isinstance(value[field], str) or not value[field].strip():
                raise ContractError(f"ModeAssessment.{field} must be a non-empty string")
        if value["intent"] not in {"analysis", "implementation", "audit"}:
            raise ContractError("ModeAssessment.intent is invalid")
        if value["invocation_kind"] not in {"explicit", "implicit"}:
            raise ContractError("ModeAssessment.invocation_kind is invalid")
        if value["policy_floor"] not in {"lightweight", "managed"} or value["recommended_tier"] not in {"lightweight", "managed"}:
            raise ContractError("ModeAssessment tier is invalid")
        if value["decision_state"] not in {"policy_locked", "selection_required", "resolved", "stale_session"}:
            raise ContractError("ModeAssessment.decision_state is invalid")
        if not isinstance(value["host"], Mapping) or not isinstance(value["trellis"], Mapping):
            raise ContractError("ModeAssessment host/trellis fields must be objects")
        return cls(
            ROUTING_SCHEMA_VERSION,
            value["invocation_id"],
            value["request_fingerprint"],
            value["intent"],  # type: ignore[arg-type]
            value["invocation_kind"],  # type: ignore[arg-type]
            value["policy_floor"],  # type: ignore[arg-type]
            tuple(allowed),  # type: ignore[arg-type]
            value["recommended_tier"],  # type: ignore[arg-type]
            value["decision_state"],  # type: ignore[arg-type]
            tuple(dict(item) for item in reasons),
            dict(value["host"]),
            dict(value["trellis"]),
            value["next_action"],
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "invocation_id": self.invocation_id,
            "request_fingerprint": self.request_fingerprint,
            "intent": self.intent,
            "invocation_kind": self.invocation_kind,
            "policy_floor": self.policy_floor,
            "allowed_tiers": list(self.allowed_tiers),
            "recommended_tier": self.recommended_tier,
            "decision_state": self.decision_state,
            "reasons": [dict(reason) for reason in self.reasons],
            "host": dict(self.host),
            "trellis": dict(self.trellis),
            "next_action": self.next_action,
        }


def build_mode_assessment(
    request: str,
    *,
    invocation_id: str,
    explicit: ExecutionTier | None = None,
    dependency_waves: int = 1,
    durable_audit: bool = False,
    human_gates: bool = False,
    evidence_heavy: bool = False,
    task_id: str | None = None,
    task_status: str | None = None,
    host_mode: str = "unknown",
    intent: Literal["analysis", "implementation", "audit"] = "implementation",
    invocation_kind: Literal["explicit", "implicit"] = "explicit",
    selection_surface: str = "none",
    hook_trusted: bool | None = None,
    assurance_capabilities: tuple[str, ...] = (),
    requires_independent_audit: bool = False,
) -> ModeAssessment:
    """Build a side-effect-free assessment from facts available at the gate."""

    if not isinstance(request, str) or not request.strip():
        raise ContractError("qualification request must not be empty")
    if not isinstance(invocation_id, str) or not invocation_id.strip():
        raise ContractError("invocation_id must be a non-empty string")
    if explicit not in {None, "lightweight", "managed"}:
        raise ContractError("explicit mode must be lightweight or managed")
    if dependency_waves < 1:
        raise ContractError("dependency_waves must be positive")
    if host_mode not in {"inline", "subagent", "unknown"}:
        raise ContractError("host_mode must be inline, subagent, or unknown")
    if intent not in {"analysis", "implementation", "audit"}:
        raise ContractError("intent must be analysis, implementation, or audit")
    if invocation_kind not in {"explicit", "implicit"}:
        raise ContractError("invocation_kind must be explicit or implicit")

    normalized = request.casefold()
    reasons: list[dict[str, str]] = []

    def reason(code: str, source: str, detail: str) -> None:
        reasons.append({"code": code, "source": source, "detail": detail})

    hard_floor = False
    if explicit == "managed":
        hard_floor = True
        reason("explicit_managed", "request", "caller requested durable managed governance")
    if explicit == "lightweight":
        reason("legacy_lightweight_preference", "request", "lightweight is a preference, not a policy override")
    if task_status in {"planning", "in_progress"}:
        hard_floor = True
        reason("active_trellis_task", "trellis", f"task {task_id or '(unknown)'} is {task_status}")
    if dependency_waves > 1:
        hard_floor = True
        reason("multiple_dependency_waves", "graph", f"dependency_waves={dependency_waves}")
    if durable_audit:
        hard_floor = True
        reason("durable_audit", "request", "durable audit was requested")
    if human_gates:
        hard_floor = True
        reason("human_gate", "request", "human approval gates were requested")
    if evidence_heavy:
        hard_floor = True
        reason("evidence_heavy", "request", "evidence-heavy verification was requested")
    if requires_independent_audit:
        hard_floor = True
        reason("independent_audit", "request", "independent auditor capability is required")
    if _contains_any(
        normalized,
        (
            "cross-session", "cross session", "resume later", "long-running", "持续执行",
            "跨会话", "中断恢复", "恢复", "持久化审计", "independent audit", "独立审计",
            "trellis", "spec 更新", "spec update", "commit", "重复运行", "失败返工",
            "生产", "production", "security", "安全", "迁移", "migration",
        ),
    ):
        hard_floor = True
        reason("durable_or_high_risk_request", "request", "request language requires durable or high-risk controls")
    if intent == "audit":
        hard_floor = True
        reason("audit_intent", "request", "audit intent requires durable evidence")

    policy_floor: ExecutionTier = "managed" if hard_floor else "lightweight"
    allowed: tuple[ExecutionTier, ...] = ("managed",) if hard_floor else ("managed", "lightweight")
    decision_state: DecisionState = "policy_locked" if hard_floor else "selection_required"

    if host_mode == "inline":
        execution_mode = "main-session-sequential"
        fallback_reason = "inline host keeps implementation and checks in the main session"
    elif host_mode == "subagent":
        execution_mode = "managed-supervised" if hard_floor else "native-delegation"
        fallback_reason = None
    else:
        execution_mode = "unresolved"
        fallback_reason = "host execution mode must be declared before dispatch"

    capabilities = list(dict.fromkeys(assurance_capabilities))
    if policy_floor == "managed":
        for capability in ("durable_state", "lead_verification"):
            if capability not in capabilities:
                capabilities.append(capability)
    if requires_independent_audit and "independent_audit" not in capabilities:
        reason("capability_blocked", "host", "independent audit is required but unavailable in this host mode")

    if policy_floor == "managed":
        if intent == "implementation" and task_status is None:
            next_action = "request_task_consent"
        elif task_status == "planning":
            next_action = "planning_review"
        elif task_status == "in_progress":
            next_action = "build_graph"
        else:
            next_action = "build_graph"
    else:
        next_action = "select_mode"

    enforcement = "enforced" if hook_trusted is True else "advisory" if hook_trusted is False else "partial"
    host = {
        "execution_mode": execution_mode,
        "fallback_reason": fallback_reason,
        "assurance_capabilities": capabilities,
        "selection_surface": selection_surface,
        "enforcement_level": enforcement,
    }
    trellis = {"task_id": task_id, "task_status": task_status}
    return ModeAssessment(
        ROUTING_SCHEMA_VERSION,
        invocation_id,
        _fingerprint({"request": request, "intent": intent, "task_id": task_id, "task_status": task_status}),
        intent,
        invocation_kind,
        policy_floor,
        allowed,
        "managed",
        decision_state,
        tuple(reasons),
        host,
        trellis,
        next_action,
    )


def qualify_execution_tier(
    request: str,
    *,
    explicit: ExecutionTier | None = None,
    dependency_waves: int = 1,
    durable_audit: bool = False,
    human_gates: bool = False,
    evidence_heavy: bool = False,
) -> ExecutionTier:
    """Compatibility projection; policy facts always outrank lightweight hints."""

    assessment = build_mode_assessment(
        request,
        invocation_id="compatibility",
        explicit=explicit,
        dependency_waves=dependency_waves,
        durable_audit=durable_audit,
        human_gates=human_gates,
        evidence_heavy=evidence_heavy,
    )
    if assessment.policy_floor == "managed":
        return "managed"
    if explicit == "managed":
        return "managed"
    return "lightweight"


__all__ = ["ExecutionTier", "ModeAssessment", "build_mode_assessment", "qualify_execution_tier"]
