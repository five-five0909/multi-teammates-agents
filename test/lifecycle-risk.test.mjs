import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { classifyRisk, gateToolUse } from "../dist/lifecycle/risk-gate.js";
import { TaskRepository } from "../dist/lifecycle/task-repository.js";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "mta-risk-"));
  await mkdir(join(root, ".git"));
  t.after(() => rm(root, { recursive:true, force:true }));
  return { root, repository:await TaskRepository.open(root) };
}

async function activeTask(root, repository) {
  const created = await repository.create("Managed", { slug:"managed" });
  const dir = join(root, ...created.path.split("/"));
  await writeFile(join(dir, "prd.md"), "# PRD\n\nApproved managed lifecycle requirements and acceptance criteria.\n");
  await writeFile(join(dir, "design.md"), "# Design\n\nOne authoritative task and session binding repository.\n");
  await writeFile(join(dir, "implement.md"), "# Plan\n\n- [ ] Implement bounded managed write with verification.\n");
  await repository.start("managed", "session-1", "codex");
}

test("risk classifier keeps destructive and permission actions at human gates", () => {
  assert.equal(classifyRisk({ operation:"read" }).risk, "read_only");
  assert.equal(classifyRisk({ operation:"write", paths:["one.ts"] }).risk, "low_risk");
  assert.equal(classifyRisk({ operation:"write", paths:["one.ts", "two.ts"] }).risk, "managed");
  assert.equal(classifyRisk({ operation:"delete", paths:["one.ts"] }).risk, "human_gate");
  assert.equal(classifyRisk({ operation:"execute", permission_escalation:true }).risk, "human_gate");
});

test("managed writes require a trusted pre-action hook and active task", async (t) => {
  const { root, repository } = await setup(t);
  const intent = { operation:"write", paths:["a.ts", "b.ts"], multi_file:true };
  assert.equal((await gateToolUse(repository, "session-1", intent, { trusted:true, preAction:true })).action, "deny");
  await activeTask(root, repository);
  const deniedWithoutReceipt = await gateToolUse(repository, "session-1", intent, { trusted:true, preAction:true });
  assert.equal(deniedWithoutReceipt.action, "deny");
  const allowed = await gateToolUse(repository, "session-1", intent, { trusted:true, preAction:true, ownershipValid:true });
  assert.equal(allowed.action, "allow");
  assert.equal(allowed.enforcement, "enforced");
  assert.equal((await gateToolUse(repository, "session-1", intent, { trusted:false, preAction:true })).action, "deny");
  assert.equal((await gateToolUse(repository, "session-1", intent, { trusted:true, preAction:false })).action, "deny");
});

test("read-only work remains allowed while human-gated work is never auto-approved", async (t) => {
  const { repository } = await setup(t);
  const read = await gateToolUse(repository, "missing", { operation:"search" }, { trusted:false, preAction:true });
  assert.equal(read.action, "allow");
  assert.equal(read.enforcement, "partial");
  const destructive = await gateToolUse(repository, "missing", { operation:"cancel" }, { trusted:true, preAction:true });
  assert.equal(destructive.action, "ask");
});
