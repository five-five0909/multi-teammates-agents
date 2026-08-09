import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { z } from "zod";

import { writeFileAtomic } from "../platform/atomic-file.js";
import { resolveCommand } from "../platform/probe.js";
import { ProcessRunner } from "../runtime/host/process-runner.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";

const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const registryVersionSchema = z.object({ version:z.string().regex(EXACT_VERSION) });
const cacheSchema = z.strictObject({ schemaVersion:z.literal(1), packageName:z.literal(PACKAGE_NAME), version:z.string().regex(EXACT_VERSION), checkedAt:z.string().datetime() });
const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

export interface UpdateCheck {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  checkedAt: string;
  cached: boolean;
}

export interface UpdatePlan {
  packageName: string;
  currentVersion: string;
  targetVersion: string;
  updateRequired: boolean;
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
type Install = (version: string) => Promise<void>;

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
}

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

async function cachedCheck(path: string, now: Date): Promise<UpdateCheck | null> {
  try {
    const parsed = cacheSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
    const age = now.getTime() - Date.parse(parsed.checkedAt);
    if (age < 0 || age >= CACHE_TTL_MS) return null;
    return {
      packageName:PACKAGE_NAME, currentVersion:PACKAGE_VERSION, latestVersion:parsed.version,
      updateAvailable:compareVersions(parsed.version, PACKAGE_VERSION) > 0,
      checkedAt:parsed.checkedAt, cached:true,
    };
  } catch {
    return null;
  }
}

export async function checkForUpdate(options: UpdateCheckOptions = {}): Promise<UpdateCheck> {
  const now = (options.now ?? (() => new Date()))();
  const cachePath = options.cachePath ?? defaultCachePath();
  if (options.useCache === true) {
    const cached = await cachedCheck(cachePath, now);
    if (cached !== null) return cached;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 3_000);
  try {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(`https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`, {
      signal:controller.signal,
      headers:{ accept:"application/json", "user-agent":`${PACKAGE_NAME}/${PACKAGE_VERSION}` },
    });
    if (!response.ok) throw new Error(`npm registry returned HTTP ${String(response.status)}`);
    const latest = registryVersionSchema.parse(await response.json()).version;
    const checkedAt = now.toISOString();
    await mkdir(dirname(cachePath), { recursive:true });
    await writeFileAtomic(cachePath, `${JSON.stringify({ schemaVersion:1, packageName:PACKAGE_NAME, version:latest, checkedAt }, null, 2)}\n`, randomUUID());
    return {
      packageName:PACKAGE_NAME, currentVersion:PACKAGE_VERSION, latestVersion:latest,
      updateAvailable:compareVersions(latest, PACKAGE_VERSION) > 0,
      checkedAt, cached:false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function installGlobal(version: string): Promise<void> {
  const resolved = await resolveCommand("npm");
  const runner = new ProcessRunner();
  const result = await runner.run({
    episodeId:`npm-update-${randomUUID()}`,
    executable:resolved.executable,
    args:[...resolved.prefixArgs, "install", "--global", "--ignore-scripts", "--no-audit", "--no-fund", `${PACKAGE_NAME}@${version}`],
    cwd:tmpdir(), stdin:"", timeoutMs:120_000, maxStdoutChars:65_536, maxStderrChars:65_536,
  });
  if (result.exitCode !== 0 || result.terminationReason !== "completed") {
    throw new Error(result.cleanupError ?? result.spawnError ?? (result.stderr.trim() || `npm install exited with ${String(result.exitCode)}`));
  }
}

export async function updatePackage(options: PackageUpdateOptions): Promise<UpdateResult> {
  const targetVersion = options.targetVersion === undefined
    ? (await checkForUpdate({ ...options, useCache:false })).latestVersion
    : exactVersion(options.targetVersion);
  const updateRequired = compareVersions(targetVersion, PACKAGE_VERSION) !== 0;
  const plan: UpdatePlan = {
    packageName:PACKAGE_NAME,
    currentVersion:PACKAGE_VERSION,
    targetVersion,
    updateRequired,
    command:["npm", "install", "--global", "--ignore-scripts", "--no-audit", "--no-fund", `${PACKAGE_NAME}@${targetVersion}`],
  };
  if (!options.commit || !updateRequired) return { ...plan, committed:options.commit, updated:false, rollbackAttempted:false, rollbackSucceeded:null };
  const install = options.install ?? installGlobal;
  try {
    await install(targetVersion);
    return { ...plan, committed:true, updated:true, rollbackAttempted:false, rollbackSucceeded:null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await install(PACKAGE_VERSION);
      return { ...plan, committed:true, updated:false, rollbackAttempted:true, rollbackSucceeded:true, error:message };
    } catch (rollbackError) {
      return {
        ...plan, committed:true, updated:false, rollbackAttempted:true, rollbackSucceeded:false, error:message,
        rollbackError:rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      };
    }
  }
}
