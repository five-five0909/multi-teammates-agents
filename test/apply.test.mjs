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
    assert.deepEqual(receipt.files.map((file) => file.relativePath), [".mta/runtime.json", ".mcp.json", ".codex/hooks.json", "AGENTS.md"]);
    const secondPlan = await planApply(project, ["codex"]);
    assert.equal(secondPlan.changes[0].action, "unchanged");
    await commitApply(secondPlan);
    const runtime = JSON.parse(await readFile(join(project, ".mta", "runtime.json"), "utf8"));
    assert.deepEqual(runtime.hosts, ["codex"]);
    const hooks = JSON.parse(await readFile(join(project, ".codex", "hooks.json"), "utf8"));
    assert.equal(hooks.hooks.PreToolUse[0].hooks[0].command, "mta hook dispatch --host codex");
    const mcp = JSON.parse(await readFile(join(project, ".mcp.json"), "utf8"));
    assert.deepEqual(mcp.mcpServers["expert-team"].args, ["mcp", "serve", "--project", project]);
    assert.match(await readFile(join(project, "AGENTS.md"), "utf8"), /mta:lifecycle:start/u);
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
    await assert.rejects(readFile(join(project, ".codex", "hooks.json")), { code: "ENOENT" });
    const settings = JSON.parse(await readFile(join(project, ".claude", "settings.json"), "utf8"));
    assert.deepEqual(settings.hooks.PreToolUse[0].hooks[0].args, ["hook", "dispatch", "--host", "claude"]);
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
    assert.deepEqual(preview.wouldRemove, [".mta/runtime.json", ".mcp.json", ".codex/hooks.json", "AGENTS.md", ".claude/settings.json", "CLAUDE.md"]);

    const runtimePath = join(project, ".mta", "runtime.json");
    await writeFile(runtimePath, "user changed this");
    await assert.rejects(unapplyProject(project, true), /preserving user changes/u);
    assert.equal(await readFile(runtimePath, "utf8"), "user changed this");
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("apply preserves unrelated host settings and unapply restores exact originals", async () => {
  const project = await makeProject();
  try {
    await mkdir(join(project, ".codex"));
    const hookPath = join(project, ".codex", "hooks.json");
    const original = `${JSON.stringify({ description: "user hooks", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo user" }] }] } }, null, 2)}\n`;
    await writeFile(hookPath, original);
    await commitApply(await planApply(project, ["codex"]));
    const applied = JSON.parse(await readFile(hookPath, "utf8"));
    assert.equal(applied.hooks.Stop[0].hooks[0].command, "echo user");
    assert.equal(applied.hooks.Stop[1].hooks[0].command, "mta hook dispatch --host codex");
    await unapplyProject(project, true);
    assert.equal(await readFile(hookPath, "utf8"), original);
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
