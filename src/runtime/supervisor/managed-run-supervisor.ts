import { randomUUID } from "node:crypto";

import {
  auditDecisionSchema,
  ContractError,
  decodeContract,
  episodeEventPayloadSchema,
  roleResultSchema,
  SCHEMA_VERSION,
  type AuditDecision,
  type RoleResult,
  type RunSnapshot,
  type WorkItem,
} from "../core/contracts.js";
import { diffWorkspace, snapshotWorkspace, type WorkspaceDiff, type WorkspaceSnapshot } from "./audit-guard.js";
import type { EpisodeRequest, EpisodeResult, EpisodeRole, HostAdapter, RuntimeConfig } from "./host-adapter.js";
import { buildAuditorPrompt, buildExecutorPrompt, buildManagerPrompt, parseAuditDecision, parseManagerDecision, parseRoleResult, type ManagerDecision } from "./prompts.js";
import type { RuntimeRepository } from "./runtime-repository.js";

const terminalStates = new Set(["completed", "cancelled", "blocked", "needs_input", "proposed_complete"]);
const now = (): string => new Date().toISOString();

export interface SupervisorOutcome { snapshot: RunSnapshot; episodeIds: string[] }

export class ManagedRunSupervisor {
  public constructor(
    private readonly repository: RuntimeRepository,
    private readonly config: RuntimeConfig,
    private readonly adapters: Record<string, HostAdapter>,
  ) {
    const missing = new Set(Object.values(config.roles).map((role) => role.host).filter((host) => adapters[host] === undefined));
    if (missing.size > 0) throw new ContractError(`missing host adapters: ${[...missing].sort().join(", ")}`);
    if (!Number.isInteger(config.maxConcurrency) || config.maxConcurrency < 1) throw new ContractError("maxConcurrency must be positive");
  }

  public async run(): Promise<SupervisorOutcome> {
    const episodeIds: string[] = [];
    let invalidManagerOutputs = 0;
    await this.reconcileAbandoned();
    while (true) {
      let snapshot = await this.repository.load();
      if (terminalStates.has(snapshot.state)) return { snapshot, episodeIds };
      if (snapshot.state === "initialized") {
        snapshot = await this.repository.transition("run.managing", {});
      }
      if (snapshot.state === "executing_wave" || snapshot.state === "auditing_wave") {
        await this.resumeWave(episodeIds);
        continue;
      }
      if (snapshot.state !== "managing") throw new ContractError(`supervisor cannot advance from ${snapshot.state}`);
      if (snapshot.rounds_used >= snapshot.max_rounds && Object.values(snapshot.work_items).some((item) => item.required && item.status !== "accepted")) {
        const gated = await this.repository.transition("human.gate_requested", { gate_type:"budget", rounds_used:snapshot.rounds_used });
        return { snapshot:gated, episodeIds };
      }

      const manager = this.config.roles.manager;
      const episodeId = this.episodeId(snapshot, "manager");
      episodeIds.push(episodeId);
      const result = await this.runEpisode(this.adapters[manager.host]!, {
        episodeId, runId:snapshot.run_id, roundIndex:Math.max(1, snapshot.rounds_used + 1), role:"manager", profile:"manager",
        prompt:buildManagerPrompt(snapshot, manager.contextChars), workspace:this.config.workspace, model:manager.model,
        timeoutSeconds:manager.timeoutSeconds, maxOutputChars:manager.outputChars, permissionPosture:"host-controlled", readOnly:true,
      });
      if (result.status === "permission_required" || result.status === "cancelled") {
        const current = await this.repository.load();
        if (terminalStates.has(current.state)) return { snapshot:current, episodeIds };
        const gateType = result.status === "permission_required" ? "permission" : "cancellation";
        const gated = await this.repository.transition("human.gate_requested", { gate_type:gateType, role:"manager", episode_id:episodeId });
        return { snapshot:gated, episodeIds };
      }
      const afterManager = await this.repository.load();
      if (terminalStates.has(afterManager.state)) return { snapshot:afterManager, episodeIds };
      if (result.status !== "done") {
        invalidManagerOutputs += 1;
        if (invalidManagerOutputs >= snapshot.retry_limit) {
          const gated = await this.repository.transition("human.gate_requested", { gate_type:"repeated_failure" });
          return { snapshot:gated, episodeIds };
        }
        continue;
      }
      let decision: ManagerDecision;
      try { decision = parseManagerDecision(result.visibleOutput, snapshot); }
      catch (error) {
        if (!(error instanceof ContractError)) throw error;
        invalidManagerOutputs += 1;
        if (invalidManagerOutputs >= snapshot.retry_limit) {
          const gated = await this.repository.transition("human.gate_requested", { gate_type:"repeated_failure" });
          return { snapshot:gated, episodeIds };
        }
        continue;
      }
      invalidManagerOutputs = 0;
      if (decision.action !== "execute") {
        const terminal = await this.applyManagerDecision(decision);
        return { snapshot:terminal, episodeIds };
      }
      await this.executeAndAuditWave(decision, episodeIds);
      const after = await this.repository.load();
      if (after.state === "blocked") {
        const gated = await this.repository.transition("human.gate_requested", { gate_type:"blocked" });
        return { snapshot:gated, episodeIds };
      }
      if (after.state === "auditing_wave") await this.repository.transition("run.managing", {});
    }
  }

  private async applyManagerDecision(decision: ManagerDecision): Promise<RunSnapshot> {
    const payload = { manager_action:decision.action, manager_message:decision.message, work_item_ids:[] };
    switch (decision.action) {
      case "ask": return this.repository.transition("human.gate_requested", { ...payload, gate_type:"ask", question:decision.message });
      case "blocked": return this.repository.transition("human.gate_requested", { ...payload, gate_type:"blocked", reason:decision.message });
      case "propose_complete": {
        let snapshot = await this.repository.transition("human.gate_requested", { ...payload, gate_type:"completion" });
        if (!this.config.humanCompletionGate) {
          snapshot = await this.repository.answer({ schema_version:SCHEMA_VERSION, gate_type:"completion", decision:"approve", actor:"configured-policy", timestamp:now() });
        }
        return snapshot;
      }
      case "cancel": return this.repository.transition("run.cancelled", payload);
      case "execute": throw new ContractError("execute decision must enter a work wave");
      default: {
        const exhaustive: never = decision.action;
        void exhaustive;
        throw new ContractError("unhandled Manager decision");
      }
    }
  }

  private async executeAndAuditWave(decision: ManagerDecision, episodeIds: string[]): Promise<void> {
    const before = await this.repository.load();
    const assignments = Object.fromEntries(decision.work_item_ids.map((id) => [id, `executor-${id}-${(before.work_items[id]?.attempt ?? 0) + 1}-${randomUUID().slice(0, 8)}`]));
    await this.repository.transition("wave.execution_started", { work_item_ids:decision.work_item_ids, assignments, round:before.rounds_used + 1, manager_action:decision.action, manager_message:decision.message });
    const active = await this.repository.load();
    const outcomes = await mapLimit(decision.work_item_ids, this.config.maxConcurrency, async (id) => this.executeItem(active, active.work_items[id]!, assignments[id]!, episodeIds));
    const current = await this.repository.load();
    if (terminalStates.has(current.state)) return;
    const failures = outcomes.filter((value) => value.episode.status !== "done");
    if (failures.length > 0) {
      await this.repository.transition("human.gate_requested", { gate_type:this.failureGate(failures.map((value) => value.episode.status)), role:"executor", episode_ids:failures.map((value) => value.episode.episodeId), statuses:failures.map((value) => value.episode.status) });
      return;
    }
    for (const { result } of outcomes) await this.repository.submitResult(result);
    await this.repository.transition("wave.audit_started", {});
    const auditFailures: string[] = [];
    for (const { result } of outcomes) {
      const auditSnapshot = await this.repository.load();
      if (terminalStates.has(auditSnapshot.state)) return;
      const audit = await this.auditItem(auditSnapshot, auditSnapshot.work_items[result.work_item_id]!, result, episodeIds);
      if (audit.decision === null) auditFailures.push(audit.status);
      else await this.repository.submitAudit(audit.decision);
    }
    if (auditFailures.length > 0 && !terminalStates.has((await this.repository.load()).state)) {
      await this.repository.transition("human.gate_requested", { gate_type:this.failureGate(auditFailures), role:"auditor", statuses:auditFailures });
    }
  }

  private async executeItem(snapshot: RunSnapshot, item: WorkItem, executorId: string, episodeIds: string[]): Promise<{ result: RoleResult; episode: EpisodeResult }> {
    const binding = this.config.roles.executor;
    const episodeId = this.episodeId(snapshot, "executor", item.id);
    episodeIds.push(episodeId);
    const episode = await this.runEpisode(this.adapters[binding.host]!, {
      episodeId, runId:snapshot.run_id, roundIndex:snapshot.rounds_used, role:"executor", profile:item.role,
      prompt:buildExecutorPrompt(snapshot, item, executorId, binding.contextChars), workspace:this.config.workspace, model:binding.model,
      timeoutSeconds:binding.timeoutSeconds, maxOutputChars:binding.outputChars, permissionPosture:"host-controlled", readOnly:false, workItemId:item.id,
    });
    if (episode.status === "done") {
      try { return { result:parseRoleResult(episode.visibleOutput, item, executorId), episode }; }
      catch (error) { if (!(error instanceof ContractError)) throw error; return { result:this.failedResult(item, executorId, error.message), episode }; }
    }
    return { result:this.failedResult(item, executorId, episode.error ?? episode.status), episode };
  }

  private async auditItem(snapshot: RunSnapshot, item: WorkItem, result: RoleResult, episodeIds: string[]): Promise<{ decision: AuditDecision | null; status: string }> {
    const binding = this.config.roles.auditor;
    const episodeId = this.episodeId(snapshot, "auditor", item.id);
    const auditorId = `auditor-${item.id}-${item.attempt}-${randomUUID().slice(0, 8)}`;
    episodeIds.push(episodeId);
    const before = await this.safeWorkspaceSnapshot();
    const episode = await this.runEpisode(this.adapters[binding.host]!, {
      episodeId, runId:snapshot.run_id, roundIndex:snapshot.rounds_used, role:"auditor", profile:"independent-auditor",
      prompt:buildAuditorPrompt(snapshot, item, result, auditorId, binding.contextChars), workspace:this.config.workspace, model:binding.model,
      timeoutSeconds:binding.timeoutSeconds, maxOutputChars:binding.outputChars, permissionPosture:"host-controlled", readOnly:true, workItemId:item.id,
    });
    if (terminalStates.has((await this.repository.load()).state)) return { decision:null, status:"cancelled" };
    if (episode.status !== "done") return { decision:null, status:episode.status };
    const integrity = diffWorkspace(before, await this.safeWorkspaceSnapshot());
    let parsed: AuditDecision;
    try { parsed = parseAuditDecision(episode.visibleOutput, item, result.executor_id, auditorId); }
    catch (error) { if (!(error instanceof ContractError)) throw error; parsed = this.invalidAudit(item, result.executor_id, auditorId, error.message, integrity); }
    if (!integrity.clean) parsed = this.invalidAudit(item, result.executor_id, auditorId, "Auditor workspace integrity failed", integrity);
    return { decision:parsed, status:episode.status };
  }

  private async runEpisode(adapter: HostAdapter, request: EpisodeRequest): Promise<EpisodeResult> {
    const base: Record<string, unknown> = { episode_id:request.episodeId, role:request.role, host:adapter.host };
    if (request.workItemId !== undefined) base.work_item_id = request.workItemId;
    await this.repository.transition("episode.started", base);
    const result = await adapter.runEpisode(request);
    for (const event of result.events) await this.repository.recordBackendEvent(event);
    const traceRef = await this.repository.recordEpisodeTrace(request.episodeId, { episode_id:request.episodeId, host:result.host, role:result.role, status:result.status, duration_ms:result.durationMs, exit_code:result.exitCode, error:result.error, stdout:result.rawStdout, stderr:result.rawStderr, metadata:result.metadata });
    const terminalKind = { done:"episode.completed", error:"episode.failed", permission_required:"episode.failed", timeout:"episode.timeout", cancelled:"episode.cancelled" } as const;
    try { await this.repository.transition(terminalKind[result.status], { ...base, status:result.status, trace_ref:traceRef }); }
    catch (error) {
      const current = await this.repository.load();
      if (!terminalStates.has(current.state)) throw error;
    }
    return result;
  }

  private async reconcileAbandoned(): Promise<void> {
    const active = new Map<string, Record<string, unknown>>();
    for (const event of await this.repository.events()) {
      if (!event.kind.startsWith("episode.")) continue;
      const payload = decodeContract(episodeEventPayloadSchema, event.payload, "EpisodeEvent.payload");
      const id = payload.episode_id;
      if (event.kind === "episode.started") active.set(id, payload);
      else active.delete(id);
    }
    for (const payload of active.values()) await this.repository.transition("episode.abandoned", { ...payload, reason:"controller restarted before terminal episode event" });
  }

  private async resumeWave(episodeIds: string[]): Promise<void> {
    let snapshot = await this.repository.load();
    if (snapshot.state === "executing_wave") {
      if (Object.values(snapshot.work_items).some((item) => item.status === "running")) throw new ContractError("cannot reconcile running work item without episode.started event");
      const submitted = Object.values(snapshot.work_items).filter((item) => item.status === "submitted");
      if (submitted.length === 0) { await this.repository.transition("run.managing", {}); return; }
      await this.repository.transition("wave.audit_started", {});
      snapshot = await this.repository.load();
    }
    for (const item of Object.values(snapshot.work_items).filter((value) => value.status === "auditing")) {
      const result = await this.repository.loadRoleResult(item.id, item.attempt);
      const current = await this.repository.load();
      const audit = await this.auditItem(current, current.work_items[item.id]!, result, episodeIds);
      if (audit.decision === null) {
        await this.repository.transition("human.gate_requested", { gate_type:this.failureGate([audit.status]), role:"auditor", statuses:[audit.status] });
        return;
      }
      await this.repository.submitAudit(audit.decision);
    }
    const after = await this.repository.load();
    if (after.state === "auditing_wave") await this.repository.transition("run.managing", {});
    else if (after.state === "blocked") await this.repository.transition("human.gate_requested", { gate_type:"blocked" });
  }

  private async safeWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
    try { return await snapshotWorkspace(this.config.workspace); }
    catch (error) { return { root:this.config.workspace, entries:{}, errors:[`workspace snapshot failed: ${String(error)}`] }; }
  }

  private failureGate(statuses: string[]): string {
    if (statuses.includes("permission_required")) return "permission";
    if (statuses.length > 0 && statuses.every((status) => status === "cancelled")) return "cancellation";
    return "repeated_failure";
  }

  private episodeId(snapshot: RunSnapshot, role: EpisodeRole, itemId?: string): string {
    const round = Math.max(1, snapshot.rounds_used + (role === "manager" ? 1 : 0));
    return `r${round}-${role}${itemId === undefined ? "" : `-${itemId}`}-${randomUUID().slice(0, 8)}`;
  }

  private failedResult(item: WorkItem, executorId: string, failure: string): RoleResult {
    return decodeContract(roleResultSchema, { schema_version:SCHEMA_VERSION, work_item_id:item.id, attempt:item.attempt, executor_id:executorId, summary:"Executor episode failed", artifacts:[], evidence:[], checks:[], risks:["unverified episode failure"], failure }, "RoleResult");
  }

  private invalidAudit(item: WorkItem, executorId: string, auditorId: string, finding: string, integrity: WorkspaceDiff): AuditDecision {
    const findings = [finding];
    if (!integrity.clean) findings.push(`workspace diff: added=${JSON.stringify(integrity.added)}, deleted=${JSON.stringify(integrity.deleted)}, changed=${JSON.stringify(integrity.changed)}, type_changed=${JSON.stringify(integrity.typeChanged)}, errors=${JSON.stringify(integrity.errors)}`);
    return decodeContract(auditDecisionSchema, { schema_version:SCHEMA_VERSION, work_item_id:item.id, attempt:item.attempt, auditor_id:auditorId, executor_id:executorId, status:"invalid", integrity:integrity.clean ? "clean" : "dirty", contract_alignment:"misaligned", evidence:[], findings, required_rework:["Run a valid independent audit"] }, "AuditDecision");
  }
}

async function mapLimit<T, R>(values: T[], limit: number, action: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < values.length) {
      const index = next; next += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await action(value);
    }
  };
  await Promise.all(Array.from({ length:Math.min(limit, values.length) }, worker));
  return results;
}
