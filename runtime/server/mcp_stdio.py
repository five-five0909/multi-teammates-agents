"""Dependency-free MCP stdio server for Expert Team run control."""

from __future__ import annotations

import json
import asyncio
import os
from pathlib import Path
import sys
from typing import Any, Callable

from ..core.contracts import ContractError
from ..service import ExpertTeamService
from ..config import load_runtime_config
from ..console import build_run_summary, render_narrative
from ..supervisor import ManagedRunSupervisor


TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "expert_team_start": {"type": "object", "additionalProperties": False, "required": ["task_id", "run_id", "contract", "work_items", "qualification_receipt"], "properties": {"task_id": {"type": "string"}, "run_id": {"type": "string"}, "contract": {"type": "object"}, "work_items": {"type": "array"}, "qualification_receipt": {"type": "object"}, "max_rounds": {"type": "integer", "minimum": 1}, "retry_limit": {"type": "integer", "minimum": 1}}},
    "expert_team_status": {"type": "object", "additionalProperties": False, "required": ["task_id", "run_id"], "properties": {"task_id": {"type": "string"}, "run_id": {"type": "string"}}},
    "expert_team_version": {"type": "object", "additionalProperties": False, "properties": {"host_package_version": {"type": "string"}, "host_entry_contract_version": {"type": "integer"}, "host_hook_schema_version": {"type": "integer"}, "host_toolset_fingerprint": {"type": "string"}}},
    "expert_team_compliance": {"type": "object", "additionalProperties": False, "required": ["task_id", "run_id", "invocation_id"], "properties": {"task_id": {"type": "string"}, "run_id": {"type": "string"}, "invocation_id": {"type": "string"}, "checks": {"type": "array", "items": {"type": "string"}}}},
    "expert_team_next": {"type": "object", "additionalProperties": False, "required": ["task_id", "run_id", "action", "payload"], "properties": {"task_id": {"type": "string"}, "run_id": {"type": "string"}, "action": {"enum": ["manage", "start_execution", "start_audit", "request_gate", "block"]}, "payload": {"type": "object"}}},
    "expert_team_submit_result": {"type": "object", "additionalProperties": False, "required": ["task_id", "run_id", "result"], "properties": {"task_id": {"type": "string"}, "run_id": {"type": "string"}, "result": {"type": "object"}}},
    "expert_team_submit_audit": {"type": "object", "additionalProperties": False, "required": ["task_id", "run_id", "audit"], "properties": {"task_id": {"type": "string"}, "run_id": {"type": "string"}, "audit": {"type": "object"}}},
    "expert_team_answer": {"type": "object", "additionalProperties": False, "required": ["task_id", "run_id", "decision"], "properties": {"task_id": {"type": "string"}, "run_id": {"type": "string"}, "decision": {"type": "object"}}},
    "expert_team_resume": {"type": "object", "additionalProperties": False, "required": ["task_id", "run_id"], "properties": {"task_id": {"type": "string"}, "run_id": {"type": "string"}}},
    "expert_team_cancel": {"type": "object", "additionalProperties": False, "required": ["task_id", "run_id"], "properties": {"task_id": {"type": "string"}, "run_id": {"type": "string"}}},
    "expert_team_record_host_event": {"type": "object", "additionalProperties": False, "required": ["task_id", "run_id", "host", "role", "event"], "properties": {"task_id": {"type": "string"}, "run_id": {"type": "string"}, "host": {"enum": ["codex", "claude"]}, "role": {"enum": ["manager", "executor", "auditor"]}, "event": {"type": "object"}}},
    "expert_team_prepare": {"type": "object", "additionalProperties": False, "required": ["request"], "properties": {"request": {"type": "string"}, "explicit": {"enum": ["lightweight", "managed"]}, "dependency_waves": {"type": "integer", "minimum": 1}, "durable_audit": {"type": "boolean"}, "human_gates": {"type": "boolean"}, "evidence_heavy": {"type": "boolean"}, "task_id": {"type": "string"}, "host_mode": {"enum": ["inline", "subagent", "unknown"]}, "intent": {"enum": ["analysis", "implementation", "audit"]}, "invocation_id": {"type": "string"}, "session_id": {"type": "string"}, "source_event_id": {"type": "string"}, "selection_surface": {"type": "string"}, "hook_trusted": {"type": "boolean"}, "assurance_capabilities": {"type": "array", "items": {"type": "string"}}, "requires_independent_audit": {"type": "boolean"}, "workspace_root": {"type": "string"}, "host_toolset_fingerprint": {"type": "string"}, "host_package_version": {"type": "string"}, "host_entry_contract_version": {"type": "integer"}, "host_hook_schema_version": {"type": "integer"}}},
    "expert_team_select_mode": {"type": "object", "additionalProperties": False, "required": ["invocation_id", "selected_tier", "source", "actor", "verification"], "properties": {"invocation_id": {"type": "string"}, "selected_tier": {"enum": ["managed", "lightweight", "cancel"]}, "source": {"enum": ["policy", "mcp_elicitation", "host_single_select", "user_prompt", "legacy_unverified"]}, "actor": {"enum": ["user", "policy", "host", "legacy"]}, "verification": {"enum": ["verified", "host_reported", "unverified"]}, "source_event_id": {"type": "string"}, "timestamp": {"type": "string"}, "assessment_fingerprint": {"type": "string"}}},
    "expert_team_qualify": {"type": "object", "additionalProperties": False, "required": ["request", "invocation_id", "contract", "work_items"], "properties": {"request": {"type": "string"}, "invocation_id": {"type": "string"}, "auto_start": {"type": "boolean"}, "task_id": {"type": "string"}, "run_id": {"type": "string"}, "contract": {"type": "object"}, "work_items": {"type": "array"}, "max_rounds": {"type": "integer", "minimum": 1}, "retry_limit": {"type": "integer", "minimum": 1}}},
    "expert_team_run": {"type": "object", "additionalProperties": False, "required": ["task_id", "run_id"], "properties": {"task_id": {"type": "string"}, "run_id": {"type": "string"}, "config": {"type": "object"}}},
}


DESCRIPTIONS = {
    "expert_team_start": "Start a durable Trellis-backed Expert Team run.",
    "expert_team_status": "Read the validated current snapshot of a managed run.",
    "expert_team_version": "Compare host/plugin versions and return actionable upgrade commands before entry qualification.",
    "expert_team_compliance": "Build the read-only entry/qualification/graph/verification compliance projection.",
    "expert_team_next": "Advance one legal Manager/wave/gate transition.",
    "expert_team_submit_result": "Submit an unverified Executor result for independent audit.",
    "expert_team_submit_audit": "Record an independent audit decision; only accepted audits verify progress.",
    "expert_team_answer": "Record an attributable human gate decision or instruction.",
    "expert_team_resume": "Return compact verified resume context without raw trajectories.",
    "expert_team_cancel": "Safely cancel a managed run without deleting evidence.",
    "expert_team_record_host_event": "Normalize a Codex or Claude host event and append it to the separate diagnostic trace.",
    "expert_team_prepare": "Run the mandatory read-only Expert Team entry handshake before task changes or managed execution.",
    "expert_team_select_mode": "Persist one attributable single-select mode decision for a prepared invocation.",
    "expert_team_qualify": "Validate the strict task graph and issue a qualification receipt; optionally create a managed run atomically.",
    "expert_team_run": "Run the automatic Manager/Executor/Auditor supervisor until a terminal state or human gate.",
}


class MCPServer:
    def __init__(self, service: ExpertTeamService) -> None:
        self.service = service
        self.handlers: dict[str, Callable[..., dict[str, Any]]] = {
            "expert_team_start": self._start,
            "expert_team_status": service.status,
            "expert_team_version": service.version,
            "expert_team_compliance": lambda task_id, run_id, invocation_id, checks=None: service.compliance(task_id, run_id, invocation_id, checks),
            "expert_team_next": service.next,
            "expert_team_submit_result": lambda task_id, run_id, result: service.submit_result(task_id, run_id, result),
            "expert_team_submit_audit": lambda task_id, run_id, audit: service.submit_audit(task_id, run_id, audit),
            "expert_team_answer": lambda task_id, run_id, decision: service.answer(task_id, run_id, decision),
            "expert_team_resume": service.resume,
            "expert_team_cancel": service.cancel,
            "expert_team_record_host_event": lambda task_id, run_id, host, role, event: service.record_host_event(task_id, run_id, host, role, event),
            "expert_team_prepare": service.prepare,
            "expert_team_select_mode": service.select_mode,
            "expert_team_qualify": self._qualify,
            "expert_team_run": self._run,
        }

    def _start(
        self,
        task_id: str,
        run_id: str,
        contract: Any,
        work_items: Any,
        qualification_receipt: Any,
        max_rounds: int = 20,
        retry_limit: int = 2,
    ) -> dict[str, Any]:
        if not isinstance(qualification_receipt, dict):
            raise ContractError("qualification_receipt must be an object")
        return self.service.start(
            task_id,
            run_id,
            contract,
            work_items,
            max_rounds=max_rounds,
            retry_limit=retry_limit,
            receipt=qualification_receipt,
            require_receipt=True,
        )

    def _qualify(
        self,
        request: str,
        invocation_id: str,
        contract: Any,
        work_items: Any,
        auto_start: bool = False,
        task_id: str | None = None,
        run_id: str | None = None,
        max_rounds: int = 20,
        retry_limit: int = 2,
    ) -> dict[str, Any]:
        return self.service.qualify(
            request,
            invocation_id=invocation_id,
            contract=contract,
            work_items=work_items,
            auto_start=auto_start,
            task_id=task_id,
            run_id=run_id,
            max_rounds=max_rounds,
            retry_limit=retry_limit,
        )

    def _run(self, task_id: str, run_id: str, config: Any = None) -> dict[str, Any]:
        if config is not None and not isinstance(config, dict):
            raise ContractError("config must be an object")
        self.service.require_qualified_run(task_id, run_id)
        runtime_config = load_runtime_config(self.service.repo_root, config or {})
        outcome = asyncio.run(ManagedRunSupervisor(self.service, runtime_config).run(task_id, run_id))
        summary = build_run_summary(self.service, task_id, run_id, outcome.snapshot)
        return {
            "snapshot": outcome.snapshot.to_dict(),
            "episode_ids": list(outcome.episodes),
            "console": summary,
            "narrative": render_narrative(summary),
        }

    def dispatch(self, request: Any) -> dict[str, Any] | None:
        if not isinstance(request, dict):
            return self._error(None, -32600, "Invalid Request")
        request_id = request.get("id")
        method = request.get("method")
        if method == "notifications/initialized":
            return None
        if method == "initialize":
            return self._result(request_id, {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "expert-team", "version": ExpertTeamService.PACKAGE_VERSION}})
        if method == "ping":
            return self._result(request_id, {})
        if method == "tools/list":
            tools = [{"name": name, "description": DESCRIPTIONS[name], "inputSchema": schema} for name, schema in TOOL_SCHEMAS.items()]
            return self._result(request_id, {"tools": tools})
        if method == "tools/call":
            params = request.get("params")
            if not isinstance(params, dict) or not isinstance(params.get("name"), str) or not isinstance(params.get("arguments", {}), dict):
                return self._error(request_id, -32602, "Invalid tools/call parameters")
            name = params["name"]
            handler = self.handlers.get(name)
            if handler is None:
                return self._error(request_id, -32601, f"Unknown tool: {name}")
            try:
                result = handler(**params.get("arguments", {}))
            except (ContractError, OSError, TypeError, ValueError) as error:
                return self._result(request_id, {"content": [{"type": "text", "text": str(error)}], "isError": True})
            text = result.get("narrative") if name == "expert_team_run" and isinstance(result, dict) else None
            if not isinstance(text, str):
                text = json.dumps(result, ensure_ascii=False)
            return self._result(request_id, {"content": [{"type": "text", "text": text}], "structuredContent": result, "isError": False})
        return self._error(request_id, -32601, f"Method not found: {method}")

    @staticmethod
    def _result(request_id: Any, result: Any) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    @staticmethod
    def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def serve(repo_root: Path | None = None) -> int:
    package_root = Path(__file__).resolve().parents[2]
    explicit_workspace = (
        os.environ.get("EXPERT_TEAM_WORKSPACE")
        or os.environ.get("CODEX_PROJECT_DIR")
        or os.environ.get("CLAUDE_PROJECT_DIR")
    )
    configured_workspace = explicit_workspace or os.environ.get("PWD")
    workspace_root = Path(configured_workspace).resolve() if configured_workspace else (repo_root or package_root).resolve()
    trusted_workspace = bool(explicit_workspace or (configured_workspace and workspace_root != package_root))
    server = MCPServer(
        ExpertTeamService(
            package_root,
            package_root=package_root,
            workspace_root=workspace_root,
            workspace_trusted=bool(trusted_workspace or repo_root),
        )
    )
    for line in sys.stdin:
        response: dict[str, Any] | None
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            response = server._error(None, -32700, "Parse error")
        else:
            response = server.dispatch(request)
        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
            sys.stdout.flush()
    return 0
