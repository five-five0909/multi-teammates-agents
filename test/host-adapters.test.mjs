import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { ClaudeHostAdapter } from "../dist/runtime/host/claude-adapter.js";
import { CodexHostAdapter } from "../dist/runtime/host/codex-adapter.js";

const fixture = resolve(import.meta.dirname, "fixtures", "fake-host-cli.mjs");
const workspace = resolve(import.meta.dirname, "..");

function adapter(host) {
  const options = { command:process.execPath, prefixArgs:[fixture, "--fake-host", host] };
  return host === "codex" ? new CodexHostAdapter(options) : new ClaudeHostAdapter(options);
}

test("host adapters expose versioned capabilities through probe", async () => {
  for (const host of ["codex", "claude"]) {
    const instance = host === "codex"
      ? new CodexHostAdapter({ command:process.execPath })
      : new ClaudeHostAdapter({ command:process.execPath });
    const capabilities = await instance.probe();
    assert.deepEqual(capabilities, {
      schema_version:1,
      host,
      available:true,
      command:process.execPath,
      resolved_command:process.execPath,
      version:process.version,
      stream_json:true,
      read_only:true,
      cancellation:true,
      error:null,
    });
  }
});

function request(overrides = {}) {
  return {
    episodeId:`episode-${randomUUID()}`,
    runId:"run-1",
    roundIndex:1,
    role:"manager",
    profile:"manager",
    prompt:JSON.stringify({ scenario:"normal", output:"expected" }),
    workspace,
    model:undefined,
    timeoutSeconds:5,
    maxOutputChars:8_000,
    permissionPosture:"host-controlled",
    readOnly:true,
    ...overrides,
  };
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

async function eventuallyNotAlive(pid) {
  for (let index = 0; index < 30; index += 1) {
    if (!alive(pid)) return true;
    await delay(50);
  }
  return !alive(pid);
}

for (const host of ["codex", "claude"]) {
  test(`${host} adapter parses chunked JSONL and records a shell-free permission posture`, async () => {
    const result = await adapter(host).runEpisode(request());
    assert.equal(result.status, "done");
    assert.equal(result.visibleOutput, "expected");
    assert.equal(result.metadata.shell, false);
    assert.equal(result.metadata.read_only, true);
    assert.ok(result.events.length >= 2);
    assert.equal(result.metadata.ignored_lines, 1);
    const args = result.metadata.arguments.join(" ");
    assert.doesNotMatch(args, /dangerously|bypass|skip-permissions/iu);
    assert.match(args, host === "codex" ? /--sandbox read-only/u : /--permission-mode plan/u);
    if (host === "codex") assert.match(args, /--ephemeral/u);
  });

  test(`${host} adapter maps permission, error, timeout, and bounded output`, async () => {
    const hostAdapter = adapter(host);
    const permission = await hostAdapter.runEpisode(request({ prompt:JSON.stringify({ scenario:"permission" }) }));
    assert.equal(permission.status, "permission_required");
    const failed = await hostAdapter.runEpisode(request({ prompt:JSON.stringify({ scenario:"nonzero" }) }));
    assert.equal(failed.status, "error");
    assert.equal(failed.exitCode, 7);
    const long = await hostAdapter.runEpisode(request({ prompt:JSON.stringify({ scenario:"long" }), maxOutputChars:1_000 }));
    assert.equal(long.status, "done");
    assert.equal(long.visibleOutput.length, 1_000);
    assert.equal(long.metadata.visible_output_truncated, true);
    const timedOut = await hostAdapter.runEpisode(request({ prompt:JSON.stringify({ scenario:"sleep" }), timeoutSeconds:0.1 }));
    assert.equal(timedOut.status, "timeout");
  });
}

test("explicit cancellation and AbortSignal share the active process registry", async () => {
  const hostAdapter = adapter("codex");
  const explicitRequest = request({ prompt:JSON.stringify({ scenario:"sleep" }) });
  const explicitRun = hostAdapter.runEpisode(explicitRequest);
  await delay(100);
  assert.deepEqual(await hostAdapter.cancel(explicitRequest.episodeId), { episodeId:explicitRequest.episodeId, found:true, terminated:true });
  assert.equal((await explicitRun).status, "cancelled");

  const controller = new globalThis.AbortController();
  const abortedRun = hostAdapter.runEpisode(request({ prompt:JSON.stringify({ scenario:"sleep" }) }), controller.signal);
  await delay(100);
  controller.abort();
  assert.equal((await abortedRun).status, "cancelled");
});

test("timeout removes the fake host child process tree", async () => {
  const result = await adapter("codex").runEpisode(request({
    prompt:JSON.stringify({ scenario:"child" }),
    timeoutSeconds:0.2,
  }));
  assert.equal(result.status, "timeout");
  const childEvent = result.events.find((event) => event.action === "test.child.started");
  assert.ok(childEvent);
  const childPid = Number(childEvent.source_id);
  assert.equal(await eventuallyNotAlive(childPid), true, `child process ${childPid} survived timeout`);
});

test("parallel episodes keep output and cancellation isolated", async () => {
  const hostAdapter = adapter("claude");
  const first = request({ prompt:JSON.stringify({ scenario:"normal", output:"first" }) });
  const second = request({ prompt:JSON.stringify({ scenario:"normal", output:"second" }) });
  const [firstResult, secondResult] = await Promise.all([hostAdapter.runEpisode(first), hostAdapter.runEpisode(second)]);
  assert.equal(firstResult.visibleOutput, "first");
  assert.equal(secondResult.visibleOutput, "second");
  assert.notEqual(firstResult.events[0].source_id, secondResult.events[0].source_id);
});

test("Auditor cannot request a writable host mode", async () => {
  await assert.rejects(
    adapter("codex").runEpisode(request({ role:"auditor", readOnly:false })),
    /Auditor episodes must be read-only/u,
  );
});

test("ordinary assistant text mentioning approval is not a permission event", async () => {
  const result = await adapter("codex").runEpisode(request({
    prompt:JSON.stringify({ scenario:"normal", output:"The phrase approval required is documentation, not a host error." }),
  }));
  assert.equal(result.status, "done");
});
