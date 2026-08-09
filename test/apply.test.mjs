import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  commitApply,
  planApply,
  unapplyProject,
} from "../dist/control/apply.js";

async function makeProject() {
  const project = await mkdtemp(join(tmpdir(), "mta-apply-项目-"));
  await mkdir(join(project, ".git"));
  return project;
}

test("apply dry-run is read-only and commit is idempotent", async () => {
  const project = await makeProject();
  try {
    const firstPlan = await planApply(project, ["codex"]);
    assert.equal(firstPlan.changes[0].action, "create");
    await assert.rejects(readFile(join(project, ".mta", "runtime.json")), { code: "ENOENT" });

    const receipt = await commitApply(firstPlan, { now: () => new Date("2026-08-09T00:00:00Z") });
    assert.equal(receipt.hosts[0], "codex");
    const secondPlan = await planApply(project, ["codex"]);
    assert.equal(secondPlan.changes[0].action, "unchanged");
    await commitApply(secondPlan);
    const runtime = JSON.parse(await readFile(join(project, ".mta", "runtime.json"), "utf8"));
    assert.deepEqual(runtime.hosts, ["codex"]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("an owned runtime can be atomically updated", async () => {
  const project = await makeProject();
  try {
    await commitApply(await planApply(project, ["codex"]));
    const update = await planApply(project, ["claude"]);
    assert.equal(update.changes[0].action, "update");
    await commitApply(update);
    const runtime = JSON.parse(await readFile(join(project, ".mta", "runtime.json"), "utf8"));
    assert.deepEqual(runtime.hosts, ["claude"]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("apply rejects concurrent drift before committing", async () => {
  const project = await makeProject();
  try {
    const plan = await planApply(project, ["claude"]);
    await mkdir(join(project, ".mta"));
    await writeFile(join(project, ".mta", "runtime.json"), "user content");
    await assert.rejects(commitApply(plan), /changed after planning/u);
    assert.equal(await readFile(join(project, ".mta", "runtime.json"), "utf8"), "user content");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("apply rolls back a partial transaction failure", async () => {
  const project = await makeProject();
  try {
    const plan = await planApply(project, []);
    await assert.rejects(commitApply(plan, { failAfterWrites: 1 }), /injected/u);
    await assert.rejects(readFile(join(project, ".mta", "runtime.json")), { code: "ENOENT" });
    await assert.rejects(readFile(join(project, ".mta", "apply-receipt.json")), { code: "ENOENT" });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("unapply removes only unchanged owned files and preserves drift", async () => {
  const project = await makeProject();
  try {
    await commitApply(await planApply(project, []));
    const preview = await unapplyProject(project, false);
    assert.equal(preview.changed, false);
    assert.deepEqual(preview.wouldRemove, [".mta/runtime.json"]);

    const runtimePath = join(project, ".mta", "runtime.json");
    await writeFile(runtimePath, "user changed this");
    await assert.rejects(unapplyProject(project, true), /preserving user changes/u);
    assert.equal(await readFile(runtimePath, "utf8"), "user changed this");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("unapply commit removes an unchanged owned runtime and its receipt", async () => {
  const project = await makeProject();
  try {
    await commitApply(await planApply(project, []));
    const result = await unapplyProject(project, true);
    assert.equal(result.changed, true);
    await assert.rejects(readFile(join(project, ".mta", "runtime.json")), { code: "ENOENT" });
    await assert.rejects(readFile(join(project, ".mta", "apply-receipt.json")), { code: "ENOENT" });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("legacy Python entry blocks apply without deleting it", async () => {
  const project = await makeProject();
  try {
    await mkdir(join(project, ".codex"));
    const hookPath = join(project, ".codex", "hooks.json");
    await writeFile(hookPath, JSON.stringify({ command: "python hooks/expert_team_entry.py" }));
    await assert.rejects(planApply(project, []), /legacy Python entry conflicts/u);
    assert.match(await readFile(hookPath, "utf8"), /expert_team_entry/u);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
