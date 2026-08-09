import { createHash } from "node:crypto";
import { lstat, opendir, readFile, readlink, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { ContractError } from "../core/contracts.js";

const excludedRoots = new Set([".git", ".trellis", ".expert-team", "__pycache__", "node_modules", "dist"]);
export interface WorkspaceEntry { kind: "file" | "directory" | "symlink" | "other"; size: number; digest: string }
export interface WorkspaceSnapshot { root: string; entries: Record<string, WorkspaceEntry>; errors: string[] }
export interface WorkspaceDiff { added: string[]; deleted: string[]; changed: string[]; typeChanged: string[]; errors: string[]; clean: boolean }

export async function snapshotWorkspace(root: string, options: { maxFiles?: number; maxHashBytes?: number } = {}): Promise<WorkspaceSnapshot> {
  const maxFiles = options.maxFiles ?? 20_000;
  const maxHashBytes = options.maxHashBytes ?? 2_000_000;
  if (maxFiles < 1 || maxHashBytes < 1) throw new ContractError("workspace snapshot limits must be positive");
  let resolved: string;
  try { resolved = await realpath(root); } catch (error) { throw new ContractError("workspace snapshot root must be an existing directory", { cause: error }); }
  const entries: Record<string, WorkspaceEntry> = {};
  const errors: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    let handle;
    try { handle = await opendir(directory); } catch (error) { errors.push(String(error)); return; }
    const children = [];
    for await (const child of handle) children.push(child);
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (excludedRoots.has(child.name)) continue;
      if (Object.keys(entries).length >= maxFiles) { errors.push(`file limit exceeded: ${maxFiles}`); return; }
      const path = resolve(directory, child.name);
      const key = relative(resolved, path).split(sep).join("/");
      try {
        const info = await lstat(path, { bigint: false });
        if (child.isSymbolicLink()) {
          const target = await readlink(path);
          entries[key] = { kind:"symlink", size:target.length, digest:createHash("sha256").update(target).digest("hex") };
        } else if (child.isDirectory()) {
          entries[key] = { kind:"directory", size:0, digest:"" };
          await walk(path);
        } else if (child.isFile()) {
          if (info.size > maxHashBytes) { errors.push(`file exceeds hash limit: ${key}`); continue; }
          entries[key] = { kind:"file", size:info.size, digest:createHash("sha256").update(await readFile(path)).digest("hex") };
        } else entries[key] = { kind:"other", size:0, digest:"" };
      } catch (error) { errors.push(`${key}: ${String(error)}`); }
    }
  };
  await walk(resolved);
  return { root:resolved, entries, errors };
}

export function diffWorkspace(before: WorkspaceSnapshot, after: WorkspaceSnapshot): WorkspaceDiff {
  if (before.root !== after.root) throw new ContractError("workspace snapshots have different roots");
  const beforeKeys = new Set(Object.keys(before.entries));
  const afterKeys = new Set(Object.keys(after.entries));
  const added = [...afterKeys].filter((key) => !beforeKeys.has(key)).sort();
  const deleted = [...beforeKeys].filter((key) => !afterKeys.has(key)).sort();
  const changed: string[] = [];
  const typeChanged: string[] = [];
  for (const key of [...beforeKeys].filter((value) => afterKeys.has(value)).sort()) {
    const left = before.entries[key]!; const right = after.entries[key]!;
    if (left?.kind !== right?.kind) typeChanged.push(key);
    else if (left?.size !== right?.size || left.digest !== right.digest) changed.push(key);
  }
  const errors = [...before.errors, ...after.errors];
  return { added, deleted, changed, typeChanged, errors, clean:added.length + deleted.length + changed.length + typeChanged.length + errors.length === 0 };
}
