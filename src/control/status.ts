import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { decodeApplyReceipt, type ApplyHost } from "./apply-contract.js";
import { sha256 } from "./digest.js";
import { runDoctor, type DoctorReport } from "./doctor.js";
import { findGitRoot } from "./project-root.js";
import { TaskRepository } from "../lifecycle/task-repository.js";
import { PACKAGE_VERSION } from "../version.js";

export interface ProjectStatus {
  readonly packageVersion: string;
  readonly projectRoot: string;
  readonly applied: boolean;
  readonly receiptPath: string;
  readonly receiptValid: boolean | null;
  readonly hosts: readonly ApplyHost[];
  readonly ownedPaths: readonly string[];
  readonly driftedPaths: readonly string[];
  readonly ownershipValid: boolean;
  readonly integrations: Readonly<Record<ApplyHost, { installed: boolean; trusted: boolean | null; enforced: boolean }>>;
}

export interface TrellisStatus {
  readonly bound: boolean;
  readonly sessionId: string | null;
  readonly taskId: string | null;
  readonly taskPath: string | null;
  readonly taskStatus: "planning" | "in_progress" | "completed" | null;
  readonly error: string | null;
}

export interface ControlStatus extends ProjectStatus {
  readonly trellis: TrellisStatus;
  readonly diagnostics: DoctorReport;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readProjectStatus(startPath: string): Promise<ProjectStatus> {
  const projectRoot = await findGitRoot(startPath);
  const receiptPath = resolve(projectRoot, ".mta", "apply-receipt.json");
  const applied = await exists(receiptPath);
  let receiptValid: boolean | null = null;
  let hosts: readonly ApplyHost[] = [];
  let ownedPaths: readonly string[] = [];
  const driftedPaths: string[] = [];
  const integrations: Record<ApplyHost, { installed: boolean; trusted: boolean | null; enforced: boolean }> = {
    codex:{ installed:false, trusted:null, enforced:false },
    claude:{ installed:false, trusted:null, enforced:false },
  };

  if (applied) {
    try {
      const value: unknown = JSON.parse(await readFile(receiptPath, "utf8"));
      const receipt = decodeApplyReceipt(value);
      receiptValid = receipt.projectRoot === projectRoot;
      hosts = receipt.hosts;
      ownedPaths = receipt.files.map((file) => file.relativePath);
      for (const file of receipt.files) {
        try {
          const bytes = await readFile(resolve(projectRoot, file.relativePath));
          if (sha256(bytes) !== file.appliedHash) driftedPaths.push(file.relativePath);
        } catch {
          driftedPaths.push(file.relativePath);
        }
      }
      const installedPaths: Record<ApplyHost, string> = { codex:".codex/hooks.json", claude:".claude/settings.json" };
      for (const host of receipt.hosts) integrations[host].installed = receipt.files.some((file) => file.relativePath === installedPaths[host]);
      for (const entry of await readdir(resolve(projectRoot, ".mta", "sessions"), { withFileTypes:true }).catch(() => [])) {
        if (!entry.isFile() || !entry.name.endsWith(".events.jsonl")) continue;
        const lines = (await readFile(resolve(projectRoot, ".mta", "sessions", entry.name), "utf8")).split(/\r?\n/u);
        for (const line of lines) {
          if (line.length === 0) continue;
          try {
            const event = JSON.parse(line) as { host?: unknown; enforcement?: unknown; event?: unknown };
            if ((event.host === "codex" || event.host === "claude") && event.enforcement === "enforced") {
              integrations[event.host].trusted = true;
              if (event.event === "PreToolUse") integrations[event.host].enforced = true;
            }
          } catch { /* A malformed evidence line cannot prove trust. */ }
        }
      }
    } catch {
      receiptValid = false;
    }
  }

  const ownershipValid = applied && receiptValid === true && driftedPaths.length === 0;
  return { packageVersion: PACKAGE_VERSION, projectRoot, applied, receiptPath, receiptValid, hosts, ownedPaths, driftedPaths, ownershipValid, integrations };
}

export async function readControlStatus(startPath: string, sessionId?: string): Promise<ControlStatus> {
  const project = await readProjectStatus(startPath);
  const [diagnostics, trellis] = await Promise.all([
    runDoctor(project.projectRoot),
    readTrellisStatus(project.projectRoot, sessionId),
  ]);
  return { ...project, trellis, diagnostics };
}

async function readTrellisStatus(projectRoot: string, sessionId?: string): Promise<TrellisStatus> {
  try {
    const repository = await TaskRepository.open(projectRoot);
    const binding = await repository.resolveBinding(sessionId);
    return {
      bound:true,
      sessionId:binding.pointer.session_id,
      taskId:binding.task.id,
      taskPath:binding.pointer.task_path,
      taskStatus:binding.task.status,
      error:null,
    };
  } catch (error) {
    return {
      bound:false,
      sessionId:sessionId ?? null,
      taskId:null,
      taskPath:null,
      taskStatus:null,
      error:error instanceof Error ? error.message : String(error),
    };
  }
}
