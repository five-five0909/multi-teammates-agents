import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../platform/atomic-file.js";
import { findGitRoot } from "../control/project-root.js";

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const nonEmpty = z.string().refine((value) => value.trim().length > 0);
const taskSchema = z.looseObject({
  id: nonEmpty,
  name: nonEmpty,
  title: nonEmpty,
  status: z.enum(["planning", "in_progress", "completed"]),
  createdAt: nonEmpty.optional(),
  completedAt: nonEmpty.nullish(),
});
const pointerSchema = z.strictObject({
  schema_version: z.literal(1),
  session_id: nonEmpty,
  project_root: nonEmpty,
  task_path: nonEmpty,
  host: z.enum(["codex", "claude", "cli"]),
  updated_at: nonEmpty,
});

export type TrellisTask = z.infer<typeof taskSchema>;
export type SessionPointer = z.infer<typeof pointerSchema>;

export class LifecycleError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LifecycleError";
  }
}

function isInside(path: string, parent: string): boolean {
  const value = relative(parent, path);
  return value.length > 0 && !value.startsWith("..") && !isAbsolute(value);
}

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new LifecycleError(`${label} is invalid: ${result.error.issues[0]?.message ?? "unknown field"}`);
  return result.data;
}

async function readJson(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, "utf8")) as unknown; }
  catch (error) { throw new LifecycleError(`cannot read ${path}`, { cause:error }); }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, randomUUID());
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  return slug || "task";
}

function taskTemplate(id: string, title: string, parent: string | null): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id, name:id, title, description:"", status:"planning", dev_type:null, scope:null, package:null,
    priority:"P2", creator:"mta", assignee:"mta", createdAt:today, completedAt:null,
    branch:null, base_branch:"main", worktree_path:null, commit:null, pr_url:null,
    subtasks:[], children:[], parent, relatedFiles:[], notes:"", meta:{},
  };
}

export class TaskRepository {
  public readonly projectRoot: string;
  public readonly tasksRoot: string;
  private readonly sessionsRoot: string;

  private constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.tasksRoot = resolve(projectRoot, ".trellis", "tasks");
    this.sessionsRoot = resolve(projectRoot, ".mta", "sessions");
  }

  public static async open(startPath: string): Promise<TaskRepository> {
    return new TaskRepository(await findGitRoot(startPath));
  }

  public async create(title: string, options: { slug?: string; parent?: string | null } = {}): Promise<{ path: string; task: TrellisTask }> {
    if (title.trim().length === 0) throw new LifecycleError("task title must not be empty");
    const id = options.slug ?? slugify(title);
    if (!safeId.test(id)) throw new LifecycleError("task slug contains unsafe path characters");
    const now = new Date();
    const directoryName = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${id}`;
    const directory = resolve(this.tasksRoot, directoryName);
    if (!isInside(directory, this.tasksRoot)) throw new LifecycleError("task path escapes .trellis/tasks");
    await mkdir(this.tasksRoot, { recursive:true });
    await mkdir(directory);
    const raw = taskTemplate(id, title, options.parent ?? null);
    await writeJson(resolve(directory, "task.json"), raw);
    await writeFileAtomic(resolve(directory, "prd.md"), `# ${title}\n\n## Goal\n\nTBD.\n`, randomUUID());
    await writeFileAtomic(resolve(directory, "design.md"), `# Design: ${title}\n\nTBD.\n`, randomUUID());
    await writeFileAtomic(resolve(directory, "implement.md"), `# Implementation Plan: ${title}\n\n- [ ] TBD\n`, randomUUID());
    await writeFileAtomic(resolve(directory, "check.jsonl"), "", randomUUID());
    await writeFileAtomic(resolve(directory, "implement.jsonl"), "", randomUUID());
    return { path:this.relativeTaskPath(directory), task:parse(taskSchema, raw, "task.json") };
  }

  public async start(reference: string, sessionId: string, host: SessionPointer["host"] = "cli"): Promise<SessionPointer> {
    const { directory, task, raw } = await this.resolveTask(reference);
    if (task.status === "completed") throw new LifecycleError("completed task cannot be started");
    await this.assertPlanningArtifacts(directory);
    const pointer = parse(pointerSchema, {
      schema_version:1, session_id:this.validateSessionId(sessionId), project_root:this.projectRoot,
      task_path:this.relativeTaskPath(directory), host, updated_at:new Date().toISOString(),
    }, "SessionPointer");
    await mkdir(this.sessionsRoot, { recursive:true });
    await writeJson(this.pointerPath(sessionId), pointer);
    if (task.status === "planning") await writeJson(resolve(directory, "task.json"), { ...raw, status:"in_progress" });
    return pointer;
  }

  public async current(sessionId: string): Promise<{ pointer: SessionPointer; task: TrellisTask } | null> {
    const path = this.pointerPath(sessionId);
    let raw: unknown;
    try { raw = await readJson(path); }
    catch { return null; }
    const pointer = parse(pointerSchema, raw, "SessionPointer");
    if (resolve(pointer.project_root) !== this.projectRoot) throw new LifecycleError("session pointer belongs to another workspace");
    const directory = resolve(this.projectRoot, pointer.task_path);
    if (!isInside(directory, this.tasksRoot)) throw new LifecycleError("session pointer task path escapes .trellis/tasks");
    const task = parse(taskSchema, await readJson(resolve(directory, "task.json")), "task.json");
    return { pointer, task };
  }

  public async requireActive(sessionId: string): Promise<{ pointer: SessionPointer; task: TrellisTask }> {
    const current = await this.current(sessionId);
    if (current === null) throw new LifecycleError("no active task is bound to this session");
    if (current.task.status !== "in_progress") throw new LifecycleError(`active task is ${current.task.status}; implementation requires in_progress`);
    return current;
  }

  public async resolveBinding(sessionId?: string): Promise<{ pointer: SessionPointer; task: TrellisTask }> {
    if (sessionId !== undefined) {
      const current = await this.current(sessionId);
      if (current === null) throw new LifecycleError("workspace_unbound: session has no active task binding");
      return current;
    }
    const bindings: Array<{ pointer: SessionPointer; task: TrellisTask }> = [];
    for (const entry of await readdir(this.sessionsRoot, { withFileTypes:true }).catch(() => [])) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const current = await this.current(entry.name.slice(0, -5));
      if (current !== null && current.task.status === "in_progress") bindings.push(current);
    }
    if (bindings.length !== 1) throw new LifecycleError(`workspace_unbound: expected exactly one active session binding, found ${bindings.length}`);
    return bindings[0]!;
  }

  public async finish(sessionId: string): Promise<boolean> {
    const path = this.pointerPath(sessionId);
    try { await rm(path); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  public async archive(reference: string, sessionId?: string): Promise<string> {
    const { directory, raw } = await this.resolveTask(reference);
    const month = new Date().toISOString().slice(0, 7);
    const archiveRoot = resolve(this.tasksRoot, "archive", month);
    const target = resolve(archiveRoot, directory.split(/[\\/]/u).at(-1)!);
    if (!isInside(target, archiveRoot)) throw new LifecycleError("archive target escapes archive month");
    await writeJson(resolve(directory, "task.json"), { ...raw, status:"completed", completedAt:new Date().toISOString().slice(0, 10) });
    await mkdir(archiveRoot, { recursive:true });
    await rename(directory, target);
    if (sessionId !== undefined) await this.finish(sessionId);
    return relative(this.projectRoot, target).replaceAll("\\", "/");
  }

  private async resolveTask(reference: string): Promise<{ directory: string; task: TrellisTask; raw: Record<string, unknown> }> {
    if (reference.trim().length === 0 || reference.includes("..")) throw new LifecycleError("task reference is unsafe");
    const direct = resolve(this.projectRoot, reference);
    const candidates: string[] = [];
    if (isInside(direct, this.tasksRoot)) candidates.push(direct);
    for (const entry of await readdir(this.tasksRoot, { withFileTypes:true }).catch(() => [])) {
      if (!entry.isDirectory() || entry.name === "archive") continue;
      const directory = resolve(this.tasksRoot, entry.name);
      if (entry.name === reference || entry.name.endsWith(`-${reference}`)) candidates.push(directory);
      else {
        try {
          const value = parse(taskSchema, await readJson(resolve(directory, "task.json")), "task.json");
          if (value.id === reference || value.name === reference) candidates.push(directory);
        } catch { /* Ignore unrelated malformed tasks until explicitly selected. */ }
      }
    }
    const unique = [...new Set(candidates)];
    if (unique.length !== 1) throw new LifecycleError(unique.length === 0 ? `task not found: ${reference}` : `task reference is ambiguous: ${reference}`);
    const directory = unique[0]!;
    if (!isInside(directory, this.tasksRoot)) throw new LifecycleError("task path escapes .trellis/tasks");
    const unknown = await readJson(resolve(directory, "task.json"));
    if (typeof unknown !== "object" || unknown === null || Array.isArray(unknown)) throw new LifecycleError("task.json must be an object");
    return { directory, task:parse(taskSchema, unknown, "task.json"), raw:unknown as Record<string, unknown> };
  }

  private async assertPlanningArtifacts(directory: string): Promise<void> {
    for (const name of ["prd.md", "design.md", "implement.md"]) {
      let content: string;
      try { content = await readFile(resolve(directory, name), "utf8"); }
      catch (error) { throw new LifecycleError(`${name} is required before task start`, { cause:error }); }
      if (/\bTBD\b|\[ \]\s*TBD/iu.test(content) || content.trim().length < 40) throw new LifecycleError(`${name} still contains placeholder content`);
    }
  }

  private relativeTaskPath(directory: string): string { return relative(this.projectRoot, directory).replaceAll("\\", "/"); }
  private validateSessionId(sessionId: string): string {
    if (!safeId.test(sessionId)) throw new LifecycleError("session_id contains unsafe path characters");
    return sessionId;
  }
  private pointerPath(sessionId: string): string { return resolve(this.sessionsRoot, `${this.validateSessionId(sessionId)}.json`); }
}
