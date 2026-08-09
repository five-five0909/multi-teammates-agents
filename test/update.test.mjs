import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkForUpdate, compareVersions, updatePackage } from "../dist/control/update.js";

test("semantic version comparison handles stable and prerelease precedence", () => {
  assert.equal(compareVersions("1.0.0", "1.0.0-alpha.1"), 1);
  assert.equal(compareVersions("1.0.0-alpha.2", "1.0.0-alpha.10"), -1);
  assert.equal(compareVersions("1.0.0-beta", "1.0.0-alpha"), 1);
  assert.equal(compareVersions("1.0.0+build.2", "1.0.0+build.1"), 0);
  assert.equal(compareVersions("9007199254740993.0.0", "9007199254740992.0.0"), 1);
  assert.equal(compareVersions("1.0.0-alpha.9007199254740993", "1.0.0-alpha.9007199254740992"), 1);
  assert.throws(() => compareVersions("1.0.0-01", "1.0.0"), /exact semantic version/u);
});

test("update checks validate registry data and cache successful results for 24 hours", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mta-update-"));
  const cachePath = join(directory, "cache.json");
  t.after(() => rm(directory, { recursive:true, force:true }));
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return { ok:true, status:200, json:async () => ({ version:"0.6.0" }) };
  };
  const now = () => new Date("2026-08-09T00:00:00.000Z");
  const fresh = await checkForUpdate({ cachePath, fetcher, now, useCache:true });
  assert.equal(fresh.cached, false);
  assert.equal(fresh.updateAvailable, true);
  const cached = await checkForUpdate({ cachePath, fetcher, now:() => new Date("2026-08-09T23:59:59.000Z"), useCache:true });
  assert.equal(cached.cached, true);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(await readFile(cachePath, "utf8")).version, "0.6.0");
  await checkForUpdate({ cachePath, fetcher, now:() => new Date("2026-08-10T00:00:00.000Z"), useCache:true });
  assert.equal(calls, 2);
});

test("offline and malformed registry responses fail without replacing a valid cache", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mta-update-fail-"));
  const cachePath = join(directory, "cache.json");
  t.after(() => rm(directory, { recursive:true, force:true }));
  await writeFile(cachePath, JSON.stringify({ schemaVersion:1, packageName:"multi-teammates-agents", version:"0.5.1", checkedAt:"2026-08-09T00:00:00.000Z" }));
  await assert.rejects(checkForUpdate({ cachePath, useCache:false, fetcher:async () => { throw new Error("offline"); } }), /offline/u);
  assert.equal(JSON.parse(await readFile(cachePath, "utf8")).version, "0.5.1");
  await assert.rejects(checkForUpdate({ cachePath, useCache:false, fetcher:async () => ({ ok:true, status:200, json:async () => ({ version:"latest" }) }) }), /invalid_string|format|pattern/iu);
});

test("update preview is read-only and committed updates use exact versions", async () => {
  const installs = [];
  const preview = await updatePackage({ targetVersion:"0.6.0", commit:false, install:async (version) => installs.push(version) });
  assert.equal(preview.updated, false);
  assert.equal(preview.committed, false);
  assert.deepEqual(installs, []);
  assert.deepEqual(preview.command.slice(1, 4), ["install", "--global", "--ignore-scripts"]);
  const committed = await updatePackage({ targetVersion:"0.6.0", commit:true, install:async (version) => installs.push(version) });
  assert.equal(committed.updated, true);
  assert.deepEqual(installs, ["0.6.0"]);
});

test("failed updates restore the current exact version and expose rollback failure", async () => {
  const restored = [];
  const rolledBack = await updatePackage({
    targetVersion:"0.6.0", commit:true,
    install:async (version) => { restored.push(version); if (version === "0.6.0") throw new Error("install failed"); },
  });
  assert.equal(rolledBack.rollbackSucceeded, true);
  assert.deepEqual(restored, ["0.6.0", "0.5.0-alpha.0"]);
  let calls = 0;
  const failedRollback = await updatePackage({
    targetVersion:"0.6.0", commit:true,
    install:async () => { calls += 1; throw new Error(calls === 1 ? "install failed" : "rollback failed"); },
  });
  assert.equal(failedRollback.rollbackSucceeded, false);
  assert.match(failedRollback.rollbackError, /rollback failed/u);
});

test("bounded update checks abort stalled registry requests", async () => {
  await assert.rejects(checkForUpdate({
    useCache:false,
    timeoutMs:20,
    fetcher:(_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once:true })),
  }), /aborted/u);
});
