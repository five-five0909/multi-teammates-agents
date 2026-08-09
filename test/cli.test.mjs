import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { TaskRepository } from "../dist/lifecycle/task-repository.js";
import { BoundRunService } from "../dist/lifecycle/run-service.js";

const root = resolve(import.meta.dirname, "..");
const bin = resolve(root, "bin", "mta.js");

function run(args, cwd = root) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      env:{ ...process.env, NODE_NO_WARNINGS:"1" },
      shell:false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

test("help and version expose the npm product contract", async () => {
  const help = await run(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /mta \[command\]/u);
  assert.match(help.stdout, /status/u);
  assert.match(help.stdout, /doctor/u);
  assert.match(help.stdout, /migrate/u);

  const version = await run(["--version"]);
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), "0.5.0-alpha.1");
  const jsonVersion = await run(["--json", "--version"]);
  assert.equal(jsonVersion.code, 0);
  assert.equal(JSON.parse(jsonVersion.stdout), "0.5.0-alpha.1");
});

test("status resolves the Git root from a nested Unicode path", async () => {
  const project = await mkdtemp(join(tmpdir(), "mta-项目-"));
  try {
    await mkdir(join(project, ".git"));
    const nested = join(project, "space path", "child");
    await mkdir(nested, { recursive: true });
    const result = await run(["status", "--project", nested, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.projectRoot, await realpath(project));
    assert.equal(status.applied, false);
    assert.equal(status.receiptValid, null);
    assert.equal(status.trellis.bound, false);
    assert.equal(status.diagnostics.probes.some((probe) => probe.command === "mta mcp initialize" && probe.available), true);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("unknown commands fail with a stable usage error", async () => {
  const result = await run(["missing", "--json"]);
  assert.equal(result.code, 2);
  assert.deepEqual(JSON.parse(result.stderr), { error: "unknown command: missing" });
});

test("task CLI creates planning state and requires reviewed artifacts before start", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "mta-task-cli-"));
  await mkdir(join(root, ".git"));
  t.after(() => rm(root, { recursive:true, force:true }));
  const created = await run(["task", "create", "CLI Task", "--slug", "cli-task", "--project", root, "--json"]);
  assert.equal(created.code, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).task.status, "planning");
  const started = await run(["task", "start", "cli-task", "--session", "cli-session", "--project", root, "--json"]);
  assert.equal(started.code, 2);
  assert.match(JSON.parse(started.stderr).error, /placeholder/u);
});

test("run CLI and MCP-facing service read the same bound mta-runs state", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "mta-run-cli-"));
  await mkdir(join(project, ".git"));
  t.after(() => rm(project, { recursive:true, force:true }));
  const tasks = await TaskRepository.open(project);
  const created = await tasks.create("Run CLI", { slug:"run-cli" });
  const taskDir = join(project, ...created.path.split("/"));
  for (const name of ["prd.md", "design.md", "implement.md"]) await writeFile(join(taskDir, name), `# ${name}\n\nReviewed managed run contract with concrete acceptance and verification details.\n`);
  await tasks.start("run-cli", "run-session", "cli");
  const contract = { schema_version:1, goal:"Run CLI", constraints:[], deliverables:["state"], acceptance_criteria:["shared"] };
  const workItems = [{ schema_version:1, id:"one", objective:"One", role:"executor", mode:"read", required:true, depends_on:[], ownership:[], evidence_required:["status"], executor_id:null, attempt:0, status:"pending" }];
  const started = await run(["run", "start", "run-1", "--project", project, "--session", "run-session", "--contract", JSON.stringify(contract), "--workItems", JSON.stringify(workItems), "--json"]);
  assert.equal(started.code, 0, started.stderr);
  const status = await run(["run", "status", "run-1", "--project", project, "--session", "run-session", "--json"]);
  assert.equal(JSON.parse(status.stdout).state, "initialized");
  const projectStatus = await run(["status", "--project", project, "--session", "run-session", "--json"]);
  assert.equal(projectStatus.code, 0, projectStatus.stderr);
  assert.deepEqual(JSON.parse(projectStatus.stdout).trellis, {
    bound:true,
    sessionId:"run-session",
    taskId:"run-cli",
    taskPath:created.path,
    taskStatus:"in_progress",
    error:null,
  });
  const resumed = await run(["run", "resume", "run-1", "--project", project, "--session", "run-session", "--json"]);
  assert.deepEqual(JSON.parse(resumed.stdout).work_items.one, { status:"pending", attempt:0 });
  const invalidForeground = await run(["run", "foreground", "run-1", "--project", project, "--session", "run-session", "--config", JSON.stringify({ roles:{}, unknown:true }), "--json"]);
  assert.equal(invalidForeground.code, 2);
  assert.match(JSON.parse(invalidForeground.stderr).error, /ForegroundConfig/u);
  const service = await BoundRunService.open(project, "run-session", "test");
  await service.runtime("run-1").transition("run.managing", {});
  await service.runtime("run-1").transition("human.gate_requested", { gate_type:"ask" });
  const decision = {
    schema_version:1, gate_type:"ask", decision:"continue", actor:"user", timestamp:new Date().toISOString(),
    provenance:{ schema_version:1, gate_type:"ask", actor:"user", source:"user_prompt", verification:"verified", timestamp:new Date().toISOString(), source_event_id:"cli-decision-1", invocation_id:null },
  };
  const answered = await run(["run", "answer", "run-1", "--project", project, "--session", "run-session", "--decision", JSON.stringify(decision), "--json"]);
  assert.equal(answered.code, 0, answered.stderr);
  assert.equal(JSON.parse(answered.stdout).state, "managing");
});
