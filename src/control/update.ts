import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { writeFileAtomic } from "../platform/atomic-file.js";
import { resolveCommand } from "../platform/probe.js";
import { ProcessRunner } from "../runtime/host/process-runner.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";

const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const registryVersionSchema = z.object({ version:z.string().regex(EXACT_VERSION) });
const cacheSchema = z.strictObject({ schemaVersion:z.literal(2), packageName:z.literal(PACKAGE_NAME), distTag:z.string().min(1), version:z.string().regex(EXACT_VERSION), checkedAt:z.string().datetime() });
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const OFFICIAL_REGISTRY = "https://registry.npmjs.org";

export type InstallSource = "global" | "unknown";

export interface UpdateCheck {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  checkedAt: string;
  cached: boolean;
  distTag: string;
}

export interface UpdatePlan {
  transactionId: string;
  packageName: string;
  currentVersion: string;
  targetVersion: string;
  updateRequired: boolean;
  installSource: InstallSource;
  selfUpdateSupported: boolean;
  cachePath: string;
  command: readonly string[];
}

export interface UpdateResult extends UpdatePlan {
  committed: boolean;
  updated: boolean;
  rollbackAttempted: boolean;
  rollbackSucceeded: boolean | null;
  error?: string;
  rollbackError?: string;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<FetchResponse>;
type Install = (version: string, cachePath: string) => Promise<void>;

export interface UpdateCheckOptions {
  useCache?: boolean;
  cachePath?: string;
  timeoutMs?: number;
  now?: () => Date;
  fetcher?: Fetcher;
}

export interface PackageUpdateOptions extends UpdateCheckOptions {
  targetVersion?: string;
  commit: boolean;
  install?: Install;
  installSource?: InstallSource;
}

const updatePlanSchema = z.strictObject({
  transactionId:z.string().uuid(),
  packageName:z.literal(PACKAGE_NAME),
  currentVersion:z.literal(PACKAGE_VERSION),
  targetVersion:z.string().regex(EXACT_VERSION),
  updateRequired:z.boolean(),
  installSource:z.enum(["global", "unknown"]),
  selfUpdateSupported:z.boolean(),
  cachePath:z.string().refine(isAbsolute, "update cache path must be absolute"),
  command:z.array(z.string()).min(1),
}).superRefine((plan, context) => {
  if (plan.updateRequired !== (compareVersions(plan.targetVersion, PACKAGE_VERSION) !== 0)) {
    context.addIssue({ code:"custom", path:["updateRequired"], message:"update requirement does not match the frozen target" });
  }
  if (plan.selfUpdateSupported !== (plan.installSource === "global")) {
    context.addIssue({ code:"custom", path:["selfUpdateSupported"], message:"self-update support does not match the installation source" });
  }
  if (plan.cachePath !== updateCachePath(plan.transactionId)) {
    context.addIssue({ code:"custom", path:["cachePath"], message:"update cache path does not match the frozen transaction" });
  }
  if (JSON.stringify(plan.command) !== JSON.stringify(updateCommand(plan.targetVersion, plan.cachePath))) {
    context.addIssue({ code:"custom", path:["command"], message:"update command does not match the frozen exact target" });
  }
});

interface ParsedVersion {
  core: readonly [bigint, bigint, bigint];
  prerelease: readonly string[];
}

function defaultCachePath(): string {
  const base = platform() === "win32"
    ? process.env.LOCALAPPDATA ?? resolve(homedir(), "AppData", "Local")
    : platform() === "darwin"
      ? resolve(homedir(), "Library", "Caches")
      : process.env.XDG_CACHE_HOME ?? resolve(homedir(), ".cache");
  return resolve(base, "mta", "update-check.json");
}

function exactVersion(value: string): string {
  const match = EXACT_VERSION.exec(value);
  if (match === null || match[4]?.split(".").some((part) => /^0\d+$/u.test(part))) {
    throw new Error(`version must be an exact semantic version: ${value}`);
  }
  return value;
}

function parseVersion(value: string): ParsedVersion {
  const match = EXACT_VERSION.exec(exactVersion(value));
  if (match === null) throw new Error(`invalid semantic version: ${value}`);
  return { core:[BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)], prerelease:match[4]?.split(".") ?? [] };
}

export function updateDistTag(version = PACKAGE_VERSION): string {
  const prerelease = parseVersion(version).prerelease[0];
  return prerelease !== undefined && /^[A-Za-z][0-9A-Za-z-]*$/u.test(prerelease) ? prerelease : "latest";
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumber = /^\d+$/u.test(left) ? BigInt(left) : null;
  const rightNumber = /^\d+$/u.test(right) ? BigInt(right) : null;
  if (leftNumber !== null && rightNumber !== null) return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < a.core.length; index += 1) {
    const leftPart = a.core[index]!;
    const rightPart = b.core[index]!;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const count = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    const comparison = compareIdentifiers(leftPart, rightPart);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

async function cachedCheck(path: string, now: Date, distTag: string): Promise<UpdateCheck | null> {
  try {
    const parsed = cacheSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
    const age = now.getTime() - Date.parse(parsed.checkedAt);
    if (age < 0 || age >= CACHE_TTL_MS || parsed.distTag !== distTag) return null;
    return {
      packageName:PACKAGE_NAME, currentVersion:PACKAGE_VERSION, latestVersion:parsed.version,
      updateAvailable:compareVersions(parsed.version, PACKAGE_VERSION) > 0,
      checkedAt:parsed.checkedAt, cached:true,
      distTag,
    };
  } catch {
    return null;
  }
}

export async function checkForUpdate(options: UpdateCheckOptions = {}): Promise<UpdateCheck> {
  const now = (options.now ?? (() => new Date()))();
  const cachePath = options.cachePath ?? defaultCachePath();
  const distTag = updateDistTag();
  if (options.useCache === true) {
    const cached = await cachedCheck(cachePath, now, distTag);
    if (cached !== null) return cached;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 3_000);
  try {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(`${OFFICIAL_REGISTRY}/${encodeURIComponent(PACKAGE_NAME)}/${encodeURIComponent(distTag)}`, {
      signal:controller.signal,
      headers:{ accept:"application/json", "user-agent":`${PACKAGE_NAME}/${PACKAGE_VERSION}` },
    });
    if (!response.ok) throw new Error(`npm registry returned HTTP ${String(response.status)}`);
    const latest = registryVersionSchema.parse(await response.json()).version;
    const checkedAt = now.toISOString();
    await mkdir(dirname(cachePath), { recursive:true });
    await writeFileAtomic(cachePath, `${JSON.stringify({ schemaVersion:2, packageName:PACKAGE_NAME, distTag, version:latest, checkedAt }, null, 2)}\n`, randomUUID());
    return {
      packageName:PACKAGE_NAME, currentVersion:PACKAGE_VERSION, latestVersion:latest,
      updateAvailable:compareVersions(latest, PACKAGE_VERSION) > 0,
      checkedAt, cached:false,
      distTag,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function npmGlobalRoot(): Promise<string> {
  const resolved = await resolveCommand("npm");
  const runner = new ProcessRunner();
  const result = await runner.run({
    episodeId:`npm-root-${randomUUID()}`,
    executable:resolved.executable,
    args:[...resolved.prefixArgs, "root", "--global"],
    cwd:tmpdir(), stdin:"", timeoutMs:10_000, maxStdoutChars:8_192, maxStderrChars:8_192,
  });
  if (result.exitCode !== 0 || result.terminationReason !== "completed") {
    throw new Error(result.cleanupError ?? result.spawnError ?? (result.stderr.trim() || `npm root exited with ${String(result.exitCode)}`));
  }
  const root = result.stdout.trim();
  if (root.length === 0) throw new Error("npm root --global returned an empty path");
  return root;
}

export async function detectInstallSource(globalRoot?: string): Promise<InstallSource> {
  try {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const installedRoot = resolve(globalRoot ?? await npmGlobalRoot(), PACKAGE_NAME);
    const [current, global] = await Promise.all([realpath(packageRoot), realpath(installedRoot)]);
    return platform() === "win32"
      ? current.toLocaleLowerCase("en-US") === global.toLocaleLowerCase("en-US") ? "global" : "unknown"
      : current === global ? "global" : "unknown";
  } catch {
    return "unknown";
  }
}

async function installGlobal(version: string, cache: string): Promise<void> {
  const resolved = await resolveCommand("npm");
  const runner = new ProcessRunner();
  try {
    await mkdir(cache, { recursive:true });
    const result = await runner.run({
      episodeId:`npm-update-${randomUUID()}`,
      executable:resolved.executable,
      args:[...resolved.prefixArgs, "install", "--global", "--ignore-scripts", "--no-audit", "--no-fund", `--registry=${OFFICIAL_REGISTRY}`, "--cache", cache, `${PACKAGE_NAME}@${version}`],
      cwd:tmpdir(), stdin:"", timeoutMs:120_000, maxStdoutChars:65_536, maxStderrChars:65_536,
    });
    if (result.exitCode !== 0 || result.terminationReason !== "completed") {
      throw new Error(result.cleanupError ?? result.spawnError ?? (result.stderr.trim() || `npm install exited with ${String(result.exitCode)}`));
    }
    const installedBin = resolve(await npmGlobalRoot(), PACKAGE_NAME, "bin", "mta.js");
    const health = await runner.run({
      episodeId:`npm-health-${randomUUID()}`,
      executable:process.execPath,
      args:[installedBin, "--version"],
      cwd:tmpdir(), stdin:"", timeoutMs:10_000, maxStdoutChars:8_192, maxStderrChars:8_192,
    });
    if (health.exitCode !== 0 || health.terminationReason !== "completed" || health.stdout.trim() !== version) {
      throw new Error(health.stderr.trim() || `installed package health check did not report ${version}`);
    }
  } finally {
    await rm(cache, { recursive:true, force:true });
  }
}

function updateCachePath(transactionId: string): string {
  return resolve(tmpdir(), `mta-npm-update-${transactionId}`);
}

function updateCommand(targetVersion: string, cachePath: string): string[] {
  return ["npm", "install", "--global", "--ignore-scripts", "--no-audit", "--no-fund", `--registry=${OFFICIAL_REGISTRY}`, "--cache", cachePath, `${PACKAGE_NAME}@${targetVersion}`];
}

export async function planPackageUpdate(options: Omit<PackageUpdateOptions, "commit" | "install"> = {}): Promise<UpdatePlan> {
  const targetVersion = options.targetVersion === undefined
    ? await checkForUpdate({ ...options, useCache:false }).then((check) => check.updateAvailable ? check.latestVersion : PACKAGE_VERSION)
    : exactVersion(options.targetVersion);
  const updateRequired = compareVersions(targetVersion, PACKAGE_VERSION) !== 0;
  const installSource = options.installSource ?? await detectInstallSource();
  const selfUpdateSupported = installSource === "global";
  const transactionId = randomUUID();
  const cachePath = updateCachePath(transactionId);
  return updatePlanSchema.parse({
    transactionId,
    packageName:PACKAGE_NAME,
    currentVersion:PACKAGE_VERSION,
    targetVersion,
    updateRequired,
    installSource,
    selfUpdateSupported,
    cachePath,
    command:updateCommand(targetVersion, cachePath),
  });
}

export async function commitPackageUpdate(plan: unknown, options: Pick<PackageUpdateOptions, "install"> = {}): Promise<UpdateResult> {
  const parsed = updatePlanSchema.parse(plan);
  if (!parsed.updateRequired) return { ...parsed, committed:true, updated:false, rollbackAttempted:false, rollbackSucceeded:null };
  if (!parsed.selfUpdateSupported) {
    return {
      ...parsed,
      committed:false,
      updated:false,
      rollbackAttempted:false,
      rollbackSucceeded:null,
      error:"self-update is available only from the global npm installation; run the exact command shown in the plan",
    };
  }
  const install = options.install ?? installGlobal;
  try {
    await install(parsed.targetVersion, parsed.cachePath);
    return { ...parsed, committed:true, updated:true, rollbackAttempted:false, rollbackSucceeded:null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await install(PACKAGE_VERSION, `${parsed.cachePath}-rollback`);
      return { ...parsed, committed:true, updated:false, rollbackAttempted:true, rollbackSucceeded:true, error:message };
    } catch (rollbackError) {
      return {
        ...parsed, committed:true, updated:false, rollbackAttempted:true, rollbackSucceeded:false, error:message,
        rollbackError:rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      };
    }
  }
}

export async function updatePackage(options: PackageUpdateOptions): Promise<UpdateResult> {
  const { commit, install, ...requestedPlan } = options;
  const plan = await planPackageUpdate({
    ...requestedPlan,
    ...(install !== undefined && requestedPlan.installSource === undefined ? { installSource:"global" as const } : {}),
  });
  if (!commit) return { ...plan, committed:false, updated:false, rollbackAttempted:false, rollbackSucceeded:null };
  return commitPackageUpdate(plan, install === undefined ? {} : { install });
}
