import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BoundRunService } from "../dist/lifecycle/run-service.js";
import { TaskRepository } from "../dist/lifecycle/task-repository.js";
import { readTuiSnapshot } from "../dist/tui/index.js";

test("TUI snapshot reads the same project and run repositories as CLI and MCP", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "mta-tui-"));
  const cachePath = join(project, "cache", "update.json");
  await mkdir(join(project, ".git"));
  t.after(() => rm(project, { recursive:true, force:true }));
  const tasks = await TaskRepository.open(project);
  const created = await tasks.create("TUI", { slug:"tui" });
  const taskDir = join(project, ...created.path.split("/"));
  for (const name of ["prd.md", "design.md", "implement.md"]) await writeFile(join(taskDir, name), `# ${name}\n\nReviewed TUI contract with concrete implementation and verification details.\n`);
  await tasks.start("tui", "tui-session", "codex");
  const service = await BoundRunService.open(project, "tui-session", "test");
  await service.start("run-1", { schema_version:1, goal:"TUI", constraints:[], deliverables:["view"], acceptance_criteria:["shared"] }, [{
    schema_version:1, id:"one", objective:"View", role:"executor", mode:"read", required:true, depends_on:[], ownership:[], evidence_required:[], executor_id:null, attempt:0, status:"pending",
  }]);
  const snapshot = await readTuiSnapshot(project, "tui-session", "run-1", {
    cachePath,
    fetcher:async () => ({ ok:true, status:200, json:async () => ({ version:"0.5.0-alpha.0" }) }),
  });
  assert.equal(snapshot.project.projectRoot, project);
  assert.equal(snapshot.run.state, "initialized");
  assert.equal(snapshot.run.run_id, "run-1");
  assert.equal(snapshot.update.updateAvailable, false);
});

test("TUI startup tolerates offline update checks", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "mta-tui-offline-"));
  await mkdir(join(project, ".git"));
  t.after(() => rm(project, { recursive:true, force:true }));
  const snapshot = await readTuiSnapshot(project, undefined, undefined, {
    cachePath:join(project, "missing", "cache.json"),
    timeoutMs:20,
    fetcher:async () => { throw new Error("offline"); },
  });
  assert.equal(snapshot.project.projectRoot, project);
  assert.equal(snapshot.update, null);
  assert.match(snapshot.updateError, /offline/u);
});
