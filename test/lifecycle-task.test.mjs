import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LifecycleError, TaskRepository } from "../dist/lifecycle/task-repository.js";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "mta-lifecycle-"));
  await mkdir(join(root, ".git"));
  t.after(() => rm(root, { recursive:true, force:true }));
  return { root, repository:await TaskRepository.open(root) };
}

async function fillPlanning(root, taskPath) {
  const directory = join(root, ...taskPath.split("/"));
  await writeFile(join(directory, "prd.md"), "# PRD\n\n## Goal\n\nImplement the approved lifecycle behavior with tests.\n");
  await writeFile(join(directory, "design.md"), "# Design\n\nUse one repository and an atomic session pointer boundary.\n");
  await writeFile(join(directory, "implement.md"), "# Plan\n\n- [ ] Implement repository\n- [ ] Verify lifecycle\n");
}

test("create is planning and placeholder artifacts cannot be started", async (t) => {
  const { repository } = await setup(t);
  const created = await repository.create("Lifecycle Task", { slug:"lifecycle-task" });
  assert.equal(created.task.status, "planning");
  await assert.rejects(repository.start("lifecycle-task", "session-1"), /placeholder/u);
  assert.equal(await repository.current("session-1"), null);
});

test("start binds one session and changes planning to in_progress", async (t) => {
  const { root, repository } = await setup(t);
  const created = await repository.create("Lifecycle Task", { slug:"lifecycle-task" });
  await fillPlanning(root, created.path);
  const pointer = await repository.start("lifecycle-task", "session-1", "codex");
  assert.equal(pointer.project_root, root);
  const current = await repository.requireActive("session-1");
  assert.equal(current.task.status, "in_progress");
  assert.equal(current.pointer.host, "codex");
  assert.equal(await repository.finish("session-1"), true);
  assert.equal(await repository.finish("session-1"), false);
});

test("cross-workspace and escaping pointers fail closed", async (t) => {
  const { root, repository } = await setup(t);
  const created = await repository.create("Lifecycle Task", { slug:"lifecycle-task" });
  await fillPlanning(root, created.path);
  await repository.start("lifecycle-task", "session-1");
  const pointerPath = join(root, ".mta", "sessions", "session-1.json");
  const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  await writeFile(pointerPath, JSON.stringify({ ...pointer, project_root:join(root, "other") }));
  await assert.rejects(repository.current("session-1"), /another workspace/u);
  await writeFile(pointerPath, JSON.stringify({ ...pointer, task_path:"../escape" }));
  await assert.rejects(repository.current("session-1"), /escapes/u);
  await assert.rejects(repository.start("../escape", "session-2"), LifecycleError);
});

test("archive marks completed, moves under the month, and clears the session pointer", async (t) => {
  const { root, repository } = await setup(t);
  const created = await repository.create("Lifecycle Task", { slug:"lifecycle-task" });
  await fillPlanning(root, created.path);
  await repository.start("lifecycle-task", "session-1");
  const archivedPath = await repository.archive("lifecycle-task", "session-1");
  assert.match(archivedPath, /^\.trellis\/tasks\/archive\/\d{4}-\d{2}\//u);
  const task = JSON.parse(await readFile(join(root, ...archivedPath.split("/"), "task.json"), "utf8"));
  assert.equal(task.status, "completed");
  assert.equal(await repository.current("session-1"), null);
  await assert.rejects(readFile(join(root, ...created.path.split("/"), "task.json"), "utf8"));
});
