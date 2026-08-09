import { z } from "zod";

import { LifecycleError, type TaskRepository } from "./task-repository.js";

export const toolIntentSchema = z.strictObject({
  operation: z.enum(["read", "search", "status", "write", "execute", "delete", "move", "permission", "cancel", "complete"]),
  paths: z.array(z.string().refine((value) => value.trim().length > 0)).default([]),
  multi_file: z.boolean().default(false),
  cross_layer: z.boolean().default(false),
  concurrent_write: z.boolean().default(false),
  production: z.boolean().default(false),
  destructive: z.boolean().default(false),
  permission_escalation: z.boolean().default(false),
});

export type ToolIntent = z.infer<typeof toolIntentSchema>;
export type RiskLevel = "read_only" | "low_risk" | "managed" | "human_gate";
export interface GateDecision {
  schema_version: 1;
  risk: RiskLevel;
  action: "allow" | "deny" | "ask";
  reason: string;
  task_id: string | null;
  enforcement: "enforced" | "partial";
}

export function classifyRisk(input: unknown): { intent: ToolIntent; risk: RiskLevel } {
  const result = toolIntentSchema.safeParse(input);
  if (!result.success) throw new LifecycleError(`ToolIntent is invalid: ${result.error.issues[0]?.message ?? "unknown field"}`);
  const intent = result.data;
  if (["delete", "move", "permission", "cancel", "complete"].includes(intent.operation)
    || intent.destructive || intent.permission_escalation || intent.production) return { intent, risk:"human_gate" };
  if (["read", "search", "status"].includes(intent.operation)) return { intent, risk:"read_only" };
  if (intent.multi_file || intent.cross_layer || intent.concurrent_write || intent.paths.length > 1) return { intent, risk:"managed" };
  return { intent, risk:"low_risk" };
}

export async function gateToolUse(
  repository: TaskRepository,
  sessionId: string,
  input: unknown,
  options: { trusted: boolean; preAction: boolean; ownershipValid?: boolean },
): Promise<GateDecision> {
  const { risk } = classifyRisk(input);
  const enforcement = options.trusted && options.preAction ? "enforced" : "partial";
  const current = await repository.current(sessionId);
  const taskId = current?.task.id ?? null;
  if (risk === "read_only") return { schema_version:1, risk, action:"allow", reason:"read-only operation", task_id:taskId, enforcement };
  if (risk === "human_gate") return { schema_version:1, risk, action:"ask", reason:"operation requires attributable human approval", task_id:taskId, enforcement };
  if (!options.preAction) return { schema_version:1, risk, action:"deny", reason:"write authorization must happen before tool execution", task_id:taskId, enforcement:"partial" };
  if (!options.trusted) return { schema_version:1, risk, action:"deny", reason:"project hook is not trusted; write enforcement is unavailable", task_id:taskId, enforcement:"partial" };
  if (risk === "managed") {
    if (options.ownershipValid !== true) return { schema_version:1, risk, action:"deny", reason:"managed work requires a valid, drift-free apply ownership receipt", task_id:taskId, enforcement };
    if (current === null) return { schema_version:1, risk, action:"deny", reason:"managed work requires an active Trellis task", task_id:null, enforcement };
    if (current.task.status !== "in_progress") return { schema_version:1, risk, action:"deny", reason:`managed work requires in_progress; task is ${current.task.status}`, task_id:taskId, enforcement };
    return { schema_version:1, risk, action:"allow", reason:"managed write is bound to an active task", task_id:taskId, enforcement };
  }
  return { schema_version:1, risk, action:"allow", reason:"single low-risk reversible write", task_id:taskId, enforcement };
}
