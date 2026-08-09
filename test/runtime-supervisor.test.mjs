import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ManagedRunSupervisor } from "../dist/runtime/supervisor/managed-run-supervisor.js";
import { RuntimeRepository } from "../dist/runtime/supervisor/runtime-repository.js";
import { TrellisRunStore } from "../dist/runtime/storage/trellis-run-store.js";

const contract = {schema_version:1,goal:"Ship two rounds",constraints:[],deliverables:["runtime"],acceptance_criteria:["independent audits"]};
const items = [
  {schema_version:1,id:"foundation",objective:"Build core",role:"developer",mode:"write",required:true,depends_on:[],ownership:["src/core"],evidence_required:["tests"],executor_id:null,attempt:0,status:"pending"},
  {schema_version:1,id:"verify",objective:"Verify core",role:"tester",mode:"verify",required:true,depends_on:["foundation"],ownership:[],evidence_required:["audit"],executor_id:null,attempt:0,status:"pending"},
];

class ScriptedAdapter {
  host = "codex";
  requests = [];
  manager = [];
  audits = [];
  statusByRole = {};
  onRun;

  constructor({ manager, audits = [], onRun, statusByRole = {} } = {}) {
    this.manager = [...(manager ?? [])];
    this.audits = [...audits];
    this.onRun = onRun;
    this.statusByRole = statusByRole;
  }

  async runEpisode(request) {
    this.requests.push(request);
    await this.onRun?.(request);
    let output;
    if (request.role === "manager") output = JSON.stringify(this.manager.shift());
    else if (request.role === "executor") {
      const payload = JSON.parse(request.prompt.split("Authoritative assignment:\n").at(-1));
      output = JSON.stringify({schema_version:1,work_item_id:payload.work_item.id,attempt:payload.work_item.attempt,executor_id:payload.executor_id,summary:"done",artifacts:[],evidence:[`evidence-${payload.work_item.id}`],checks:["tests"],risks:[],failure:null});
    } else {
      const payload = JSON.parse(request.prompt.split("Authoritative audit input:\n").at(-1));
      const status = this.audits.shift() ?? "accepted";
      output = JSON.stringify({schema_version:1,work_item_id:payload.work_item.id,attempt:payload.executor_result.attempt,auditor_id:payload.auditor_id,executor_id:payload.executor_result.executor_id,status,integrity:"clean",contract_alignment:"aligned",evidence:status === "accepted" ? [`audited-${payload.work_item.id}`] : [],findings:status === "accepted" ? [] : ["needs repair"],required_rework:status === "accepted" ? [] : ["repair"]});
    }
    return { episodeId:request.episodeId, host:this.host, role:request.role, status:this.statusByRole[request.role] ?? "done", visibleOutput:output, events:[], durationMs:1, exitCode:0, rawStdout:"", rawStderr:"", metadata:{} };
  }

  async cancel(episodeId) { return { episodeId, found:false, terminated:false }; }
}

async function setup(t, selectedItems = items) {
  const root = await mkdtemp(join(tmpdir(), "mta-supervisor-"));
  const taskDir = join(root, ".trellis", "tasks", "task-1");
  await mkdir(join(root, "src"), { recursive:true });
  await mkdir(taskDir, { recursive:true });
  await writeFile(join(root, "src", "seed.txt"), "seed\n");
  t.after(() => rm(root, { recursive:true, force:true }));
  const store = new TrellisRunStore({ repoRoot:root, taskDir, developer:"tester" });
  await store.create("run-1", contract, selectedItems, { maxRounds:4, retryLimit:2 });
  const repository = new RuntimeRepository(store, "run-1");
  const config = {
    workspace:root,
    maxConcurrency:2,
    humanCompletionGate:false,
    roles:{
      manager:{host:"codex",model:undefined,timeoutSeconds:30,contextChars:8000,outputChars:8000},
      executor:{host:"codex",model:undefined,timeoutSeconds:30,contextChars:8000,outputChars:8000},
      auditor:{host:"codex",model:undefined,timeoutSeconds:30,contextChars:8000,outputChars:8000},
    },
  };
  return { root, taskDir, store, repository, config };
}

test("one foreground call completes two independent Manager-Executor-Auditor rounds", async (t) => {
  const { repository, config } = await setup(t);
  const adapter = new ScriptedAdapter({ manager:[
    {schema_version:1,action:"execute",work_item_ids:["foundation"],message:"round one"},
    {schema_version:1,action:"execute",work_item_ids:["verify"],message:"round two"},
    {schema_version:1,action:"propose_complete",work_item_ids:[],message:"done"},
  ] });
  const outcome = await new ManagedRunSupervisor(repository, config, { codex:adapter }).run();
  assert.equal(outcome.snapshot.state, "completed");
  assert.equal(outcome.snapshot.rounds_used, 2);
  assert.deepEqual(Object.keys(outcome.snapshot.verified_progress), ["foundation", "verify"]);
  assert.equal(new Set(outcome.episodeIds).size, 7);
  assert.equal(adapter.requests.filter((request) => request.role === "auditor").every((request) => request.readOnly), true);
  assert.equal(adapter.requests.filter((request) => request.role === "executor").every((request) => !request.readOnly), true);
  assert.match(adapter.requests.find((request) => request.role === "executor").prompt, /summary.*artifacts.*evidence.*checks.*risks.*failure/u);
  assert.match(adapter.requests.find((request) => request.role === "auditor").prompt, /status.*integrity.*contract_alignment.*evidence.*findings.*required_rework/u);
});

test("a rejected audit causes bounded rework before verified progress", async (t) => {
  const { repository, config } = await setup(t, [items[0]]);
  const adapter = new ScriptedAdapter({ audits:["rework", "accepted"], manager:[
    {schema_version:1,action:"execute",work_item_ids:["foundation"],message:"first"},
    {schema_version:1,action:"execute",work_item_ids:["foundation"],message:"repair"},
    {schema_version:1,action:"propose_complete",work_item_ids:[],message:"done"},
  ] });
  const outcome = await new ManagedRunSupervisor(repository, config, { codex:adapter }).run();
  assert.equal(outcome.snapshot.state, "completed");
  assert.equal(outcome.snapshot.work_items.foundation.attempt, 2);
  assert.deepEqual(outcome.snapshot.verified_progress.foundation, ["audited-foundation"]);
});

test("invalid Manager output opens a repeated-failure gate", async (t) => {
  const { repository, config } = await setup(t, [items[0]]);
  const adapter = new ScriptedAdapter({ manager:[{wrong:true},{wrong:true}] });
  const outcome = await new ManagedRunSupervisor(repository, config, { codex:adapter }).run();
  assert.equal(outcome.snapshot.state, "needs_input");
  assert.equal(outcome.snapshot.pending_gate, "repeated_failure");
});

test("external cancellation leaves an unmatched episode that restart reconciles as abandoned", async (t) => {
  const { repository, config } = await setup(t, [items[0]]);
  let cancelled = false;
  const adapter = new ScriptedAdapter({
    manager:[{schema_version:1,action:"execute",work_item_ids:["foundation"],message:"ignored"}],
    onRun:async (request) => {
      if (!cancelled && request.role === "manager") { cancelled = true; await repository.transition("run.cancelled", { source:"external" }); }
    },
  });
  const first = await new ManagedRunSupervisor(repository, config, { codex:adapter }).run();
  assert.equal(first.snapshot.state, "cancelled");
  const second = await new ManagedRunSupervisor(repository, config, { codex:adapter }).run();
  assert.equal(second.snapshot.state, "cancelled");
  assert.equal((await repository.events()).some((event) => event.kind === "episode.abandoned"), true);
  assert.equal(second.snapshot.work_items.foundation.status, "pending");
});

test("Auditor workspace mutation fails closed and never verifies evidence", async (t) => {
  const { root, taskDir, repository, config } = await setup(t, [items[0]]);
  const adapter = new ScriptedAdapter({
    manager:[
      {schema_version:1,action:"execute",work_item_ids:["foundation"],message:"run"},
      {schema_version:1,action:"ask",work_item_ids:[],message:"audit failed"},
    ],
    onRun:async (request) => { if (request.role === "auditor") await writeFile(join(root, "src", "auditor-mutation.txt"), "dirty\n"); },
  });
  const outcome = await new ManagedRunSupervisor(repository, config, { codex:adapter }).run();
  assert.equal(outcome.snapshot.state, "needs_input");
  assert.deepEqual(outcome.snapshot.verified_progress, {});
  const audit = JSON.parse(await readFile(join(taskDir, "mta-runs", "run-1", "audits", "foundation", "attempt-1.json"), "utf8"));
  assert.equal(audit.status, "invalid");
  assert.equal(audit.integrity, "dirty");
});

test("Executor permission requests open a visible permission gate", async (t) => {
  const { repository, config } = await setup(t, [items[0]]);
  const adapter = new ScriptedAdapter({
    manager:[{schema_version:1,action:"execute",work_item_ids:["foundation"],message:"run"}],
    statusByRole:{ executor:"permission_required" },
  });
  const outcome = await new ManagedRunSupervisor(repository, config, { codex:adapter }).run();
  assert.equal(outcome.snapshot.state, "needs_input");
  assert.equal(outcome.snapshot.pending_gate, "permission");
  assert.deepEqual(outcome.snapshot.verified_progress, {});
});

test("Executor timeout opens a bounded repeated-failure gate", async (t) => {
  const { repository, config } = await setup(t, [items[0]]);
  const adapter = new ScriptedAdapter({
    manager:[{schema_version:1,action:"execute",work_item_ids:["foundation"],message:"run"}],
    statusByRole:{ executor:"timeout" },
  });
  const outcome = await new ManagedRunSupervisor(repository, config, { codex:adapter }).run();
  assert.equal(outcome.snapshot.state, "needs_input");
  assert.equal(outcome.snapshot.pending_gate, "repeated_failure");
  assert.deepEqual(outcome.snapshot.verified_progress, {});
});

test("round exhaustion opens the budget gate", async (t) => {
  const { repository, config } = await setup(t, [items[0]]);
  const initial = await repository.load();
  await writeFile(join(repository.store.runDir("run-1"), "initial.json"), JSON.stringify({ ...initial, max_rounds:1 }));
  await writeFile(join(repository.store.runDir("run-1"), "state.json"), JSON.stringify({ ...initial, max_rounds:1 }));
  const adapter = new ScriptedAdapter({
    manager:[{schema_version:1,action:"execute",work_item_ids:["foundation"],message:"run"}],
    audits:["rework"],
  });
  const outcome = await new ManagedRunSupervisor(repository, config, { codex:adapter }).run();
  assert.equal(outcome.snapshot.state, "needs_input");
  assert.equal(outcome.snapshot.pending_gate, "budget");
  assert.equal(outcome.snapshot.rounds_used, 1);
});

test("configured human completion gate stops at proposed_complete", async (t) => {
  const { repository, config } = await setup(t, [items[0]]);
  config.humanCompletionGate = true;
  const adapter = new ScriptedAdapter({ manager:[
    {schema_version:1,action:"execute",work_item_ids:["foundation"],message:"run"},
    {schema_version:1,action:"propose_complete",work_item_ids:[],message:"review"},
  ] });
  const outcome = await new ManagedRunSupervisor(repository, config, { codex:adapter }).run();
  assert.equal(outcome.snapshot.state, "proposed_complete");
  assert.equal(outcome.snapshot.pending_gate, "completion");
});

test("Manager blocked and cancel decisions map to their durable terminal controls", async (t) => {
  const blockedSetup = await setup(t, [items[0]]);
  const blockedAdapter = new ScriptedAdapter({ manager:[{schema_version:1,action:"blocked",work_item_ids:[],message:"cannot proceed"}] });
  const blocked = await new ManagedRunSupervisor(blockedSetup.repository, blockedSetup.config, { codex:blockedAdapter }).run();
  assert.equal(blocked.snapshot.state, "needs_input");
  assert.equal(blocked.snapshot.pending_gate, "blocked");

  const cancelSetup = await setup(t, [items[0]]);
  const cancelAdapter = new ScriptedAdapter({ manager:[{schema_version:1,action:"cancel",work_item_ids:[],message:"stop"}] });
  const cancelled = await new ManagedRunSupervisor(cancelSetup.repository, cancelSetup.config, { codex:cancelAdapter }).run();
  assert.equal(cancelled.snapshot.state, "cancelled");
});

test("unattributed user answers are rejected at the repository boundary", async (t) => {
  const { repository } = await setup(t, [items[0]]);
  await repository.transition("run.managing", {});
  await repository.transition("human.gate_requested", { gate_type:"ask" });
  await assert.rejects(repository.answer({schema_version:1,gate_type:"ask",decision:"continue",actor:"user",timestamp:new Date().toISOString()}), /attributable provenance/u);
});

test("resume heals a missing RoleResult file from the authoritative event payload", async (t) => {
  const { taskDir, repository } = await setup(t, [items[0]]);
  await repository.transition("run.managing", {});
  await repository.transition("wave.execution_started", { work_item_ids:["foundation"], executor_id:"executor-1" });
  const result = {schema_version:1,work_item_id:"foundation",attempt:1,executor_id:"executor-1",summary:"done",artifacts:[],evidence:["event evidence"],checks:[],risks:[],failure:null};
  await repository.transition("executor.result_submitted", result);
  const healed = await repository.loadRoleResult("foundation", 1);
  assert.deepEqual(healed, result);
  assert.deepEqual(JSON.parse(await readFile(join(taskDir, "mta-runs", "run-1", "work-items", "foundation", "attempt-1.json"), "utf8")), result);
});
