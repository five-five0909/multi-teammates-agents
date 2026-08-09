import { resolve } from "node:path";

import { TaskRepository } from "./task-repository.js";
import { decodeContract, taskContractSchema, workItemSchema } from "../runtime/core/contracts.js";
import { RuntimeRepository } from "../runtime/supervisor/runtime-repository.js";
import { TrellisRunStore } from "../runtime/storage/trellis-run-store.js";

export class BoundRunService {
  private constructor(
    public readonly taskId: string,
    public readonly repository: TaskRepository,
    public readonly store: TrellisRunStore,
  ) {}

  public static async open(project: string, sessionId?: string, developer = "cli"): Promise<BoundRunService> {
    const repository = await TaskRepository.open(project);
    const binding = await repository.resolveBinding(sessionId);
    const store = new TrellisRunStore({ repoRoot:repository.projectRoot, taskDir:resolve(repository.projectRoot, binding.pointer.task_path), developer });
    return new BoundRunService(binding.task.id, repository, store);
  }

  public assertTask(taskId: unknown): string {
    if (typeof taskId !== "string" || taskId !== this.taskId) throw new Error("workspace_unbound: task_id does not match the active session binding");
    return taskId;
  }

  public runtime(runId: unknown): RuntimeRepository {
    if (typeof runId !== "string" || runId.length === 0) throw new Error("run_id is required");
    return new RuntimeRepository(this.store, runId);
  }

  public start(runId: string, contractInput: unknown, workItemInputs: unknown, options: { maxRounds?: number; retryLimit?: number } = {}): Promise<unknown> {
    const contract = decodeContract(taskContractSchema, contractInput, "TaskContract");
    if (!Array.isArray(workItemInputs)) throw new Error("work_items must be an array");
    const workItems = workItemInputs.map((item) => decodeContract(workItemSchema, item, "WorkItem"));
    return this.store.create(runId, contract, workItems, options);
  }

  public async resume(runId: string): Promise<Record<string, unknown>> {
    const snapshot = await this.runtime(runId).load();
    return { task_id:this.taskId, run_id:snapshot.run_id, state:snapshot.state, version:snapshot.version, pending_gate:snapshot.pending_gate, verified_progress:snapshot.verified_progress, work_items:Object.fromEntries(Object.entries(snapshot.work_items).map(([id, item]) => [id, { status:item.status, attempt:item.attempt }])) };
  }
}
