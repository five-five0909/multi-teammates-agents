"""Application service used by the portable Expert Team MCP surface."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Any, Mapping, cast
from uuid import uuid4

from .adapters.trellis import TrellisRunStore
from .adapters.claude import normalize_claude_event
from .adapters.codex import normalize_codex_event
from .core.contracts import AuditDecision, BackendEvent, ContractError, DecisionProvenance, HumanDecision, RoleResult, RunEvent, TaskContract, WorkItem
from .core.scheduling import validate_work_graph
from .entry_gate import EntryGateStore, ModeDecision, QualificationReceipt, fingerprint, graph_waves, new_invocation_id, now_iso, workspace_fingerprint
from .routing import build_mode_assessment
from .security import redact_value


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ExpertTeamService:
    ENTRY_CONTRACT_VERSION = 2
    PACKAGE_VERSION = "0.4.0"

    def __init__(
        self,
        repo_root: Path,
        *,
        developer: str = "expert-team",
        package_root: Path | None = None,
        workspace_root: Path | None = None,
        session_id: str | None = None,
        workspace_trusted: bool = True,
    ) -> None:
        configured_workspace = os.environ.get("EXPERT_TEAM_WORKSPACE")
        self.package_root = (package_root or repo_root).resolve()
        selected_workspace = workspace_root
        if selected_workspace is None and configured_workspace:
            selected_workspace = Path(configured_workspace)
        self.repo_root = (selected_workspace or repo_root).resolve()
        self.developer = developer
        self.session_id: str = session_id or os.environ.get("EXPERT_TEAM_SESSION_ID") or "default"
        self.workspace_trusted = workspace_trusted
        self.gates = EntryGateStore(self.repo_root, session_id=self.session_id)

    def _task_dir(self, task_id: str, *, require_active: bool = False) -> Path:
        tasks_root = self.repo_root / ".trellis" / "tasks"
        if not tasks_root.is_dir():
            raise ContractError("managed mode requires .trellis/tasks")
        matches: list[tuple[Path, dict[str, Any]]] = []
        for task_file in tasks_root.glob("*/task.json"):
            try:
                value = json.loads(task_file.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if task_file.parent.name == task_id or value.get("id") == task_id or value.get("name") == task_id:
                if isinstance(value, dict):
                    matches.append((task_file.parent, value))
        if len(matches) != 1:
            raise ContractError(f"expected one Trellis task for {task_id}, found {len(matches)}")
        task_dir, metadata = matches[0]
        if require_active and metadata.get("status") != "in_progress":
            raise ContractError(f"managed mode requires an in_progress Trellis task; {task_id} is {metadata.get('status', 'unknown')}")
        return task_dir

    def _task_metadata(self, task_id: str) -> tuple[Path, dict[str, Any]]:
        task_dir = self._task_dir(task_id)
        path = task_dir / "task.json"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ContractError(f"invalid Trellis task metadata for {task_id}") from error
        if not isinstance(value, dict):
            raise ContractError(f"Trellis task metadata for {task_id} must be an object")
        return task_dir, value

    def _store(self, task_id: str) -> TrellisRunStore:
        return TrellisRunStore(self.repo_root, self._task_dir(task_id), self.developer)

    def prepare(
        self,
        request: str,
        *,
        explicit: str | None = None,
        dependency_waves: int = 1,
        durable_audit: bool = False,
        human_gates: bool = False,
        evidence_heavy: bool = False,
        task_id: str | None = None,
        host_mode: str = "unknown",
        intent: str = "implementation",
        invocation_id: str | None = None,
        source_event_id: str | None = None,
        session_id: str | None = None,
        selection_surface: str | None = None,
        hook_trusted: bool | None = None,
        assurance_capabilities: list[str] | None = None,
        requires_independent_audit: bool = False,
        workspace_root: str | None = None,
        host_toolset_fingerprint: str | None = None,
        host_package_version: str | None = None,
        host_entry_contract_version: int | None = None,
        host_hook_schema_version: int | None = None,
    ) -> dict[str, Any]:
        """Create or return the read-only, attributable entry assessment."""

        if workspace_root is not None and Path(workspace_root).resolve() != self.repo_root:
            raise ContractError("workspace_unbound: request workspace differs from the trusted host workspace")
        if not self.workspace_trusted:
            raise ContractError("workspace_unbound: MCP package root is not a trusted user workspace; provide host session workspace")
        expected_toolset = fingerprint({"prepare": 2, "select_mode": 1, "qualify": 2, "compliance": 1})
        if host_package_version is not None and host_package_version != self.PACKAGE_VERSION:
            raise ContractError("stale_session: host package version does not match the MCP server")
        if host_entry_contract_version is not None and host_entry_contract_version != self.ENTRY_CONTRACT_VERSION:
            raise ContractError("stale_session: entry-gate contract version does not match the MCP server")
        if host_hook_schema_version is not None and host_hook_schema_version != 1:
            raise ContractError("stale_session: hook schema version does not match the MCP server")
        if host_toolset_fingerprint is not None and host_toolset_fingerprint != expected_toolset:
            raise ContractError("stale_session: MCP toolset fingerprint does not match the server")
        if session_id is not None and session_id != self.session_id:
            raise ContractError("session_id does not match the current host session")
        if hook_trusted is None:
            hook_trusted = os.environ.get("EXPERT_TEAM_HOOK_TRUSTED") == "1"
        if selection_surface is None:
            selection_surface = "plain_reply" if host_mode == "inline" else "native_single_select" if host_mode == "subagent" else "none"
        capabilities = tuple(assurance_capabilities or ())
        task_status: str | None = None
        task_error: str | None = None
        if task_id is not None:
            if not isinstance(task_id, str) or not task_id.strip():
                raise ContractError("task_id must not be empty when provided")
            try:
                _, metadata = self._task_metadata(task_id)
                value = metadata.get("status")
                task_status = value if isinstance(value, str) else "unknown"
            except (ContractError, OSError, ValueError, json.JSONDecodeError) as error:
                task_error = str(error)

        invocation = invocation_id or new_invocation_id()
        assessment = build_mode_assessment(
            request,
            invocation_id=invocation,
            explicit=explicit,  # type: ignore[arg-type]
            dependency_waves=dependency_waves,
            durable_audit=durable_audit,
            human_gates=human_gates,
            evidence_heavy=evidence_heavy,
            task_id=task_id,
            task_status=task_status,
            host_mode=host_mode,
            intent=intent,  # type: ignore[arg-type]
            selection_surface=selection_surface,
            hook_trusted=hook_trusted,
            assurance_capabilities=capabilities,
            requires_independent_audit=requires_independent_audit,
        )
        assessment_value = assessment.to_dict()
        assessment_value["assessment_fingerprint"] = fingerprint(
            {
                "request": request,
                "explicit": explicit,
                "dependency_waves": dependency_waves,
                "durable_audit": durable_audit,
                "human_gates": human_gates,
                "evidence_heavy": evidence_heavy,
                "task_id": task_id,
                "task_status": task_status,
                "host_mode": host_mode,
                "intent": intent,
                "selection_surface": selection_surface,
                "requires_independent_audit": requires_independent_audit,
            }
        )
        assessment_value["tooling"] = {
            "package_version": self.PACKAGE_VERSION,
            "entry_contract_version": self.ENTRY_CONTRACT_VERSION,
            "hook_schema_version": 1,
            "toolset_fingerprint": expected_toolset,
        }
        record = self.gates.create(assessment_value, source_event_id=source_event_id)
        if assessment.policy_floor == "managed" and self.gates.latest_decision(record) is None:
            record = self.gates.add_decision(
                invocation,
                {
                    "schema_version": 1,
                    "invocation_id": invocation,
                    "selected_tier": "managed",
                    "provenance": {
                        "schema_version": 1,
                        "gate_type": "mode_selection",
                        "actor": "policy",
                        "source": "policy",
                        "verification": "verified",
                        "timestamp": now_iso(),
                        "invocation_id": invocation,
                    },
                    "assessment_fingerprint": assessment_value.get("assessment_fingerprint"),
                },
            )
        trellis_present = (self.repo_root / ".trellis" / "tasks").is_dir()
        active_task = task_status == "in_progress"
        requires_task_consent = intent == "implementation" and not active_task
        blockers: list[str] = []
        if task_error:
            blockers.append(task_error)
        if assessment.policy_floor == "managed" and not trellis_present:
            blockers.append("managed mode requires .trellis/tasks")
        if assessment.policy_floor == "managed" and task_id is not None and not active_task:
            blockers.append("managed mode requires an active in_progress Trellis task")
        if requires_independent_audit and "independent_audit" not in assessment.host.get("assurance_capabilities", []):
            blockers.append("capability_blocked: independent audit is unavailable in this host mode")
        result = assessment.to_dict()
        locked = assessment.policy_floor == "managed"
        mode_options = [
            {
                "id": "managed",
                "label": "Managed Expert Team（推荐）",
                "description": "持久化 Trellis 状态、任务图、恢复和独立检查；成本更高但可追溯。",
                "enabled": True,
                "recommended": True,
            },
            {
                "id": "lightweight",
                "label": "Lightweight Expert Team",
                "description": "当前会话内完成，不创建持久化运行；只在没有硬性治理条件时可选。",
                "enabled": not locked,
                "recommended": False,
            },
        ]
        selected_decision = self.gates.latest_decision(record)
        selected_tier = selected_decision.get("selected_tier") if isinstance(selected_decision, Mapping) else None
        result.update(
            {
                "prepared": True,
                "assessment": assessment.to_dict(),
                "selected_tier": selected_tier if selected_tier in {"managed", "lightweight"} else None,
                "selection_required": assessment.decision_state == "selection_required",
                "needs_input": assessment.decision_state == "selection_required" and assessment.host.get("selection_surface") != "native_single_select",
                "mode_options": mode_options,
                "assessment_fingerprint": assessment_value["assessment_fingerprint"],
                "tooling": dict(assessment_value["tooling"]),
                "execution_tier": "managed" if assessment.decision_state == "policy_locked" else None,
                "execution_mode": assessment.host.get("execution_mode"),
                "fallback_reason": assessment.host.get("fallback_reason"),
                "requires_task_consent": requires_task_consent,
                "managed_runtime_eligible": assessment.policy_floor == "managed" and active_task,
                "trellis": {"present": trellis_present, "task_id": task_id, "task_status": task_status},
                "blockers": blockers,
                "obligations": [
                    "record the prepare result and execution mode",
                    "record a dependency-aware task graph before implementation",
                    "normalize every task result with the Expert Result Contract",
                    "run verification and report incomplete work explicitly",
                ],
                "entry_gate": {
                    "session_id": self.session_id,
                    "source_event_id": record.get("source_event_id"),
                    "state": record.get("state", "prepared"),
                    "version": record.get("version", 1),
                    "workspace_fingerprint": workspace_fingerprint(self.repo_root),
                },
            }
        )
        return result

    def select_mode(
        self,
        invocation_id: str,
        selected_tier: str,
        *,
        actor: str = "user",
        source: str = "host_single_select",
        verification: str = "verified",
        source_event_id: str | None = None,
        timestamp: str | None = None,
        assessment_fingerprint: str | None = None,
    ) -> dict[str, Any]:
        """Persist one attributable mode choice; never infer a user choice."""

        record = self.gates.load(invocation_id)
        assessment = record.get("assessment")
        if not isinstance(assessment, Mapping):
            raise ContractError("entry gate assessment is malformed")
        expected_fingerprint = assessment.get("assessment_fingerprint", assessment.get("request_fingerprint"))
        if assessment_fingerprint is not None and assessment_fingerprint != expected_fingerprint:
            raise ContractError("mode decision references a stale assessment")
        if selected_tier not in {"managed", "lightweight", "cancel"}:
            raise ContractError("selected_tier must be managed, lightweight, or cancel")
        allowed = assessment.get("allowed_tiers")
        if not isinstance(allowed, list):
            raise ContractError("entry gate allowed_tiers is malformed")
        if selected_tier != "cancel" and selected_tier not in allowed:
            raise ContractError("mode_conflict: selected tier is below the policy floor")
        if source not in {"policy", "mcp_elicitation", "host_single_select", "user_prompt", "legacy_unverified"}:
            raise ContractError("unsupported mode decision source")
        if actor not in {"user", "policy", "host", "legacy"}:
            raise ContractError("unsupported mode decision actor")
        if verification not in {"verified", "host_reported", "unverified"}:
            raise ContractError("unsupported mode decision verification")
        if actor == "user" and not source_event_id:
            raise ContractError("user mode selection requires source_event_id")
        if actor == "user" and verification == "verified":
            gate_event_id = record.get("source_event_id")
            if not source_event_id:
                raise ContractError("verified user mode selection requires source_event_id")
            if not isinstance(gate_event_id, str) or gate_event_id != source_event_id:
                raise ContractError("verified user mode selection requires a source_event_id bound by prepare")
        if source == "legacy_unverified" and selected_tier == "lightweight":
            raise ContractError("legacy lightweight preference cannot select lightweight")
        provenance = DecisionProvenance.from_dict(
            {
                "schema_version": 1,
                "gate_type": "mode_selection",
                "actor": actor,
                "source": source,
                "verification": verification,
                "timestamp": timestamp or now_iso(),
                "source_event_id": source_event_id,
                "invocation_id": invocation_id,
            }
        )
        decision_value = {
            "schema_version": 1,
            "invocation_id": invocation_id,
            "selected_tier": selected_tier,
            "provenance": provenance.to_dict(),
            "assessment_fingerprint": expected_fingerprint,
        }
        if selected_tier == "cancel":
            ModeDecision.from_dict(decision_value)
            record["state"] = "cancelled"
            record["decisions"] = [
                *([dict(item) for item in record.get("decisions", []) if isinstance(item, Mapping)]),
                decision_value,
            ]
            updated = self.gates.save(record)
        else:
            updated = self.gates.add_decision(
                invocation_id,
                {
                    **decision_value,
                },
            )
        decision = self.gates.latest_decision(updated)
        return {
            "schema_version": 1,
            "invocation_id": invocation_id,
            "selected_tier": selected_tier,
            "decision": dict(decision) if isinstance(decision, Mapping) else None,
            "state": updated.get("state"),
            "next_action": "cancelled" if selected_tier == "cancel" else assessment.get("next_action", "build_graph"),
            "entry_gate": {"version": updated.get("version"), "workspace_fingerprint": workspace_fingerprint(self.repo_root)},
        }

    def qualify(
        self,
        request: str,
        *,
        invocation_id: str,
        contract: Any,
        work_items: Any,
        task_id: str | None = None,
        run_id: str | None = None,
        auto_start: bool = False,
        max_rounds: int = 20,
        retry_limit: int = 2,
    ) -> dict[str, Any]:
        """Re-evaluate a strict graph and issue the only valid start receipt."""

        record = self.gates.load(invocation_id)
        assessment = record.get("assessment")
        if not isinstance(assessment, Mapping):
            raise ContractError("entry gate assessment is malformed")
        reasons = assessment.get("reasons")
        if isinstance(reasons, list) and any(isinstance(reason, Mapping) and reason.get("code") == "capability_blocked" for reason in reasons):
            raise ContractError("capability_blocked: qualification requires an unavailable independent audit capability")
        trellis = assessment.get("trellis")
        if not isinstance(trellis, Mapping):
            raise ContractError("entry gate Trellis context is malformed")
        expected_task = trellis.get("task_id")
        if task_id is None and isinstance(expected_task, str):
            task_id = expected_task
        if task_id is not None and expected_task is not None and task_id != expected_task:
            raise ContractError("task_drift: qualification task differs from prepared task")
        if not isinstance(contract, Mapping):
            raise ContractError("qualification requires a strict TaskContract object")
        if not isinstance(work_items, list):
            raise ContractError("qualification requires a strict WorkItem array")
        parsed_contract = TaskContract.from_dict(redact_value(contract))
        parsed_items = [WorkItem.from_dict(redact_value(value)) for value in work_items]
        by_id = validate_work_graph(parsed_items)
        waves = graph_waves(parsed_items)
        if not request.strip():
            raise ContractError("qualification request must not be empty")
        request_fp = fingerprint(
            {
                "request": request,
                "intent": assessment.get("intent"),
                "task_id": task_id,
                "task_status": trellis.get("task_status"),
            }
        )
        if request_fp != assessment.get("request_fingerprint"):
            raise ContractError("request does not match the prepared invocation")
        decision = self.gates.latest_decision(record)
        if decision is None:
            raise ContractError("mode_selection_required: select a mode before qualification")
        if decision.get("selected_tier") == "cancel":
            raise ContractError("entry gate is cancelled; start a new invocation")
        selected_tier = decision.get("selected_tier")
        if selected_tier not in {"managed", "lightweight"}:
            raise ContractError("entry gate mode decision is malformed")
        policy_floor = assessment.get("policy_floor")
        if policy_floor == "managed" and selected_tier != "managed":
            raise ContractError("mode_conflict: policy floor requires managed execution")
        if waves > 1 and selected_tier == "lightweight":
            raise ContractError("mode_conflict: dependency graph requires managed execution")

        task_status: str | None = None
        task_metadata_fingerprint: str | None = None
        if task_id is not None:
            _, metadata = self._task_metadata(task_id)
            value = metadata.get("status")
            task_status = value if isinstance(value, str) else "unknown"
            task_metadata_fingerprint = fingerprint(metadata)
        if selected_tier == "managed" and task_status != "in_progress":
            if task_status == "planning":
                raise ContractError("planning_review_required: run task.py start after review")
            raise ContractError("managed qualification requires an in_progress Trellis task")
        if auto_start and selected_tier != "managed":
            raise ContractError("auto_start requires managed execution")
        if auto_start and (not task_id or not run_id):
            raise ContractError("auto_start requires task_id and run_id")
        execution_mode = str((assessment.get("host") or {}).get("execution_mode", "unresolved"))
        graph_fp = fingerprint({"contract": parsed_contract.to_dict(), "work_items": [item.to_dict() for item in parsed_items]})
        receipt = {
            "schema_version": 1,
            "qualification_id": str(uuid4()),
            "invocation_id": invocation_id,
            "effective_tier": selected_tier,
            "execution_mode": execution_mode,
            "task_id": task_id,
            "task_status": task_status,
            "task_metadata_fingerprint": task_metadata_fingerprint,
            "contract_fingerprint": fingerprint(parsed_contract.to_dict()),
            "graph_fingerprint": graph_fp,
            "graph_waves": waves,
            "work_item_ids": sorted(by_id),
            "assessment_fingerprint": assessment.get("assessment_fingerprint", assessment.get("request_fingerprint")),
            "workspace_fingerprint": workspace_fingerprint(self.repo_root),
            "issued_at": now_iso(),
            "package_version": self.PACKAGE_VERSION,
        }
        if run_id is not None:
            receipt["run_id"] = run_id
        existing_receipt = record.get("qualification")
        if isinstance(existing_receipt, Mapping):
            if any(existing_receipt.get(key) != receipt.get(key) for key in ("effective_tier", "task_id", "contract_fingerprint", "graph_fingerprint", "workspace_fingerprint")):
                raise ContractError("invocation is already qualified with a different graph")
            receipt = dict(existing_receipt)
        else:
            self.gates.set_qualification(invocation_id, receipt)
        result: dict[str, Any] = {
            "schema_version": 1,
            "qualified": True,
            "execution_tier": selected_tier,
            "execution_mode": execution_mode,
            "creates_managed_run": False,
            "receipt": receipt,
            "graph": {"work_item_ids": sorted(by_id), "waves": waves, "fingerprint": graph_fp},
        }
        if auto_start:
            snapshot = self.start(task_id or "", run_id or "", contract, work_items, max_rounds=max_rounds, retry_limit=retry_limit, receipt=receipt, require_receipt=True)
            result["creates_managed_run"] = True
            result["run"] = {"task_id": task_id, "run_id": run_id, "state": snapshot["state"], "version": snapshot["version"]}
        return result

    def start(
        self,
        task_id: str,
        run_id: str,
        contract: Any,
        work_items: Any,
        *,
        max_rounds: int = 20,
        retry_limit: int = 2,
        receipt: Mapping[str, Any] | None = None,
        require_receipt: bool = False,
    ) -> dict[str, Any]:
        if not isinstance(work_items, list):
            raise ContractError("work_items must be an array")
        parsed_contract = TaskContract.from_dict(redact_value(contract))
        parsed_items = [WorkItem.from_dict(redact_value(value)) for value in work_items]
        validate_work_graph(parsed_items)
        coordinators = self._coordinator_ids()
        dispatched_coordinators = sorted({item.role for item in parsed_items if item.role in coordinators})
        if dispatched_coordinators:
            raise ContractError(f"coordinator profiles cannot be dispatched as Executors: {', '.join(dispatched_coordinators)}")
        task_dir, metadata = self._task_metadata(task_id)
        if metadata.get("status") != "in_progress":
            raise ContractError(f"managed mode requires an in_progress Trellis task; {task_id} is {metadata.get('status', 'unknown')}")
        contract_fp = fingerprint(parsed_contract.to_dict())
        graph_fp = fingerprint({"contract": parsed_contract.to_dict(), "work_items": [item.to_dict() for item in parsed_items]})
        if require_receipt and receipt is None:
            raise ContractError("qualification receipt is required before managed start")
        if receipt is not None:
            receipt = QualificationReceipt.from_dict(receipt).to_dict()
            invocation_id = receipt.get("invocation_id")
            if not isinstance(invocation_id, str):
                raise ContractError("qualification receipt invocation_id is required")
            gate = self.gates.load(invocation_id)
            stored = gate.get("qualification")
            if not isinstance(stored, Mapping) or dict(stored) != dict(receipt):
                raise ContractError("qualification receipt is not the authoritative gate receipt")
            expected = {
                "effective_tier": "managed",
                "task_id": task_id,
                "task_status": "in_progress",
                "contract_fingerprint": contract_fp,
                "graph_fingerprint": graph_fp,
                "workspace_fingerprint": workspace_fingerprint(self.repo_root),
            }
            for key, value in expected.items():
                if receipt.get(key) != value:
                    raise ContractError(f"qualification receipt mismatch: {key}")
            if receipt.get("run_id") not in {None, run_id}:
                raise ContractError("qualification receipt mismatch: run_id")
            if receipt.get("task_metadata_fingerprint") != fingerprint(metadata):
                raise ContractError("task_drift: Trellis metadata changed after qualification")
        store = TrellisRunStore(self.repo_root, task_dir, self.developer)
        run_dir = store.run_dir(run_id)
        if run_dir.exists():
            existing = store.load(run_id)
            existing_items = [item.to_dict() for item in existing.work_items.values()]
            if existing.contract.to_dict() != parsed_contract.to_dict() or fingerprint({"contract": existing.contract.to_dict(), "work_items": existing_items}) != graph_fp:
                raise ContractError("run_id already exists with a different contract or graph")
            return existing.to_dict()
        snapshot = store.create(run_id, parsed_contract, parsed_items, max_rounds=max_rounds, retry_limit=retry_limit)
        snapshot = store.append(self._event(snapshot, "run.managing", {}), owner="mcp-start")
        if receipt is not None:
            gate = self.gates.load(str(receipt["invocation_id"]))
            gate["state"] = "run_started"
            gate["run_id"] = run_id
            self.gates.save(gate)
        return snapshot.to_dict()

    def require_qualified_run(self, task_id: str, run_id: str) -> None:
        """Guard mutating supervisor entry points against an unqualified run."""

        for path in sorted(self.gates.root.glob("*.json")):
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(record, Mapping) or record.get("state") != "run_started" or record.get("run_id") != run_id:
                continue
            receipt = record.get("qualification")
            if isinstance(receipt, Mapping) and receipt.get("task_id") == task_id and receipt.get("workspace_fingerprint") == workspace_fingerprint(self.repo_root):
                return
        raise ContractError("qualification receipt is required before managed execution")

    def status(self, task_id: str, run_id: str) -> dict[str, Any]:
        return self._store(task_id).load(run_id).to_dict()

    def compliance(self, task_id: str, run_id: str, invocation_id: str, checks: list[str] | None = None) -> dict[str, Any]:
        """Build a read-only success projection from validated gate/run facts."""

        gate = self.gates.load(invocation_id)
        receipt = gate.get("qualification")
        if not isinstance(receipt, Mapping):
            raise ContractError("compliance requires a qualification receipt")
        if receipt.get("task_id") != task_id or receipt.get("workspace_fingerprint") != workspace_fingerprint(self.repo_root):
            raise ContractError("compliance receipt is bound to another task or workspace")
        snapshot = self._store(task_id).load(run_id)
        if receipt.get("effective_tier") == "managed" and receipt.get("execution_mode") == "main-session-sequential":
            enforcement = "partial"
        else:
            assessment = gate.get("assessment")
            host = assessment.get("host") if isinstance(assessment, Mapping) else {}
            enforcement = host.get("enforcement_level", "advisory") if isinstance(host, Mapping) else "advisory"
        required = [item for item in snapshot.work_items.values() if item.required]
        accepted = [item for item in required if item.status == "accepted"]
        incomplete = [item.id for item in required if item.status != "accepted"]
        verification = "passed" if snapshot.state == "completed" and not incomplete else "blocked" if snapshot.state in {"blocked", "cancelled"} else "pending"
        failed_checks = list(checks or [])
        result = "success" if verification == "passed" and not failed_checks else "partial" if snapshot.state not in {"blocked", "cancelled"} else "blocked"
        decision = self.gates.latest_decision(gate)
        assessment = gate.get("assessment")
        return {
            "entry_gate": {
                "prepared": True,
                "decision": decision.get("selected_tier") if isinstance(decision, Mapping) else None,
                "source": (decision.get("provenance") or {}).get("source") if isinstance(decision, Mapping) and isinstance(decision.get("provenance"), Mapping) else "policy",
                "enforcement": enforcement,
            },
            "qualification": {
                "id": receipt.get("qualification_id"),
                "tier": receipt.get("effective_tier"),
                "execution_mode": receipt.get("execution_mode"),
            },
            "trellis": {"task": task_id, "phase": "in_progress"},
            "work_graph": {"required": len(required), "accepted": len(accepted), "waves": receipt.get("graph_waves")},
            "verification": {"status": verification, "checks": failed_checks},
            "incomplete": incomplete,
            "result": result,
            "run": {"run_id": run_id, "state": snapshot.state, "version": snapshot.version},
        }

    def next(self, task_id: str, run_id: str, action: str, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise ContractError("payload must be an object")
        kinds = {
            "manage": "run.managing",
            "start_execution": "wave.execution_started",
            "start_audit": "wave.audit_started",
            "request_gate": "human.gate_requested",
            "block": "run.blocked",
        }
        try:
            kind = kinds[action]
        except KeyError as error:
            raise ContractError(f"unsupported next action: {action}") from error
        store = self._store(task_id)
        current = store.load(run_id)
        transition = self._event(current, kind, payload)
        updated = store.append(transition, owner="mcp-next")
        if action == "start_execution":
            store.record_round(run_id, {"schema_version": 1, "round": updated.rounds_used, "event_id": transition.id, "work_item_ids": list(payload.get("work_item_ids", [])), "state_version": updated.version, "timestamp": transition.timestamp})
        return updated.to_dict()

    def submit_result(self, task_id: str, run_id: str, value: Any) -> dict[str, Any]:
        result = RoleResult.from_dict(redact_value(value))
        store = self._store(task_id)
        current = store.load(run_id)
        updated = store.append(self._event(current, "executor.result_submitted", result.to_dict()), owner="mcp-result")
        store.record_role_result(run_id, result)
        return updated.to_dict()

    def submit_audit(self, task_id: str, run_id: str, value: Any) -> dict[str, Any]:
        decision = AuditDecision.from_dict(redact_value(value))
        store = self._store(task_id)
        current = store.load(run_id)
        updated = store.append(self._event(current, "audit.recorded", decision.to_dict()), owner="mcp-audit")
        store.record_audit(run_id, decision)
        return updated.to_dict()

    def answer(self, task_id: str, run_id: str, value: Any) -> dict[str, Any]:
        decision = HumanDecision.from_dict(redact_value(value))
        if decision.provenance is None:
            if decision.actor != "configured-policy":
                raise ContractError("human gate requires attributable provenance; actor=user alone is not proof")
        else:
            if decision.provenance.gate_type != decision.gate_type:
                raise ContractError("human decision provenance gate_type does not match decision")
            if decision.actor == "user" and decision.provenance.verification != "verified":
                raise ContractError("user human gate requires verified provenance")
            if decision.actor != decision.provenance.actor and not (
                decision.actor == "configured-policy" and decision.provenance.actor == "policy"
            ):
                raise ContractError("human decision actor does not match provenance")
        store = self._store(task_id)
        current = store.load(run_id)
        payload = {
            "decision": decision.decision,
            "gate_type": decision.gate_type,
            "actor": decision.actor,
            "instruction": decision.instruction,
            "provenance": decision.provenance.to_dict() if decision.provenance else {"actor": "policy", "verification": "verified", "source": "policy"},
        }
        updated = store.append(self._event(current, "human.decision_recorded", payload), owner="mcp-answer")
        store.record_human_decision(run_id, decision)
        if updated.state == "completed":
            lines = [f"# Expert Team Run {run_id}", "", f"Goal: {updated.contract.goal}", "", "## Verified progress", ""]
            for item_id, evidence in updated.verified_progress.items():
                lines.append(f"- `{item_id}`: {', '.join(evidence)}")
            lines.extend(["", f"Rounds used: {updated.rounds_used}/{updated.max_rounds}", f"Approved by: {decision.actor}", f"Completed at: {decision.timestamp}"])
            store.write_final_report(run_id, "\n".join(lines))
        return updated.to_dict()

    def resume(self, task_id: str, run_id: str) -> dict[str, Any]:
        snapshot = self._store(task_id).load(run_id)
        return {
            "run_id": snapshot.run_id,
            "state": snapshot.state,
            "version": snapshot.version,
            "goal": snapshot.contract.goal,
            "verified_progress": {key: list(value) for key, value in snapshot.verified_progress.items()},
            "unresolved_work": [item.to_dict() for item in snapshot.work_items.values() if item.status not in {"accepted", "cancelled"}],
            "pending_gate": snapshot.pending_gate,
            "budget": {"rounds_used": snapshot.rounds_used, "max_rounds": snapshot.max_rounds, "retry_limit": snapshot.retry_limit},
        }

    def cancel(self, task_id: str, run_id: str, payload: Mapping[str, Any] | None = None) -> dict[str, Any]:
        store = self._store(task_id)
        current = store.load(run_id)
        return store.append(self._event(current, "run.cancelled", payload or {}), owner="mcp-cancel").to_dict()

    def record_host_event(self, task_id: str, run_id: str, host: str, role: str, value: Any) -> dict[str, Any]:
        if role not in {"manager", "executor", "auditor"}:
            raise ContractError(f"unsupported role: {role}")
        if host == "codex":
            normalized = normalize_codex_event(value, role=role)  # type: ignore[arg-type]
        elif host == "claude":
            normalized = normalize_claude_event(value, role=role)  # type: ignore[arg-type]
        else:
            raise ContractError(f"unsupported host: {host}")
        normalized = BackendEvent.from_dict(redact_value(normalized.to_dict()))
        store = self._store(task_id)
        self.record_backend_event(task_id, run_id, normalized)
        return normalized.to_dict()

    def record_episode_event(
        self,
        task_id: str,
        run_id: str,
        kind: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        allowed = {
            "episode.started", "episode.completed", "episode.failed",
            "episode.timeout", "episode.cancelled", "episode.abandoned",
        }
        if kind not in allowed:
            raise ContractError(f"unsupported episode event: {kind}")
        store = self._store(task_id)
        current = store.load(run_id)
        return store.append(self._event(current, kind, payload), owner="supervisor").to_dict()

    def record_episode_trace(
        self,
        task_id: str,
        run_id: str,
        episode_id: str,
        value: Mapping[str, object],
    ) -> str:
        safe_value = cast(dict[str, object], redact_value(dict(value)))
        path = self._store(task_id).record_episode_trace(run_id, episode_id, safe_value)
        return path.relative_to(self.repo_root).as_posix()

    def record_backend_event(self, task_id: str, run_id: str, event: Any) -> None:
        parsed_value = event.to_dict() if isinstance(event, BackendEvent) else event
        parsed = BackendEvent.from_dict(redact_value(parsed_value))
        self._store(task_id).record_backend_event(run_id, parsed)

    def events(self, task_id: str, run_id: str) -> tuple[RunEvent, ...]:
        return self._store(task_id).read_events(run_id)

    def load_role_result(self, task_id: str, run_id: str, work_item_id: str, attempt: int) -> RoleResult:
        return self._store(task_id).load_role_result(run_id, work_item_id, attempt)

    @staticmethod
    def _coordinator_ids() -> set[str]:
        registry_path = Path(__file__).resolve().parents[1] / "skills" / "expert-team" / "references" / "agent-registry.json"
        try:
            value = json.loads(registry_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ContractError("canonical expert registry is unavailable") from error
        agents = value.get("agents") if isinstance(value, dict) else None
        if not isinstance(agents, list):
            raise ContractError("canonical expert registry is invalid")
        return {agent["id"] for agent in agents if isinstance(agent, dict) and agent.get("kind") == "coordinator" and isinstance(agent.get("id"), str)}

    @staticmethod
    def _event(snapshot: Any, kind: str, payload: Mapping[str, Any]) -> RunEvent:
        safe_payload = redact_value(dict(payload))
        return RunEvent.from_dict({"schema_version": 1, "id": str(uuid4()), "run_id": snapshot.run_id, "seq": snapshot.last_seq + 1, "expected_version": snapshot.version, "kind": kind, "timestamp": _now(), "payload": safe_payload})
