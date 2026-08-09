import { randomUUID } from "node:crypto";
import { relative } from "node:path";

import {
  auditDecisionSchema,
  backendEventSchema,
  ContractError,
  decodeContract,
  humanDecisionSchema,
  roleResultSchema,
  runEventSchema,
  SCHEMA_VERSION,
  type AuditDecision,
  type BackendEvent,
  type HumanDecision,
  type RoleResult,
  type RunEvent,
  type RunSnapshot,
} from "../core/contracts.js";
import { redactValue } from "../security.js";
import type { TrellisRunStore } from "../storage/trellis-run-store.js";

export class RuntimeRepository {
  private mutationTail: Promise<void> = Promise.resolve();

  public constructor(public readonly store: TrellisRunStore, public readonly runId: string) {}

  public load(): Promise<RunSnapshot> { return this.store.load(this.runId); }
  public events(): Promise<RunEvent[]> { return this.store.readEvents(this.runId); }
  public async loadRoleResult(workItemId: string, attempt: number): Promise<RoleResult> {
    try {
      return await this.store.loadRoleResult(this.runId, workItemId, attempt);
    } catch (error) {
      if (!(error instanceof ContractError)) throw error;
      const events = await this.events();
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.kind !== "executor.result_submitted") continue;
        const result = decodeContract(roleResultSchema, event.payload, "RoleResult");
        if (result.work_item_id === workItemId && result.attempt === attempt) {
          await this.store.recordRoleResult(this.runId, result);
          return result;
        }
      }
      throw error;
    }
  }

  public transition(kind: string, payload: Record<string, unknown>, owner = "supervisor"): Promise<RunSnapshot> {
    const operation = this.mutationTail.then(
      () => this.transitionNow(kind, payload, owner),
      () => this.transitionNow(kind, payload, owner),
    );
    this.mutationTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async transitionNow(kind: string, payload: Record<string, unknown>, owner: string): Promise<RunSnapshot> {
    const current = await this.load();
    const event = decodeContract(runEventSchema, {
      schema_version: SCHEMA_VERSION,
      id: randomUUID(),
      run_id: this.runId,
      seq: current.last_seq + 1,
      expected_version: current.version,
      kind,
      timestamp: new Date().toISOString(),
      payload: redactValue(payload),
    }, "RunEvent");
    return this.store.append(event, { owner });
  }

  public async submitResult(input: RoleResult): Promise<RunSnapshot> {
    const result = decodeContract(roleResultSchema, redactValue(input), "RoleResult");
    const updated = await this.transition("executor.result_submitted", result, "supervisor-result");
    await this.store.recordRoleResult(this.runId, result);
    return updated;
  }

  public async submitAudit(input: AuditDecision): Promise<RunSnapshot> {
    const audit = decodeContract(auditDecisionSchema, redactValue(input), "AuditDecision");
    const updated = await this.transition("audit.recorded", audit, "supervisor-audit");
    await this.store.recordAudit(this.runId, audit);
    return updated;
  }

  public async answer(input: HumanDecision): Promise<RunSnapshot> {
    const decision = decodeContract(humanDecisionSchema, redactValue(input), "HumanDecision");
    if (decision.provenance == null) {
      if (decision.actor !== "configured-policy") throw new ContractError("human gate requires attributable provenance; actor=user alone is not proof");
    } else {
      if (decision.provenance.gate_type !== decision.gate_type) throw new ContractError("human decision provenance gate_type does not match decision");
      if (decision.actor === "user" && decision.provenance.verification !== "verified") throw new ContractError("user human gate requires verified provenance");
      if (decision.actor !== decision.provenance.actor && !(decision.actor === "configured-policy" && decision.provenance.actor === "policy")) {
        throw new ContractError("human decision actor does not match provenance");
      }
    }
    const updated = await this.transition("human.decision_recorded", {
      decision: decision.decision,
      gate_type: decision.gate_type,
      actor: decision.actor,
      instruction: decision.instruction,
      provenance: decision.provenance,
    }, "supervisor-answer");
    await this.store.recordHumanDecision(this.runId, decision);
    return updated;
  }

  public recordBackendEvent(input: BackendEvent): Promise<void> {
    return this.store.recordBackendEvent(this.runId, decodeContract(backendEventSchema, redactValue(input), "BackendEvent"));
  }

  public async recordEpisodeTrace(episodeId: string, value: Record<string, unknown>): Promise<string> {
    const path = await this.store.recordEpisodeTrace(this.runId, episodeId, value);
    return relative(this.store.repoRoot, path).replaceAll("\\", "/");
  }
}
