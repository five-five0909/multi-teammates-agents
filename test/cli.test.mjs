import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { TaskRepository } from "../dist/lifecycle/task-repository.js";

const root = resolve(import.meta.dirname, "..");
const bin = resolve(root, "bin", "mta.js");

function run(args, cwd = root) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, shell: false });
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

  const version = await run(["--version"]);
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), "0.5.0-alpha.0");
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
    assert.equal(status.projectRoot, project);
    assert.equal(status.applied, false);
    assert.equal(status.receiptValid, null);
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
  const resumed = await run(["run", "resume", "run-1", "--project", project, "--session", "run-session", "--json"]);
  assert.deepEqual(JSON.parse(resumed.stdout).work_items.one, { status:"pending", attempt:0 });
});
