import { z } from "zod";

import {
  auditDecisionSchema,
  ContractError,
  decodeContract,
  roleResultSchema,
  type AuditDecision,
  type RoleResult,
  type RunSnapshot,
  type WorkItem,
} from "../core/contracts.js";

const managerDecisionSchema = z.strictObject({
  schema_version: z.literal(1),
  action: z.enum(["execute", "ask", "blocked", "propose_complete", "cancel"]),
  work_item_ids: z.array(z.string().refine((value) => value.trim().length > 0)).refine((values) => new Set(values).size === values.length),
  message: z.string(),
});

export type ManagerDecision = z.infer<typeof managerDecisionSchema>;

function parseJsonObject(output: string, label: string): unknown {
  let text = output.trim();
  if (text.startsWith("```") && text.endsWith("```")) {
    const lines = text.split(/\r?\n/u);
    if (lines.length >= 3) {
      text = lines.slice(1, -1).join("\n");
      if (text.trimStart().startsWith("json")) text = text.trimStart().slice(4).trimStart();
    }
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new ContractError(`${label} output is not one JSON object`, { cause: error });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ContractError(`${label} output must be a JSON object`);
  return value;
}

function boundedStateJson(state: Record<string, unknown>, maxChars: number): string {
  if (maxChars < 500) throw new ContractError("Manager context budget is too small");
  const value = structuredClone(state);
  let encoded = JSON.stringify(value);
  if (encoded.length <= maxChars) return encoded;
  const verified = value.verified_progress as Record<string, unknown[]>;
  for (const id of Object.keys(verified)) verified[id] = verified[id]?.slice(0, 1) ?? [];
  value.goal = String(value.goal).slice(0, Math.max(200, Math.floor(maxChars / 5)));
  for (const item of value.unresolved_work as Array<Record<string, unknown>>) item.objective = String(item.objective).slice(0, 300);
  encoded = JSON.stringify(value);
  if (encoded.length <= maxChars) return encoded;
  value.constraints = [];
  value.deliverables = (value.deliverables as unknown[]).slice(0, 3);
  value.acceptance_criteria = (value.acceptance_criteria as unknown[]).slice(0, 3);
  encoded = JSON.stringify(value);
  if (encoded.length > maxChars) throw new ContractError("compact Manager state exceeds configured context budget");
  return encoded;
}

export function buildManagerPrompt(snapshot: RunSnapshot, maxChars: number): string {
  const state = {
    schema_version: 1,
    goal: snapshot.contract.goal,
    constraints: snapshot.contract.constraints,
    deliverables: snapshot.contract.deliverables,
    acceptance_criteria: snapshot.contract.acceptance_criteria,
    verified_progress: snapshot.verified_progress,
    unresolved_work: Object.values(snapshot.work_items)
      .filter((item) => item.status !== "accepted" && item.status !== "cancelled")
      .map(({ id, objective, role, mode, required, depends_on, status, attempt }) => ({ id, objective, role, mode, required, depends_on, status, attempt })),
    budget: { rounds_used: snapshot.rounds_used, max_rounds: snapshot.max_rounds, retry_limit: snapshot.retry_limit },
  };
  const prompt = "You are the Expert Team Manager. Plan only; never claim execution or audit evidence.\n"
    + "Choose exactly one action: execute, ask, blocked, propose_complete, cancel.\n"
    + "For execute, select only dependency-ready unresolved work item IDs.\n"
    + "Return JSON only: {\"schema_version\":1,\"action\":\"execute\",\"work_item_ids\":[\"id\"],\"message\":\"reason\"}.\n"
    + `Authoritative compact state:\n${boundedStateJson(state, maxChars - 1200)}`;
  if (prompt.length > maxChars) throw new ContractError("Manager prompt exceeds configured context budget");
  return prompt;
}

export function buildExecutorPrompt(snapshot: RunSnapshot, item: WorkItem, executorId: string, maxChars: number): string {
  const template = { schema_version:1, work_item_id:item.id, attempt:item.status === "running" ? item.attempt : item.attempt + 1, executor_id:executorId, summary:"one sentence summary", artifacts:["relative/path/or/observed/artifact"], evidence:["actual observation or command/test evidence"], checks:["check performed and result"], risks:[], failure:null };
  const payload = { goal:snapshot.contract.goal, work_item:item, executor_id:executorId, accepted_dependencies:Object.fromEntries(item.depends_on.map((id) => [id, snapshot.verified_progress[id] ?? []])) };
  const prompt = "You are an Expert Team Executor in a fresh context. Complete only the bounded work item. Do not certify your own work. "
    + "Your final assistant message must be exactly one JSON object, with no prose before or after it, matching this RoleResult schema and field names:\n"
    + `${JSON.stringify(template)}\nAuthoritative assignment:\n${JSON.stringify(payload)}`;
  if (prompt.length > maxChars) throw new ContractError("Executor prompt exceeds configured context budget");
  return prompt;
}

export function buildAuditorPrompt(snapshot: RunSnapshot, item: WorkItem, result: RoleResult, auditorId: string, maxChars: number): string {
  const template = { schema_version:1, work_item_id:item.id, attempt:result.attempt, auditor_id:auditorId, executor_id:result.executor_id, status:"accepted", integrity:"clean", contract_alignment:"aligned", evidence:["actual verification evidence"], findings:[], required_rework:[] };
  const payload = { goal:snapshot.contract.goal, acceptance_criteria:snapshot.contract.acceptance_criteria, work_item:item, executor_result:result, auditor_id:auditorId };
  const prompt = "You are an independent read-only Expert Team Auditor. Inspect the actual workspace and evidence. Do not create, edit, move, or delete files. Never repair the Executor's work. "
    + "Your final assistant message must be exactly one JSON object, with no prose before or after it. Accepted requires clean integrity and aligned contract. Use only these AuditDecision field names:\n"
    + `${JSON.stringify(template)}\nAuthoritative audit input:\n${JSON.stringify(payload)}`;
  if (prompt.length > maxChars) throw new ContractError("Auditor prompt exceeds configured context budget");
  return prompt;
}

export function parseManagerDecision(output: string, snapshot: RunSnapshot): ManagerDecision {
  const decision = decodeContract(managerDecisionSchema, parseJsonObject(output, "ManagerDecision"), "ManagerDecision");
  if (decision.action === "execute") {
    if (decision.work_item_ids.length === 0) throw new ContractError("execute decision requires work_item_ids");
    for (const id of decision.work_item_ids) {
      const item = snapshot.work_items[id];
      if (item === undefined || (item.status !== "pending" && item.status !== "rework")) throw new ContractError(`Manager selected unavailable work item: ${id}`);
      if (item.depends_on.some((dependency) => snapshot.work_items[dependency]?.status !== "accepted")) throw new ContractError(`Manager selected work item with unmet dependency: ${id}`);
    }
  } else if (decision.work_item_ids.length > 0) throw new ContractError(`${decision.action} decision cannot include work_item_ids`);
  return decision;
}

export function parseRoleResult(output: string, item: WorkItem, executorId: string): RoleResult {
  const result = decodeContract(roleResultSchema, parseJsonObject(output, "RoleResult"), "RoleResult");
  if (result.work_item_id !== item.id || result.attempt !== item.attempt || result.executor_id !== executorId) throw new ContractError("RoleResult identity does not match active Executor attempt");
  return result;
}

export function parseAuditDecision(output: string, item: WorkItem, executorId: string, auditorId: string): AuditDecision {
  const decision = decodeContract(auditDecisionSchema, parseJsonObject(output, "AuditDecision"), "AuditDecision");
  if (decision.work_item_id !== item.id || decision.attempt !== item.attempt || decision.executor_id !== executorId || decision.auditor_id !== auditorId) throw new ContractError("AuditDecision identity does not match active audit attempt");
  return decision;
}
