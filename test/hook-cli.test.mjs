import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const cli = resolve("bin/mta.js");

async function invoke(project, host, input) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cli, "hook", "dispatch", "--host", host, "--project", project], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (value) => { stdout += value; });
    child.stderr.setEncoding("utf8").on("data", (value) => { stderr += value; });
    child.once("error", reject);
    child.once("exit", (code) => { resolveResult({ code, stdout, stderr }); });
    child.stdin.end(JSON.stringify(input));
  });
}

test("hook CLI normalizes native host input and renders host-specific decisions", async () => {
  const project = await mkdtemp(join(tmpdir(), "mta-hook-cli-"));
  await mkdir(join(project, ".git"));
  try {
    const base = { session_id: "session-1", cwd: project };
    const start = await invoke(project, "codex", { ...base, hook_event_name: "SessionStart" });
    assert.equal(start.code, 0, start.stderr);
    assert.match(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, /no active task/u);

    const claude = await invoke(project, "claude", {
      ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf build" },
    });
    assert.equal(claude.code, 0, claude.stderr);
    assert.equal(JSON.parse(claude.stdout).hookSpecificOutput.permissionDecision, "ask");

    const record = await invoke(project, "codex", {
      ...base, hook_event_name: "PostToolUse", tool_name:"Write", tool_use_id:"tool-1", tool_response:{ success:true },
    });
    assert.equal(record.code, 0, record.stderr);
    assert.equal(record.stdout, "");

    const stop = await invoke(project, "codex", { ...base, hook_event_name:"Stop", stop_hook_active:false });
    assert.equal(stop.code, 0, stop.stderr);
    assert.equal(stop.stdout, "");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
