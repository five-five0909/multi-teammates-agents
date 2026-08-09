import { open, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

import { redactValue } from "../runtime/security.js";
import { gateToolUse, type GateDecision } from "../lifecycle/risk-gate.js";
import { LifecycleError, type TaskRepository } from "../lifecycle/task-repository.js";
import { readProjectStatus } from "../control/status.js";

export const hookEventSchema = z.enum([
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse",
  "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "Stop", "SessionEnd",
]);
export const hookEnvelopeSchema = z.strictObject({
  schema_version: z.literal(1),
  event: hookEventSchema,
  host: z.enum(["codex", "claude"]),
  session_id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u),
  project_root: z.string().min(1),
  trusted: z.boolean(),
  payload: z.record(z.string(), z.unknown()),
});

export type HookEnvelope = z.infer<typeof hookEnvelopeSchema>;
export interface HookDecision {
  schema_version: 1;
  event: HookEnvelope["event"];
  action: "allow" | "deny" | "ask" | "inject" | "record";
  enforcement: "enforced" | "partial";
  reason: string;
  task_id: string | null;
  context?: string;
  gate?: GateDecision;
}

export async function dispatchHook(repository: TaskRepository, input: unknown): Promise<HookDecision> {
  const parsed = hookEnvelopeSchema.safeParse(input);
  if (!parsed.success) throw new LifecycleError(`HookEnvelope is invalid: ${parsed.error.issues[0]?.message ?? "unknown field"}`);
  const envelope = parsed.data;
  if (resolve(envelope.project_root) !== repository.projectRoot) throw new LifecycleError("hook workspace does not match the bound project root");
  const current = await repository.current(envelope.session_id);
  const taskId = current?.task.id ?? null;
  const enforcement = envelope.trusted ? "enforced" : "partial";
  let decision: HookDecision;

  switch (envelope.event) {
    case "SessionStart":
      decision = {
        schema_version:1, event:envelope.event, action:"inject", enforcement,
        reason:current === null ? "no active task bound to this session" : "active Trellis task restored",
        task_id:taskId,
        context:current === null ? "MTA: no active task." : `MTA task ${current.task.id}: ${current.task.status}. Path: ${current.pointer.task_path}`,
      };
      break;
    case "UserPromptSubmit":
      decision = { schema_version:1, event:envelope.event, action:"inject", enforcement, reason:"compact lifecycle breadcrumb", task_id:taskId, context:current === null ? "MTA: classify work before mutation." : `MTA: active task ${current.task.id} is ${current.task.status}.` };
      break;
    case "PreToolUse": {
      const status = await readProjectStatus(repository.projectRoot);
      const gate = await gateToolUse(repository, envelope.session_id, envelope.payload, { trusted:envelope.trusted, preAction:true, ownershipValid:status.ownershipValid });
      decision = { schema_version:1, event:envelope.event, action:gate.action, enforcement:gate.enforcement, reason:gate.reason, task_id:gate.task_id, gate };
      break;
    }
    case "PermissionRequest":
      decision = { schema_version:1, event:envelope.event, action:"ask", enforcement, reason:"permission remains controlled by the host and user", task_id:taskId };
      break;
    case "PostToolUse":
    case "SubagentStart":
    case "SubagentStop":
    case "PreCompact":
    case "PostCompact":
      decision = { schema_version:1, event:envelope.event, action:"record", enforcement, reason:"bounded lifecycle evidence recorded", task_id:taskId };
      break;
    case "Stop":
      decision = { schema_version:1, event:envelope.event, action:"inject", enforcement, reason:"foreground execution is never started by Stop", task_id:taskId, context:current === null ? "MTA: no bounded continuation." : `MTA: verify required work for ${current.task.id}; use foreground explicitly if needed.` };
      break;
    case "SessionEnd":
      decision = { schema_version:1, event:envelope.event, action:"record", enforcement, reason:"session boundary recorded and pointer released", task_id:taskId };
      break;
    default: {
      const exhaustive: never = envelope.event;
      void exhaustive;
      throw new LifecycleError("unsupported hook event");
    }
  }

  await recordDecision(repository.projectRoot, envelope, decision);
  if (envelope.event === "SessionEnd") await repository.finish(envelope.session_id);
  return decision;
}

async function recordDecision(projectRoot: string, envelope: HookEnvelope, decision: HookDecision): Promise<void> {
  const directory = resolve(projectRoot, ".mta", "sessions");
  await mkdir(directory, { recursive:true });
  const path = resolve(directory, `${envelope.session_id}.events.jsonl`);
  const record = redactValue({ schema_version:1, event:envelope.event, host:envelope.host, session_id:envelope.session_id, action:decision.action, enforcement:decision.enforcement, reason:decision.reason, task_id:decision.task_id, timestamp:new Date().toISOString() });
  const handle = await open(path, "a", 0o600);
  try { await handle.writeFile(`${JSON.stringify(record)}\n`); await handle.sync(); }
  finally { await handle.close(); }
}
