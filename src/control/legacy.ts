import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { sha256 } from "./digest.js";
import { findGitRoot } from "./project-root.js";
import { writeFileAtomic } from "../platform/atomic-file.js";

const CANDIDATES = [".codex/hooks.json", ".claude/settings.json", ".mcp.json"] as const;
const LEGACY_COMMAND = /(?=.*(?:expert[_-]team|inject-workflow-state))(?=.*(?:python|\.py\b|expert_team_mcp_launcher))/iu;

interface LegacyFilePlan {
  readonly relativePath: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly content: string;
  readonly removedEntries: number;
}

export interface LegacyPlan {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly projectRoot: string;
  readonly files: readonly LegacyFilePlan[];
  readonly removedEntries: number;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function detachHooks(root: Record<string, unknown>): number {
  const hooks = object(root.hooks);
  if (hooks === null) return 0;
  let removed = 0;
  for (const [event, rawGroups] of Object.entries(hooks)) {
    if (!Array.isArray(rawGroups)) continue;
    const groups: unknown[] = [];
    for (const rawGroup of rawGroups) {
      const group = object(rawGroup);
      if (group === null || !Array.isArray(group.hooks)) {
        groups.push(rawGroup);
        continue;
      }
      const handlers = group.hooks.filter((rawHandler) => {
        const handler = object(rawHandler);
        const command = handler === null ? null : handler.command;
        const legacy = typeof command === "string" && LEGACY_COMMAND.test(command);
        if (legacy) removed += 1;
        return !legacy;
      });
      if (handlers.length > 0) groups.push({ ...group, hooks: handlers });
    }
    if (groups.length > 0) hooks[event] = groups;
    else delete hooks[event];
  }
  return removed;
}

function detachMcp(root: Record<string, unknown>): number {
  const servers = object(root.mcpServers);
  if (servers === null) return 0;
  let removed = 0;
  for (const [name, server] of Object.entries(servers)) {
    const serialized = JSON.stringify(server);
    if ((/^expert[_-]team$/iu.test(name) || /expert[_-]team/iu.test(serialized))
      && /expert_team_mcp_launcher|\.py\b|python/iu.test(serialized)) {
      delete servers[name];
      removed += 1;
    }
  }
  return removed;
}

async function readOptional(path: string): Promise<Buffer | null> {
  try { return await readFile(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function planLegacyDetach(startPath: string): Promise<LegacyPlan> {
  const projectRoot = await findGitRoot(startPath);
  const files: LegacyFilePlan[] = [];
  for (const relativePath of CANDIDATES) {
    const bytes = await readOptional(resolve(projectRoot, relativePath));
    if (bytes === null) continue;
    let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); }
    catch { continue; }
    const root = object(value);
    if (root === null) continue;
    const removedEntries = detachHooks(root) + detachMcp(root);
    if (removedEntries === 0) continue;
    const content = `${JSON.stringify(root, null, 2)}\n`;
    files.push({ relativePath, beforeHash:sha256(bytes), afterHash:sha256(content), content, removedEntries });
  }
  return { schemaVersion:1, transactionId:randomUUID(), projectRoot, files, removedEntries:files.reduce((total, file) => total + file.removedEntries, 0) };
}

export async function commitLegacyDetach(plan: LegacyPlan, options: { failAfterWrites?: number } = {}): Promise<LegacyPlan> {
  const originals = new Map<string, Buffer>();
  for (const file of plan.files) {
    const path = resolve(plan.projectRoot, file.relativePath);
    const current = await readOptional(path);
    if (current === null || sha256(current) !== file.beforeHash) throw new Error(`${file.relativePath} changed after legacy detach planning`);
    originals.set(path, current);
  }
  const written: string[] = [];
  try {
    for (const file of plan.files) {
      const path = resolve(plan.projectRoot, file.relativePath);
      await mkdir(dirname(path), { recursive:true });
      await writeFileAtomic(path, file.content, plan.transactionId);
      written.push(path);
      if (options.failAfterWrites !== undefined && written.length >= options.failAfterWrites) throw new Error("injected legacy detach failure");
    }
    const receipt = {
      schemaVersion:1, transactionId:plan.transactionId, projectRoot:plan.projectRoot,
      detachedAt:new Date().toISOString(),
      files:plan.files.map(({ relativePath, beforeHash, afterHash, removedEntries }) => ({ relativePath, beforeHash, afterHash, removedEntries })),
    };
    await mkdir(resolve(plan.projectRoot, ".mta"), { recursive:true });
    await writeFileAtomic(resolve(plan.projectRoot, ".mta", "legacy-detach-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, plan.transactionId);
    return plan;
  } catch (error) {
    for (const path of written.reverse()) {
      const original = originals.get(path);
      if (original !== undefined) await writeFileAtomic(path, original, `${plan.transactionId}.rollback`).catch(() => undefined);
    }
    throw error;
  }
}

export async function legacyDetach(startPath: string, commit: boolean): Promise<LegacyPlan> {
  const plan = await planLegacyDetach(startPath);
  return commit && plan.removedEntries > 0 ? commitLegacyDetach(plan) : plan;
}
