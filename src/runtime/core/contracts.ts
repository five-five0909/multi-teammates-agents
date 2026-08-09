import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

const schemaVersion = z.literal(SCHEMA_VERSION);
const nonEmptyString = z.string().refine((value) => value.trim().length > 0, "must be a non-empty string");
const uniqueStrings = z.array(nonEmptyString).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message: "must not contain duplicates" });
  }
});

export const workModeSchema = z.enum(["read", "write", "verify"]);
export const workStatusSchema = z.enum([
  "pending",
  "running",
  "submitted",
  "auditing",
  "accepted",
  "rework",
  "blocked",
  "cancelled",
]);
export const runStateSchema = z.enum([
  "initialized",
  "managing",
  "executing_wave",
  "auditing_wave",
  "needs_input",
  "blocked",
  "proposed_complete",
  "completed",
  "cancelled",
]);

export const taskContractSchema = z
  .strictObject({
    schema_version: schemaVersion,
    goal: nonEmptyString,
    constraints: uniqueStrings,
    deliverables: uniqueStrings.min(1),
    acceptance_criteria: uniqueStrings.min(1),
  })
  .meta({ id: "TaskContract" });

export const workItemSchema = z
  .strictObject({
    schema_version: schemaVersion,
    id: nonEmptyString,
    objective: nonEmptyString,
    role: nonEmptyString,
    mode: workModeSchema,
    required: z.boolean(),
    depends_on: uniqueStrings,
    ownership: uniqueStrings,
    evidence_required: uniqueStrings,
    executor_id: nonEmptyString.nullish(),
    attempt: z.int().nonnegative().default(0),
    status: workStatusSchema.default("pending"),
  })
  .superRefine((item, context) => {
    if (item.mode === "write" && item.ownership.length === 0) {
      context.addIssue({ code: "custom", path: ["ownership"], message: "write WorkItem requires ownership" });
    }
    if (item.mode !== "write" && item.ownership.length > 0) {
      context.addIssue({ code: "custom", path: ["ownership"], message: "non-write WorkItem cannot claim ownership" });
    }
  })
  .meta({ id: "WorkItem" });

export const roleResultSchema = z
  .strictObject({
    schema_version: schemaVersion,
    work_item_id: nonEmptyString,
    attempt: z.int().min(1),
    executor_id: nonEmptyString,
    summary: nonEmptyString,
    artifacts: uniqueStrings,
    evidence: uniqueStrings,
    checks: uniqueStrings,
    risks: uniqueStrings,
    failure: nonEmptyString.nullish(),
  })
  .meta({ id: "RoleResult" });

export const auditDecisionSchema = z
  .strictObject({
    schema_version: schemaVersion,
    work_item_id: nonEmptyString,
    attempt: z.int().min(1),
    auditor_id: nonEmptyString,
    executor_id: nonEmptyString,
    status: z.enum(["accepted", "rework", "blocked", "invalid"]),
    integrity: z.enum(["clean", "dirty"]),
    contract_alignment: z.enum(["aligned", "misaligned"]),
    evidence: uniqueStrings,
    findings: uniqueStrings,
    required_rework: uniqueStrings,
  })
  .superRefine((audit, context) => {
    if (audit.auditor_id === audit.executor_id) {
      context.addIssue({ code: "custom", path: ["auditor_id"], message: "Auditor must be independent from Executor" });
    }
    if (audit.status === "accepted" && (audit.integrity !== "clean" || audit.contract_alignment !== "aligned")) {
      context.addIssue({ code: "custom", path: ["status"], message: "accepted audit requires clean integrity and aligned contract" });
    }
  })
  .meta({ id: "AuditDecision" });

export const decisionProvenanceSchema = z
  .strictObject({
    schema_version: schemaVersion,
    gate_type: z.enum([
      "mode_selection",
      "task_consent",
      "planning_review",
      "completion",
      "permission",
      "cancellation",
      "ask",
      "blocked",
      "repeated_failure",
      "budget",
    ]),
    actor: z.enum(["user", "policy", "host", "legacy"]),
    source: z.enum(["policy", "mcp_elicitation", "host_single_select", "user_prompt", "legacy_unverified"]),
    verification: z.enum(["verified", "host_reported", "unverified"]),
    timestamp: nonEmptyString,
    source_event_id: nonEmptyString.nullish(),
    invocation_id: nonEmptyString.nullish(),
  })
  .superRefine((decision, context) => {
    if (decision.verification === "verified" && decision.actor === "user" && decision.source_event_id == null) {
      context.addIssue({ code: "custom", path: ["source_event_id"], message: "verified user decisions require source_event_id" });
    }
    if (decision.source === "legacy_unverified" && decision.verification === "verified") {
      context.addIssue({ code: "custom", path: ["verification"], message: "legacy decisions cannot be verified" });
    }
  })
  .meta({ id: "DecisionProvenance" });

export const humanDecisionSchema = z
  .strictObject({
    schema_version: schemaVersion,
    gate_type: z.enum(["ask", "blocked", "repeated_failure", "budget", "completion", "permission", "cancellation"]),
    decision: z.enum(["approve", "reject", "continue", "cancel", "instruct"]),
    actor: nonEmptyString,
    timestamp: nonEmptyString,
    instruction: nonEmptyString.nullish(),
    provenance: decisionProvenanceSchema.nullish(),
  })
  .superRefine((decision, context) => {
    if (decision.decision === "instruct" && decision.instruction == null) {
      context.addIssue({ code: "custom", path: ["instruction"], message: "instruct decision requires instruction" });
    }
  })
  .meta({ id: "HumanDecision" });

export const backendEventSchema = z
  .strictObject({
    schema_version: schemaVersion,
    host: z.enum(["codex", "claude"]),
    role: z.enum(["manager", "executor", "auditor"]),
    action: nonEmptyString,
    status: z.enum(["started", "progress", "completed", "failed", "permission_required", "cancelled"]),
    source_id: nonEmptyString,
    references: uniqueStrings,
    tool: nonEmptyString.nullish(),
  })
  .meta({ id: "BackendEvent" });

export const runEventSchema = z
  .strictObject({
    schema_version: schemaVersion,
    id: nonEmptyString,
    run_id: nonEmptyString,
    seq: z.int().min(1),
    expected_version: z.int().nonnegative(),
    kind: nonEmptyString,
    timestamp: nonEmptyString,
    payload: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "RunEvent" });

export const episodeEventPayloadSchema = z.looseObject({
  episode_id: nonEmptyString,
  role: z.enum(["manager", "executor", "auditor"]),
  host: nonEmptyString,
  work_item_id: nonEmptyString.optional(),
  status: nonEmptyString.optional(),
  trace_ref: nonEmptyString.optional(),
  reason: nonEmptyString.optional(),
});

export const runSnapshotSchema = z
  .strictObject({
    schema_version: schemaVersion,
    run_id: nonEmptyString,
    state: runStateSchema,
    version: z.int().nonnegative(),
    last_seq: z.int().nonnegative(),
    contract: taskContractSchema,
    work_items: z.record(z.string(), workItemSchema),
    verified_progress: z.record(z.string(), uniqueStrings),
    event_ids: uniqueStrings,
    pending_gate: nonEmptyString.nullable(),
    rounds_used: z.int().nonnegative(),
    max_rounds: z.int().min(1),
    retry_limit: z.int().min(1),
  })
  .superRefine((snapshot, context) => {
    for (const [id, item] of Object.entries(snapshot.work_items)) {
      if (item.id !== id) {
        context.addIssue({ code: "custom", path: ["work_items", id], message: `work item key mismatch: ${id}` });
      }
    }
    for (const id of Object.keys(snapshot.verified_progress)) {
      if (!(id in snapshot.work_items)) {
        context.addIssue({ code: "custom", path: ["verified_progress", id], message: `references unknown item: ${id}` });
      }
    }
  })
  .meta({ id: "RunSnapshot" });

export type TaskContract = z.infer<typeof taskContractSchema>;
export type WorkItem = z.infer<typeof workItemSchema>;
export type WorkMode = z.infer<typeof workModeSchema>;
export type WorkStatus = z.infer<typeof workStatusSchema>;
export type RoleResult = z.infer<typeof roleResultSchema>;
export type AuditDecision = z.infer<typeof auditDecisionSchema>;
export type DecisionProvenance = z.infer<typeof decisionProvenanceSchema>;
export type HumanDecision = z.infer<typeof humanDecisionSchema>;
export type BackendEvent = z.infer<typeof backendEventSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type EpisodeEventPayload = z.infer<typeof episodeEventPayloadSchema>;
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;
export type RunState = z.infer<typeof runStateSchema>;

export const runtimeSchemas = {
  TaskContract: taskContractSchema,
  WorkItem: workItemSchema,
  RoleResult: roleResultSchema,
  AuditDecision: auditDecisionSchema,
  DecisionProvenance: decisionProvenanceSchema,
  HumanDecision: humanDecisionSchema,
  BackendEvent: backendEventSchema,
  RunEvent: runEventSchema,
  RunSnapshot: runSnapshotSchema,
} as const;

export class ContractError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ContractError";
  }
}

export function decodeContract<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.length ? `.${issue.path.join(".")}` : "";
    throw new ContractError(`${label}${path} is invalid: ${issue?.message ?? "unknown validation error"}`, {
      cause: result.error,
    });
  }
  return result.data;
}
