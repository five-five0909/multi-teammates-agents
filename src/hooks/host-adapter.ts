import { z } from "zod";

import { hookEventSchema, type HookDecision, type HookEnvelope } from "./dispatcher.js";
import type { ApplyHost } from "../control/apply-contract.js";
import type { ToolIntent } from "../lifecycle/risk-gate.js";

const nativeHookSchema = z.object({
  session_id: z.string().min(1),
  cwd: z.string().min(1),
  hook_event_name: hookEventSchema,
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
}).loose();

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pathsFrom(input: Record<string, unknown>): string[] {
  const values = [input.file_path, input.path, input.destination, input.source];
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function shellIntent(input: Record<string, unknown>): ToolIntent {
  const command = typeof input.command === "string" ? input.command : "";
  const destructive = /(?:^|[;&|]\s*)(?:rm\s+-[^\n]*r|Remove-Item\b[^\n]*-Recurse|git\s+(?:reset\s+--hard|clean\s+-)|format\b|del\s+\/s\b)/iu.test(command);
  const permission = /(?:^|\s)(?:sudo|runas|chmod\s+777|Set-ExecutionPolicy)\b/iu.test(command);
  const readOnly = /^\s*(?:git\s+(?:status|diff|log|show)|(?:rg|grep|find|ls|dir|Get-ChildItem|Get-Content)\b)/iu.test(command);
  return {
    operation: destructive ? "delete" : permission ? "permission" : readOnly ? "status" : "execute",
    paths: [], multi_file: false, cross_layer: !readOnly, concurrent_write: false,
    production: /\b(?:prod|production|kubectl|terraform\s+apply)\b/iu.test(command),
    destructive, permission_escalation: permission,
  };
}

export function inferToolIntent(toolName: string, rawInput: unknown): ToolIntent {
  const input = record(rawInput);
  const paths = pathsFrom(input);
  if (/^(?:Read|Glob|Grep|WebFetch|WebSearch)$/u.test(toolName)) {
    return { operation: toolName === "Grep" || toolName === "Glob" || toolName === "WebSearch" ? "search" : "read", paths, multi_file:false, cross_layer:false, concurrent_write:false, production:false, destructive:false, permission_escalation:false };
  }
  if (/^(?:Bash|PowerShell)$/u.test(toolName)) return shellIntent(input);
  if (/^(?:apply_patch|Edit|Write|NotebookEdit)$/u.test(toolName)) {
    return { operation:"write", paths, multi_file:toolName === "apply_patch", cross_layer:false, concurrent_write:false, production:false, destructive:false, permission_escalation:false };
  }
  const lowered = toolName.toLowerCase();
  const operation: ToolIntent["operation"] = /delete|remove/u.test(lowered) ? "delete"
    : /move|rename/u.test(lowered) ? "move"
      : /permission|approve/u.test(lowered) ? "permission"
        : /cancel/u.test(lowered) ? "cancel"
          : /complete|finish/u.test(lowered) ? "complete"
            : /read|get|list|show/u.test(lowered) ? "read"
              : /search|find|grep|glob/u.test(lowered) ? "search" : "execute";
  return { operation, paths, multi_file:false, cross_layer:operation === "execute", concurrent_write:false, production:false, destructive:operation === "delete" || operation === "move", permission_escalation:operation === "permission" };
}

export function normalizeNativeHook(host: ApplyHost, input: unknown, projectRoot: string): HookEnvelope {
  const parsed = nativeHookSchema.parse(input);
  const payload = parsed.hook_event_name === "PreToolUse"
    ? inferToolIntent(parsed.tool_name ?? "unknown", parsed.tool_input)
    : {};
  return {
    schema_version: 1,
    event: parsed.hook_event_name,
    host,
    session_id: parsed.session_id,
    project_root: projectRoot,
    trusted: true,
    payload,
  };
}

export function renderHostDecision(host: ApplyHost, decision: HookDecision): Record<string, unknown> | null {
  if (decision.action === "inject" && decision.context !== undefined) {
    return { hookSpecificOutput: { hookEventName: decision.event, additionalContext: decision.context } };
  }
  if (decision.event === "PreToolUse" && (decision.action === "deny" || decision.action === "ask")) {
    return { hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: host === "claude" && decision.action === "ask" ? "ask" : "deny",
      permissionDecisionReason: decision.reason,
    } };
  }
  return null;
}
