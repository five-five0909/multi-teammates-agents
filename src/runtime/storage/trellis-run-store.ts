import { randomUUID } from "node:crypto";
import { open, mkdir, readFile, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { writeFileAtomic } from "../../platform/atomic-file.js";
import { decodeEvents, encodeEvent } from "../core/codec.js";
import {
  auditDecisionSchema,
  backendEventSchema,
  ContractError,
  decodeContract,
  humanDecisionSchema,
  roleResultSchema,
  runSnapshotSchema,
  taskContractSchema,
  workItemSchema,
  type AuditDecision,
  type BackendEvent,
  type HumanDecision,
  type RoleResult,
  type RunEvent,
  type RunSnapshot,
  type TaskContract,
  type WorkItem,
} from "../core/contracts.js";
import { applyEvent, createSnapshot, replay } from "../core/reducer.js";
import { redactValue } from "../security.js";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

export class LeaseConflict extends ContractError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LeaseConflict";
  }
}

function isInside(path: string, parent: string): boolean {
  const value = relative(parent, path);
  return value.length > 0 && !value.startsWith("..") && !isAbsolute(value);
}

function assertSafeId(value: string, label: string): void {
  if (!safeId.test(value)) throw new ContractError(`${label} contains unsafe path characters`);
}

async function readJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new ContractError(`missing run file: ${path}`, { cause: error });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ContractError(`invalid JSON in ${path}`, { cause: error });
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, randomUUID());
}

async function appendDurable(path: string, line: string): Promise<void> {
  const handle = await open(path, "a", 0o600);
  try {
    await handle.writeFile(line);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function jsonlLines(text: string): string[] {
  if (text.length === 0) return [];
  const withoutFinalNewline = text.endsWith("\r\n") ? text.slice(0, -2) : text.endsWith("\n") ? text.slice(0, -1) : text;
  return withoutFinalNewline.split(/\r?\n/u);
}

export interface TrellisRunStoreOptions {
  repoRoot: string;
  taskDir: string;
  developer: string;
}

export class TrellisRunStore {
  public readonly repoRoot: string;
  public readonly taskDir: string;
  public readonly developer: string;

  public constructor(options: TrellisRunStoreOptions) {
    this.repoRoot = resolve(options.repoRoot);
    this.taskDir = resolve(options.taskDir);
    this.developer = options.developer;
    const tasksRoot = resolve(this.repoRoot, ".trellis", "tasks");
    if (!isInside(this.taskDir, tasksRoot)) throw new ContractError("taskDir must identify one task under .trellis/tasks");
    assertSafeId(this.developer, "developer");
  }

  public runDir(runId: string): string {
    assertSafeId(runId, "run_id");
    const root = resolve(this.taskDir, "mta-runs");
    const path = resolve(root, runId);
    if (!isInside(path, root)) throw new ContractError("run path escapes task mta-runs directory");
    return path;
  }

  public traceDir(runId: string): string {
    this.runDir(runId);
    return resolve(this.repoRoot, ".trellis", "workspace", this.developer, "traces", runId);
  }

  public async create(
    runId: string,
    contractInput: TaskContract,
    workItemInputs: WorkItem[],
    options: { maxRounds?: number; retryLimit?: number } = {},
  ): Promise<RunSnapshot> {
    const contract = decodeContract(taskContractSchema, contractInput, "TaskContract");
    const workItems = workItemInputs.map((item) => decodeContract(workItemSchema, item, "WorkItem"));
    const directory = this.runDir(runId);
    await mkdir(resolve(this.taskDir, "mta-runs"), { recursive: true });
    await mkdir(directory);
    const snapshot = createSnapshot(runId, contract, workItems, options);
    await atomicJson(resolve(directory, "contract.json"), contract);
    await atomicJson(resolve(directory, "initial.json"), snapshot);
    await atomicJson(resolve(directory, "state.json"), snapshot);
    for (const name of ["events.jsonl", "rounds.jsonl", "decisions.jsonl"]) {
      const handle = await open(resolve(directory, name), "wx", 0o600);
      await handle.close();
    }
    await mkdir(resolve(directory, "work-items"));
    await mkdir(resolve(directory, "audits"));
    return snapshot;
  }

  public async load(runId: string, options: { repairStaleSnapshot?: boolean } = {}): Promise<RunSnapshot> {
    const directory = this.runDir(runId);
    const initial = decodeContract(runSnapshotSchema, await readJson(resolve(directory, "initial.json")), "RunSnapshot");
    if (initial.run_id !== runId) throw new ContractError("initial snapshot run_id mismatch");
    const events = decodeEvents(jsonlLines(await readFile(resolve(directory, "events.jsonl"), "utf8")));
    const reconstructed = replay(initial, events);
    const persisted = decodeContract(runSnapshotSchema, await readJson(resolve(directory, "state.json")), "RunSnapshot");
    if (persisted.run_id !== runId) throw new ContractError("state snapshot run_id mismatch");
    if (persisted.version > reconstructed.version) throw new ContractError("state snapshot is ahead of the authoritative event log");
    if (!isDeepStrictEqual(persisted, reconstructed)) {
      if (options.repairStaleSnapshot === false) throw new ContractError("state snapshot does not match event replay");
      await atomicJson(resolve(directory, "state.json"), reconstructed);
    }
    return reconstructed;
  }

  public async append(event: RunEvent, options: { owner: string; leaseSeconds?: number }): Promise<RunSnapshot> {
    return this.withLease(event.run_id, options.owner, options.leaseSeconds ?? 30, async () => {
      const current = await this.load(event.run_id);
      const updated = applyEvent(current, event);
      if (updated === current) return current;
      const directory = this.runDir(event.run_id);
      await appendDurable(resolve(directory, "events.jsonl"), `${encodeEvent(event)}\n`);
      await atomicJson(resolve(directory, "state.json"), updated);
      return updated;
    });
  }

  public async readEvents(runId: string): Promise<RunEvent[]> {
    return decodeEvents(jsonlLines(await readFile(resolve(this.runDir(runId), "events.jsonl"), "utf8")));
  }

  public async recordRoleResult(runId: string, input: RoleResult): Promise<void> {
    const result = decodeContract(roleResultSchema, input, "RoleResult");
    const snapshot = await this.load(runId);
    if (!(result.work_item_id in snapshot.work_items)) throw new ContractError(`unknown work item: ${result.work_item_id}`);
    const directory = await this.recordDirectory(runId, "work-items", result.work_item_id);
    await atomicJson(resolve(directory, `attempt-${result.attempt}.json`), redactValue(result));
  }

  public async loadRoleResult(runId: string, workItemId: string, attempt: number): Promise<RoleResult> {
    const directory = await this.recordDirectory(runId, "work-items", workItemId);
    return decodeContract(roleResultSchema, await readJson(resolve(directory, `attempt-${attempt}.json`)), "RoleResult");
  }

  public async recordAudit(runId: string, input: AuditDecision): Promise<void> {
    const audit = decodeContract(auditDecisionSchema, input, "AuditDecision");
    const snapshot = await this.load(runId);
    if (!(audit.work_item_id in snapshot.work_items)) throw new ContractError(`unknown work item: ${audit.work_item_id}`);
    const directory = await this.recordDirectory(runId, "audits", audit.work_item_id);
    await atomicJson(resolve(directory, `attempt-${audit.attempt}.json`), redactValue(audit));
  }

  public async recordHumanDecision(runId: string, input: HumanDecision): Promise<void> {
    const decision = decodeContract(humanDecisionSchema, input, "HumanDecision");
    await appendDurable(resolve(this.runDir(runId), "decisions.jsonl"), `${JSON.stringify(redactValue(decision))}\n`);
  }

  public async recordRound(runId: string, value: Record<string, unknown>): Promise<void> {
    await this.load(runId);
    await appendDurable(resolve(this.runDir(runId), "rounds.jsonl"), `${JSON.stringify(redactValue(value))}\n`);
  }

  public async recordBackendEvent(runId: string, input: BackendEvent): Promise<void> {
    const event = decodeContract(backendEventSchema, input, "BackendEvent");
    await this.load(runId);
    const directory = this.traceDir(runId);
    await mkdir(directory, { recursive: true });
    await appendDurable(resolve(directory, "backend-events.jsonl"), `${JSON.stringify(redactValue(event))}\n`);
  }

  public async recordEpisodeTrace(runId: string, episodeId: string, value: Record<string, unknown>): Promise<string> {
    await this.load(runId);
    assertSafeId(episodeId, "episode_id");
    const directory = resolve(this.traceDir(runId), "episodes");
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, `${episodeId}.json`);
    await atomicJson(path, redactValue(value));
    return path;
  }

  public async writeFinalReport(runId: string, report: string): Promise<void> {
    const snapshot = await this.load(runId);
    if (snapshot.state !== "completed") throw new ContractError("final report requires a completed run");
    if (report.trim().length === 0) throw new ContractError("final report must not be empty");
    await writeFileAtomic(resolve(this.runDir(runId), "final-report.md"), `${String(redactValue(report)).trimEnd()}\n`, randomUUID());
  }

  public async withLease<T>(runId: string, owner: string, leaseSeconds: number, action: () => Promise<T>): Promise<T> {
    assertSafeId(owner, "lease owner");
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1) throw new ContractError("lease_seconds must be positive");
    const path = resolve(this.runDir(runId), ".lease.json");
    const expiresAt = new Date(Date.now() + leaseSeconds * 1000).toISOString();
    while (true) {
      try {
        const handle = await open(path, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify({ owner, expires_at: expiresAt })}\n`);
        await handle.sync();
        await handle.close();
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readJson(path);
        if (typeof existing !== "object" || existing === null || !("expires_at" in existing) || typeof existing.expires_at !== "string") {
          throw new LeaseConflict("run lease is malformed");
        }
        const expiry = Date.parse(existing.expires_at);
        if (!Number.isFinite(expiry)) throw new LeaseConflict("run lease expiry is malformed");
        if (expiry > Date.now()) {
          const heldBy = "owner" in existing && typeof existing.owner === "string" ? existing.owner : "unknown";
          throw new LeaseConflict(`run lease is held by ${heldBy}`);
        }
        await rm(path, { force: true });
      }
    }
    try {
      return await action();
    } finally {
      const current = await readJson(path).catch(() => undefined);
      if (typeof current === "object" && current !== null && "owner" in current && current.owner === owner) {
        await rm(path, { force: true });
      }
    }
  }

  private async recordDirectory(runId: string, category: "work-items" | "audits", workItemId: string): Promise<string> {
    assertSafeId(workItemId, "work_item_id");
    const root = resolve(this.runDir(runId), category);
    const directory = resolve(root, workItemId);
    if (!isInside(directory, root)) throw new ContractError("record path escapes run directory");
    await mkdir(directory, { recursive: true });
    return directory;
  }
}
