import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { dispatchHook } from "../dist/hooks/dispatcher.js";
import { renderHostDecision } from "../dist/hooks/host-adapter.js";
import { TaskRepository } from "../dist/lifecycle/task-repository.js";
import { commitApply, planApply } from "../dist/control/apply.js";
import { readProjectStatus } from "../dist/control/status.js";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "mta-hook-"));
  await mkdir(join(root, ".git"));
  t.after(() => rm(root, { recursive:true, force:true }));
  const repository = await TaskRepository.open(root);
  const created = await repository.create("Hook", { slug:"hook" });
  const directory = join(root, ...created.path.split("/"));
  await writeFile(join(directory, "prd.md"), "# PRD\n\nApproved hook lifecycle behavior and acceptance criteria.\n");
  await writeFile(join(directory, "design.md"), "# Design\n\nOne dispatcher validates every host event before decisions.\n");
  await writeFile(join(directory, "implement.md"), "# Plan\n\n- [ ] Implement and verify every hook event with bounded output.\n");
  await repository.start("hook", "session-1", "codex");
  await commitApply(await planApply(root, ["codex"]));
  return { root, repository };
}

const envelope = (root, event, payload = {}, trusted = true) => ({schema_version:1,event,host:"codex",session_id:"session-1",project_root:root,trusted,payload});

test("SessionStart restores bounded context and PreToolUse enforces the shared gate", async (t) => {
  const { root, repository } = await setup(t);
  const started = await dispatchHook(repository, envelope(root, "SessionStart"));
  assert.equal(started.action, "inject");
  assert.match(started.context, /hook.*in_progress/u);
  assert.equal(started.context.length < 500, true);
  const allowed = await dispatchHook(repository, envelope(root, "PreToolUse", {operation:"write",paths:["a.ts","b.ts"],multi_file:true}));
  assert.equal(allowed.action, "allow");
  const status = await readProjectStatus(root);
  assert.equal(status.ownershipValid, true);
  assert.deepEqual(status.integrations.codex, { installed:true, trusted:true, enforced:true });
  const denied = await dispatchHook(repository, envelope(root, "PreToolUse", {operation:"write",paths:["a.ts","b.ts"],multi_file:true}, false));
  assert.equal(denied.action, "deny");
  assert.equal(denied.enforcement, "partial");
});

test("permission is never auto-approved and PostToolUse cannot claim pre-action enforcement", async (t) => {
  const { root, repository } = await setup(t);
  assert.equal((await dispatchHook(repository, envelope(root, "PermissionRequest", {request:"elevate"}))).action, "ask");
  const post = await dispatchHook(repository, envelope(root, "PostToolUse", {authorization:"topsecret"}));
  assert.equal(post.action, "record");
  const log = await readFile(join(root, ".mta", "sessions", "session-1.events.jsonl"), "utf8");
  assert.doesNotMatch(log, /topsecret/u);
});

test("all lifecycle events share one dispatcher and SessionEnd releases only its pointer", async (t) => {
  const { root, repository } = await setup(t);
  for (const event of ["UserPromptSubmit","SubagentStart","SubagentStop"]) {
    const decision = await dispatchHook(repository, envelope(root, event));
    assert.equal(decision.event, event);
  }
  const preCompact = await dispatchHook(repository, envelope(root, "PreCompact", { trigger:"auto", compact_summary:"must-not-persist" }));
  assert.equal(preCompact.action, "record");
  const compactPath = join(root, ".mta", "sessions", "session-1.compact.json");
  const compact = await readFile(compactPath, "utf8");
  assert.match(compact, /"trigger": "auto"/u);
  assert.doesNotMatch(compact, /must-not-persist/u);
  assert.equal((await dispatchHook(repository, envelope(root, "PostCompact", { trigger:"auto", compact_summary:"also-private" }))).action, "record");
  const restored = await dispatchHook(repository, envelope(root, "SessionStart"));
  assert.match(restored.context, /Compact recovery.*auto/u);
  const continued = await dispatchHook(repository, envelope(root, "Stop", { stop_hook_active:false }));
  assert.equal(continued.action, "continue");
  assert.deepEqual(renderHostDecision("codex", continued), { decision:"block", reason:continued.reason });
  const gated = await dispatchHook(repository, envelope(root, "Stop", { stop_hook_active:true }));
  assert.equal(gated.action, "stop");
  assert.deepEqual(renderHostDecision("claude", gated), { continue:false, stopReason:gated.reason, systemMessage:gated.reason });
  const ended = await dispatchHook(repository, envelope(root, "SessionEnd"));
  assert.equal(ended.action, "record");
  assert.equal(await repository.current("session-1"), null);
  await assert.rejects(readFile(compactPath), { code:"ENOENT" });
});

test("hook workspace mismatch fails closed", async (t) => {
  const { root, repository } = await setup(t);
  await assert.rejects(dispatchHook(repository, { ...envelope(root, "SessionStart"), project_root:join(root, "other") }), /workspace/u);
});
