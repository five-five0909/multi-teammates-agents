import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { BoundRunService } from "../dist/lifecycle/run-service.js";
import { TaskRepository } from "../dist/lifecycle/task-repository.js";
import { runForeground } from "../dist/runtime/foreground.js";
import { ClaudeHostAdapter } from "../dist/runtime/host/claude-adapter.js";
import { CodexHostAdapter } from "../dist/runtime/host/codex-adapter.js";

const fixture = resolve(import.meta.dirname, "fixtures", "fake-host-cli.mjs");

function fakeAdapter(host) {
  const options = { command:process.execPath, prefixArgs:[fixture, "--fake-host", host] };
  return host === "codex" ? new CodexHostAdapter(options) : new ClaudeHostAdapter(options);
}

async function setup(t) {
  const project = await mkdtemp(join(tmpdir(), "mta-foreground-"));
  await mkdir(join(project, ".git"));
  t.after(() => rm(project, { recursive:true, force:true }));
  const tasks = await TaskRepository.open(project);
  const created = await tasks.create("Foreground", { slug:"foreground" });
  const taskDir = join(project, ...created.path.split("/"));
  for (const name of ["prd.md", "design.md", "implement.md"]) {
    await writeFile(join(taskDir, name), `# ${name}\n\nReviewed foreground contract with concrete implementation and verification details.\n`);
  }
  await tasks.start("foreground", "foreground-session", "codex");
  const service = await BoundRunService.open(project, "foreground-session", "test");
  await service.start("run-1", {
    schema_version:1, goal:"Complete fake foreground", constraints:[], deliverables:["result"], acceptance_criteria:["audited"],
  }, [{
    schema_version:1, id:"one", objective:"Do one", role:"executor", mode:"read", required:true,
    depends_on:[], ownership:[], evidence_required:["check"], executor_id:null, attempt:0, status:"pending",
  }]);
  return service;
}

test("foreground runs Manager, Executor, and independent Auditor through real child processes", async (t) => {
  const service = await setup(t);
  const outcome = await runForeground(service, "run-1", {
    max_concurrency:2,
    human_completion_gate:false,
    roles:{
      manager:{ host:"codex", timeout_seconds:5, context_chars:8_000, output_chars:8_000 },
      executor:{ host:"claude", timeout_seconds:5, context_chars:8_000, output_chars:8_000 },
      auditor:{ host:"codex", timeout_seconds:5, context_chars:8_000, output_chars:8_000 },
    },
  }, { adapters:{ codex:fakeAdapter("codex"), claude:fakeAdapter("claude") } });
  assert.equal(outcome.snapshot.state, "completed");
  assert.deepEqual(outcome.snapshot.verified_progress.one, ["fake audit"]);
  assert.equal(new Set(outcome.episodeIds).size, 4);
  const backendEvents = (await readFile(join(service.store.traceDir("run-1"), "backend-events.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(backendEvents.some((event) => event.host === "claude"));
  assert.ok(backendEvents.some((event) => event.role === "auditor"));
});

test("foreground config rejects unknown fields and read-only commands never construct adapters", async (t) => {
  const service = await setup(t);
  await assert.rejects(runForeground(service, "run-1", { roles:{}, surprise:true }), /ForegroundConfig/u);
  const status = await service.runtime("run-1").load();
  const resumed = await service.resume("run-1");
  assert.equal(status.state, "initialized");
  assert.equal(resumed.state, "initialized");
});
