import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import {
  APPLY_SCHEMA_VERSION,
  decodeApplyReceipt,
  type ApplyChange,
  type ApplyHost,
  type ApplyPlan,
  type ApplyReceipt,
} from "./apply-contract.js";
import { sha256 } from "./digest.js";
import { assertSafeApplyRoot, findGitRoot } from "./project-root.js";
import { writeFileAtomic } from "../platform/atomic-file.js";
import { projectTemplates } from "../templates/registry.js";
import { PACKAGE_VERSION } from "../version.js";

const RECEIPT_PATH = ".mta/apply-receipt.json";

export class ApplyConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ApplyConflictError";
  }
}

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function targetPath(projectRoot: string, relativePath: string): string {
  const target = resolve(projectRoot, relativePath);
  if (target !== projectRoot && !target.startsWith(`${projectRoot}${sep}`)) {
    throw new ApplyConflictError(`owned path escapes project root: ${relativePath}`);
  }
  return target;
}

async function readReceipt(projectRoot: string): Promise<ApplyReceipt | null> {
  const bytes = await readOptional(targetPath(projectRoot, RECEIPT_PATH));
  if (!bytes) return null;
  return decodeApplyReceipt(JSON.parse(bytes.toString("utf8")) as unknown);
}

function normalizeHosts(hosts: readonly ApplyHost[]): readonly ApplyHost[] {
  const normalized = [...new Set(hosts)].sort();
  if (normalized.length === 0) return ["claude", "codex"];
  return normalized;
}

async function detectLegacyConflict(projectRoot: string): Promise<string | null> {
  const candidates = [".codex/hooks.json", ".claude/settings.json", ".mcp.json"];
  for (const relativePath of candidates) {
    const bytes = await readOptional(targetPath(projectRoot, relativePath));
    if (!bytes) continue;
    const content = bytes.toString("utf8");
    if (/expert_team|expert-team/u.test(content) && /\.py\b|python|expert_team_mcp_launcher/u.test(content)) {
      return relativePath;
    }
  }
  return null;
}

export async function planApply(startPath: string, requestedHosts: readonly ApplyHost[]): Promise<ApplyPlan> {
  const projectRoot = await findGitRoot(startPath);
  await assertSafeApplyRoot(projectRoot);
  const legacyConflict = await detectLegacyConflict(projectRoot);
  if (legacyConflict) {
    throw new ApplyConflictError(
      `legacy Python entry conflicts at ${legacyConflict}; run mta legacy detach --yes before apply`,
    );
  }

  const hosts = normalizeHosts(requestedHosts);
  const receipt = await readReceipt(projectRoot);
  if (receipt && receipt.projectRoot !== projectRoot) {
    throw new ApplyConflictError("apply receipt belongs to another project root");
  }
  const templates = projectTemplates(projectRoot, hosts);
  const desiredPaths = new Set(templates.map((template) => template.relativePath));
  const changes: ApplyChange[] = [];
  for (const template of templates) {
    const before = await readOptional(targetPath(projectRoot, template.relativePath));
    const owned = receipt?.files.find((file) => file.relativePath === template.relativePath);
    if (before && owned && sha256(before) !== owned.appliedHash) {
      throw new ApplyConflictError(`${template.relativePath} drifted after apply; refusing to overwrite user changes`);
    }
    if (template.relativePath === ".mta/runtime.json" && before && !owned) {
      throw new ApplyConflictError(`${template.relativePath} exists without an ownership receipt`);
    }
    const original = owned === undefined
      ? before
      : owned.originalBase64 === null ? null : Buffer.from(owned.originalBase64, "base64");
    let content: string;
    try {
      content = template.render(original);
    } catch (error) {
      throw new ApplyConflictError(error instanceof Error ? error.message : String(error));
    }
    const beforeHash = before === null ? null : sha256(before);
    const afterHash = sha256(content);
    changes.push({
      relativePath: template.relativePath,
      action: beforeHash === null ? "create" : beforeHash === afterHash ? "unchanged" : "update",
      beforeHash,
      afterHash,
      content,
      originalBase64: owned?.originalBase64 ?? (before ? before.toString("base64") : null),
      ownedAfter: true,
    });
  }
  for (const owned of receipt?.files ?? []) {
    if (desiredPaths.has(owned.relativePath)) continue;
    const before = await readOptional(targetPath(projectRoot, owned.relativePath));
    if (!before || sha256(before) !== owned.appliedHash) {
      throw new ApplyConflictError(`${owned.relativePath} drifted after apply; refusing to restore it`);
    }
    const content = owned.originalBase64 === null ? null : Buffer.from(owned.originalBase64, "base64").toString("utf8");
    const afterHash = content === null ? null : sha256(content);
    changes.push({
      relativePath: owned.relativePath,
      action: content === null ? "remove" : sha256(before) === afterHash ? "unchanged" : "update",
      beforeHash: sha256(before),
      afterHash,
      content,
      originalBase64: owned.originalBase64,
      ownedAfter: false,
    });
  }

  return {
    schemaVersion: APPLY_SCHEMA_VERSION,
    transactionId: randomUUID(),
    packageVersion: PACKAGE_VERSION,
    projectRoot,
    hosts,
    changes,
  };
}

export interface CommitApplyOptions {
  readonly beforeCommit?: () => void | Promise<void>;
  readonly failAfterWrites?: number;
  readonly now?: () => Date;
}

export async function commitApply(
  plan: ApplyPlan,
  options: CommitApplyOptions = {},
): Promise<ApplyReceipt> {
  await options.beforeCommit?.();
  for (const change of plan.changes) {
    const current = await readOptional(targetPath(plan.projectRoot, change.relativePath));
    const currentHash = current ? sha256(current) : null;
    if (currentHash !== change.beforeHash) {
      throw new ApplyConflictError(`${change.relativePath} changed after planning`);
    }
  }

  const mtaDirectory = targetPath(plan.projectRoot, ".mta");
  await mkdir(mtaDirectory, { recursive: true });
  const rollback: Array<{ path: string; bytes: Buffer | null }> = [];
  let writes = 0;

  try {
    for (const change of plan.changes) {
      if (change.action === "unchanged") continue;
      const absolutePath = targetPath(plan.projectRoot, change.relativePath);
      rollback.push({ path: absolutePath, bytes: await readOptional(absolutePath) });
      if (change.action === "remove") {
        await rm(absolutePath, { force: true });
      } else {
        if (change.content === null) throw new ApplyConflictError(`${change.relativePath} has no rendered content`);
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFileAtomic(absolutePath, change.content, plan.transactionId);
      }
      writes += 1;
      if (options.failAfterWrites !== undefined && writes >= options.failAfterWrites) {
        throw new Error("injected apply transaction failure");
      }
    }

    const receipt: ApplyReceipt = {
      schemaVersion: APPLY_SCHEMA_VERSION,
      transactionId: plan.transactionId,
      packageVersion: plan.packageVersion,
      projectRoot: plan.projectRoot,
      hosts: plan.hosts,
      appliedAt: (options.now?.() ?? new Date()).toISOString(),
      files: plan.changes.filter((change) => change.ownedAfter).map((change) => ({
        relativePath: change.relativePath,
        originalBase64: change.originalBase64,
        appliedHash: change.afterHash ?? "",
      })),
    };
    await writeFileAtomic(
      targetPath(plan.projectRoot, RECEIPT_PATH),
      `${JSON.stringify(receipt, null, 2)}\n`,
      plan.transactionId,
    );
    return receipt;
  } catch (error) {
    for (const entry of rollback.reverse()) {
      if (entry.bytes === null) {
        await rm(entry.path, { force: true }).catch(() => undefined);
      } else {
        await writeFileAtomic(entry.path, entry.bytes, `${plan.transactionId}.rollback`).catch(() => undefined);
      }
    }
    throw error;
  }
}

export async function applyProject(
  startPath: string,
  requestedHosts: readonly ApplyHost[],
  commit: boolean,
): Promise<ApplyPlan | ApplyReceipt> {
  const plan = await planApply(startPath, requestedHosts);
  return commit ? commitApply(plan) : plan;
}

export interface UnapplyResult {
  readonly projectRoot: string;
  readonly changed: boolean;
  readonly wouldRemove: readonly string[];
}

export async function unapplyProject(startPath: string, commit: boolean): Promise<UnapplyResult> {
  const projectRoot = await findGitRoot(startPath);
  const receipt = await readReceipt(projectRoot);
  if (!receipt) {
    throw new ApplyConflictError("no valid apply receipt; refusing to guess what to remove");
  }

  for (const file of receipt.files) {
    const current = await readOptional(targetPath(projectRoot, file.relativePath));
    if (!current || sha256(current) !== file.appliedHash) {
      throw new ApplyConflictError(`${file.relativePath} drifted after apply; preserving user changes`);
    }
  }
  const wouldRemove = receipt.files.map((file) => file.relativePath);
  if (!commit) return { projectRoot, changed: false, wouldRemove };

  for (const file of [...receipt.files].reverse()) {
    const absolutePath = targetPath(projectRoot, file.relativePath);
    if (file.originalBase64 === null) {
      await rm(absolutePath, { force: true });
    } else {
      await writeFileAtomic(
        absolutePath,
        Buffer.from(file.originalBase64, "base64"),
        `${receipt.transactionId}.unapply`,
      );
    }
  }
  await rm(targetPath(projectRoot, RECEIPT_PATH), { force: true });
  await rm(targetPath(projectRoot, ".mta"), { recursive: false }).catch(() => undefined);
  return { projectRoot, changed: true, wouldRemove };
}
