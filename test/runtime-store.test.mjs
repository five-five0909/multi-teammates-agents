import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers";

import { decodeContract, runEventSchema } from "../dist/runtime/core/contracts.js";
import { redactValue } from "../dist/runtime/security.js";
import { LeaseConflict, TrellisRunStore } from "../dist/runtime/storage/trellis-run-store.js";

const contract = {schema_version:1,goal:"Store safely",constraints:[],deliverables:["state"],acceptance_criteria:["replay"]};
const workItem = {schema_version:1,id:"build",objective:"Build",role:"developer",mode:"write",required:true,depends_on:[],ownership:["src/runtime"],evidence_required:["tests"],executor_id:null,attempt:0,status:"pending"};

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "mta-store-"));
  const taskDir = join(root, ".trellis", "tasks", "task-1");
  await mkdir(taskDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new TrellisRunStore({ repoRoot: root, taskDir, developer: "tester" });
  await store.create("run-1", contract, [workItem]);
  return { root, taskDir, store };
}

function managingEvent() {
  return decodeContract(runEventSchema, {schema_version:1,id:"event-1",run_id:"run-1",seq:1,expected_version:0,kind:"run.managing",timestamp:"2026-08-09T00:00:00Z",payload:{}}, "RunEvent");
}

test("new stores use mta-runs and repair a stale snapshot from events", async (t) => {
  const { taskDir, store } = await setup(t);
  const updated = await store.append(managingEvent(), { owner: "controller" });
  assert.equal(updated.state, "managing");
  assert.equal(await readFile(join(taskDir, "mta-runs", "run-1", "events.jsonl"), "utf8"), `${JSON.stringify(managingEvent())}\n`);
  await assert.rejects(readFile(join(taskDir, "runs", "run-1", "state.json"), "utf8"));

  const initial = JSON.parse(await readFile(join(taskDir, "mta-runs", "run-1", "initial.json"), "utf8"));
  await writeFile(join(taskDir, "mta-runs", "run-1", "state.json"), JSON.stringify(initial));
  const repaired = await store.load("run-1");
  assert.equal(repaired.version, 1);
  const persisted = JSON.parse(await readFile(join(taskDir, "mta-runs", "run-1", "state.json"), "utf8"));
  assert.deepEqual(persisted, repaired);
});

test("ahead snapshots and corrupt JSONL tails fail closed", async (t) => {
  const { taskDir, store } = await setup(t);
  const statePath = join(taskDir, "mta-runs", "run-1", "state.json");
  const initial = JSON.parse(await readFile(statePath, "utf8"));
  await writeFile(statePath, JSON.stringify({ ...initial, version: 1 }));
  await assert.rejects(store.load("run-1"), /ahead/u);
  await writeFile(statePath, JSON.stringify(initial));
  await appendFile(join(taskDir, "mta-runs", "run-1", "events.jsonl"), "{");
  await assert.rejects(store.load("run-1"), /invalid JSON/u);
});

test("lease conflicts are visible and a released lease can be reacquired", async (t) => {
  const { store } = await setup(t);
  let release;
  const held = store.withLease("run-1", "first", 30, async () => new Promise((resolve) => { release = resolve; }));
  while (release === undefined) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(store.withLease("run-1", "second", 30, async () => undefined), LeaseConflict);
  release();
  await held;
  assert.equal(await store.withLease("run-1", "second", 30, async () => "ok"), "ok");
});

test("durable role records redact labelled and bearer secrets", async (t) => {
  const { taskDir, store } = await setup(t);
  await store.recordRoleResult("run-1", {
    schema_version: 1,
    work_item_id: "build",
    attempt: 1,
    executor_id: "executor-1",
    summary: "authorization=topsecret",
    artifacts: [],
    evidence: ["Bearer abcdef123456"],
    checks: [],
    risks: [],
    failure: null,
  });
  const text = await readFile(join(taskDir, "mta-runs", "run-1", "work-items", "build", "attempt-1.json"), "utf8");
  assert.doesNotMatch(text, /topsecret|abcdef123456/u);
  assert.match(text, /REDACTED/u);
});

test("redaction preserves record identifiers that merely contain secret words", () => {
  assert.deepEqual(redactValue({ assignments:{ "read-token":"executor-read-token-1" }, authorization:"private" }), {
    assignments:{ "read-token":"executor-read-token-1" },
    authorization:"***REDACTED***",
  });
});
