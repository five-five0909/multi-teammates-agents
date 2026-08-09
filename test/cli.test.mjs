import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

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
