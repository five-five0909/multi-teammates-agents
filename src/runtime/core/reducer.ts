import {
  auditDecisionSchema,
  ContractError,
  decodeContract,
  episodeEventPayloadSchema,
  roleResultSchema,
  runSnapshotSchema,
  SCHEMA_VERSION,
  type RunEvent,
  type RunSnapshot,
  type TaskContract,
  type WorkItem,
  type WorkStatus,
} from "./contracts.js";
import { validateParallelWave, validateWorkGraph } from "./scheduling.js";

export const EVENT_KINDS = [
  "run.managing",
  "wave.execution_started",
  "executor.result_submitted",
  "wave.audit_started",
  "audit.recorded",
  "human.gate_requested",
  "human.decision_recorded",
  "run.blocked",
  "run.cancelled",
  "episode.started",
  "episode.completed",
  "episode.failed",
  "episode.timeout",
  "episode.cancelled",
  "episode.abandoned",
] as const;

type EventKind = (typeof EVENT_KINDS)[number];
type EpisodeKind = Extract<EventKind, `episode.${string}`>;
const eventKinds = new Set<string>(EVENT_KINDS);
const gateTypes = new Set(["ask", "blocked", "repeated_failure", "budget", "completion", "permission", "cancellation"]);
const terminalStates = new Set(["completed", "cancelled", "blocked", "needs_input", "proposed_complete"]);

export function createSnapshot(
  runId: string,
  contract: TaskContract,
  workItems: Iterable<WorkItem>,
  options: { maxRounds?: number; retryLimit?: number } = {},
): RunSnapshot {
  if (runId.trim().length === 0) throw new ContractError("run_id must be a non-empty string");
  const maxRounds = options.maxRounds ?? 20;
  const retryLimit = options.retryLimit ?? 2;
  if (maxRounds < 1 || retryLimit < 1) throw new ContractError("max_rounds and retry_limit must be positive");
  return decodeContract(runSnapshotSchema, {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    state: "initialized",
    version: 0,
    last_seq: 0,
    contract,
    work_items: validateWorkGraph(workItems),
    verified_progress: {},
    event_ids: [],
    pending_gate: null,
    rounds_used: 0,
    max_rounds: maxRounds,
    retry_limit: retryLimit,
  }, "RunSnapshot");
}

function payloadId(payload: Record<string, unknown>, name: string): string {
  const value = payload[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContractError(`event payload ${name} must be a non-empty string`);
  }
  return value;
}

function item(snapshot: RunSnapshot, id: string): WorkItem {
  const value = snapshot.work_items[id];
  if (value === undefined) throw new ContractError(`unknown work item: ${id}`);
  return value;
}

function updateItem(items: Record<string, WorkItem>, value: WorkItem): Record<string, WorkItem> {
  return { ...items, [value.id]: value };
}

function canComplete(items: Record<string, WorkItem>): boolean {
  return Object.values(items).every((value) => !value.required || value.status === "accepted");
}

function retryStatus(itemValue: WorkItem, snapshot: RunSnapshot): WorkStatus {
  return itemValue.attempt >= snapshot.retry_limit ? "blocked" : "rework";
}

function isEpisodeKind(kind: EventKind): kind is EpisodeKind {
  return kind.startsWith("episode.");
}

export function applyEvent(snapshot: RunSnapshot, event: RunEvent): RunSnapshot {
  if (event.run_id !== snapshot.run_id) throw new ContractError("event run_id does not match snapshot");
  if (snapshot.event_ids.includes(event.id)) return snapshot;
  if (!eventKinds.has(event.kind)) throw new ContractError(`unknown event kind: ${event.kind}`);
  if (event.seq !== snapshot.last_seq + 1) throw new ContractError(`event seq must be ${snapshot.last_seq + 1}`);
  if (event.expected_version !== snapshot.version) {
    throw new ContractError(`version conflict: expected ${snapshot.version}, got ${event.expected_version}`);
  }

  let state = snapshot.state;
  let items = { ...snapshot.work_items };
  const verified = { ...snapshot.verified_progress };
  let gate = snapshot.pending_gate;
  let rounds = snapshot.rounds_used;
  const kind = event.kind as EventKind;

  if (isEpisodeKind(kind)) {
    const episode = decodeContract(episodeEventPayloadSchema, event.payload, "EpisodeEvent.payload");
    const episodeId = episode.episode_id;
    const role = episode.role;
    const expected = { manager: "managing", executor: "executing_wave", auditor: "auditing_wave" } as const;
    const terminalAbandonment = kind === "episode.abandoned" && terminalStates.has(state);
    if (state !== expected[role] && !terminalAbandonment) {
      throw new ContractError(`cannot record ${role} episode ${episodeId} from ${state}`);
    }
    if (["episode.abandoned", "episode.failed", "episode.timeout", "episode.cancelled"].includes(kind)
      && role !== "manager" && !terminalAbandonment) {
      const itemId = payloadId(episode, "work_item_id");
      const active = item(snapshot, itemId);
      const expectedStatus = role === "executor" ? "running" : "auditing";
      if (active.status !== expectedStatus) throw new ContractError(`failed ${role} episode does not match active work item`);
      items = updateItem(items, { ...active, status: retryStatus(active, snapshot) });
      if (!Object.values(items).some((value) => ["running", "auditing", "submitted"].includes(value.status))) {
        state = Object.values(items).some((value) => value.status === "blocked") ? "blocked" : "managing";
      }
    }
  } else {
    switch (kind) {
      case "run.managing": {
        if (!["initialized", "executing_wave", "auditing_wave", "needs_input"].includes(state)) {
          throw new ContractError(`cannot enter managing from ${state}`);
        }
        if (state === "executing_wave" && Object.values(items).some((value) => ["running", "submitted"].includes(value.status))) {
          throw new ContractError("cannot leave execution wave while work items are active");
        }
        if (state === "auditing_wave" && Object.values(items).some((value) => value.status === "auditing")) {
          throw new ContractError("cannot leave audit wave while work items await audit");
        }
        state = "managing";
        gate = null;
        break;
      }
      case "wave.execution_started": {
        if (state !== "managing") throw new ContractError(`cannot start execution from ${state}`);
        const ids = event.payload.work_item_ids;
        if (!Array.isArray(ids) || ids.length === 0 || !ids.every((value): value is string => typeof value === "string")) {
          throw new ContractError("execution wave requires work_item_ids");
        }
        if (new Set(ids).size !== ids.length) throw new ContractError("execution wave contains duplicate work_item_ids");
        validateParallelWave(ids.map((id) => item(snapshot, id)));
        const assignments = typeof event.payload.assignments === "object" && event.payload.assignments !== null
          ? event.payload.assignments as Record<string, unknown> : {};
        const single = event.payload.executor_id;
        for (const id of ids) {
          const active = item(snapshot, id);
          if (active.status !== "pending" && active.status !== "rework") throw new ContractError(`${id}: cannot execute from ${active.status}`);
          if (active.depends_on.some((dependency) => items[dependency]?.status !== "accepted")) {
            throw new ContractError(`${id}: dependencies are not accepted`);
          }
          const assignment = typeof assignments[id] === "string" ? assignments[id] : ids.length === 1 ? single : undefined;
          if (typeof assignment !== "string" || assignment.trim().length === 0) {
            throw new ContractError(`${id}: execution wave requires a unique executor assignment`);
          }
          items = updateItem(items, { ...active, status: "running", attempt: active.attempt + 1, executor_id: assignment });
        }
        state = "executing_wave";
        rounds += 1;
        if (rounds > snapshot.max_rounds) throw new ContractError("round budget exhausted");
        break;
      }
      case "executor.result_submitted": {
        if (state !== "executing_wave") throw new ContractError(`cannot submit Executor result from ${state}`);
        const result = decodeContract(roleResultSchema, event.payload, "RoleResult");
        const active = item(snapshot, result.work_item_id);
        if (active.status !== "running" || active.attempt !== result.attempt) throw new ContractError("Executor result does not match active attempt");
        if (active.executor_id != null && active.executor_id !== result.executor_id) throw new ContractError("Executor result identity does not match assignment");
        items = updateItem(items, { ...active, status: "submitted", executor_id: result.executor_id });
        break;
      }
      case "wave.audit_started": {
        if (state !== "executing_wave") throw new ContractError(`cannot start audit from ${state}`);
        const candidates = Object.values(items).filter((value) => value.status === "submitted");
        if (candidates.length === 0) throw new ContractError("audit wave requires submitted work");
        if (Object.values(items).some((value) => value.status === "running")) throw new ContractError("cannot start audit while Executors are still running");
        for (const candidate of candidates) items = updateItem(items, { ...candidate, status: "auditing" });
        state = "auditing_wave";
        break;
      }
      case "audit.recorded": {
        if (state !== "auditing_wave") throw new ContractError(`cannot record audit from ${state}`);
        const audit = decodeContract(auditDecisionSchema, event.payload, "AuditDecision");
        const active = item(snapshot, audit.work_item_id);
        if (active.status !== "auditing" || active.attempt !== audit.attempt) throw new ContractError("audit does not match active attempt");
        if (active.executor_id !== audit.executor_id) throw new ContractError("audit Executor identity does not match assignment");
        let status: WorkStatus = audit.status === "invalid" ? "rework" : audit.status;
        if (audit.status === "accepted") verified[active.id] = audit.evidence;
        else if (audit.status === "rework" || audit.status === "invalid") status = retryStatus(active, snapshot);
        items = updateItem(items, { ...active, status });
        if (!Object.values(items).some((value) => value.status === "auditing") && Object.values(items).some((value) => value.status === "blocked")) {
          state = "blocked";
        }
        break;
      }
      case "human.gate_requested": {
        if (!["managing", "executing_wave", "auditing_wave", "blocked"].includes(state)) throw new ContractError(`cannot request human gate from ${state}`);
        gate = payloadId(event.payload, "gate_type");
        if (!gateTypes.has(gate)) throw new ContractError(`unknown human gate type: ${gate}`);
        if (state === "executing_wave") {
          if (!["permission", "repeated_failure", "budget", "cancellation", "blocked"].includes(gate)) {
            throw new ContractError(`cannot request human gate from ${state}`);
          }
          for (const active of Object.values(items)) {
            if (["running", "submitted", "auditing"].includes(active.status)) items = updateItem(items, { ...active, status: retryStatus(active, snapshot) });
          }
        } else if (state === "auditing_wave" && gate !== "completion") {
          for (const active of Object.values(items)) {
            if (["running", "submitted", "auditing"].includes(active.status)) items = updateItem(items, { ...active, status: retryStatus(active, snapshot) });
          }
        }
        if (gate === "completion") {
          if (!canComplete(items)) throw new ContractError("cannot propose completion with unaccepted required work");
          state = "proposed_complete";
        } else state = "needs_input";
        break;
      }
      case "human.decision_recorded": {
        if (!["needs_input", "proposed_complete", "blocked"].includes(state)) throw new ContractError(`cannot record human decision from ${state}`);
        const decisionGate = payloadId(event.payload, "gate_type");
        if (decisionGate !== gate) throw new ContractError(`human decision gate mismatch: expected ${String(gate)}, got ${decisionGate}`);
        const decision = payloadId(event.payload, "decision");
        if (decision === "cancel") state = "cancelled";
        else if (state === "proposed_complete" && decision === "approve") {
          if (!canComplete(items)) throw new ContractError("completion invariant failed");
          state = "completed";
        } else if (["approve", "continue", "instruct", "reject"].includes(decision)) state = "managing";
        else throw new ContractError(`unsupported decision ${decision} for ${state}`);
        gate = null;
        break;
      }
      case "run.blocked":
        if (state === "completed" || state === "cancelled") throw new ContractError(`cannot block terminal run ${state}`);
        state = "blocked";
        break;
      case "run.cancelled":
        if (state === "completed") throw new ContractError("cannot cancel a completed run");
        state = "cancelled";
        break;
      default: {
        const exhaustive: never = kind;
        void exhaustive;
        throw new ContractError("unhandled event kind");
      }
    }
  }

  return decodeContract(runSnapshotSchema, {
    ...snapshot,
    state,
    version: snapshot.version + 1,
    last_seq: event.seq,
    work_items: items,
    verified_progress: verified,
    event_ids: [...snapshot.event_ids, event.id],
    pending_gate: gate,
    rounds_used: rounds,
  }, "RunSnapshot");
}

export function replay(initial: RunSnapshot, events: Iterable<RunEvent>): RunSnapshot {
  let snapshot = initial;
  for (const event of events) snapshot = applyEvent(snapshot, event);
  return snapshot;
}
