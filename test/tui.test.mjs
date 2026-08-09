import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BoundRunService } from "../dist/lifecycle/run-service.js";
import { TaskRepository } from "../dist/lifecycle/task-repository.js";
import { readTuiSnapshot, runTui } from "../dist/tui/index.js";

test("TUI snapshot uses the shared control status and run repositories", async (t) => {
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
    fetcher:async () => ({ ok:true, status:200, json:async () => ({ version:"0.5.0-alpha.1" }) }),
  });
  assert.equal(snapshot.project.projectRoot, await realpath(project));
  assert.equal(snapshot.project.trellis.taskId, "tui");
  assert.equal(typeof snapshot.project.diagnostics.healthy, "boolean");
  assert.equal(snapshot.run.state, "initialized");
  assert.equal(snapshot.run.run_id, "run-1");
  assert.equal(snapshot.update.updateAvailable, false);
  assert.ok(["global", "unknown"].includes(snapshot.installSource));
});

test("TUI startup tolerates offline update checks while retaining control status", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "mta-tui-offline-"));
  await mkdir(join(project, ".git"));
  t.after(() => rm(project, { recursive:true, force:true }));
  const snapshot = await readTuiSnapshot(project, undefined, undefined, {
    cachePath:join(project, "missing", "cache.json"),
    timeoutMs:20,
    fetcher:async () => { throw new Error("offline"); },
  });
  assert.equal(snapshot.project.projectRoot, await realpath(project));
  assert.equal(snapshot.update, null);
  assert.match(snapshot.updateError, /offline/u);
});

function scriptedIo(answers) {
  const output = [];
  let index = 0;
  return {
    output,
    io:{
      question:async () => {
        if (index >= answers.length) throw new Error("scripted TUI input exhausted");
        return answers[index++];
      },
      write:(value) => output.push(value),
    },
  };
}

function applyPlan() {
  return {
    schemaVersion:1,
    transactionId:"apply-transaction",
    packageVersion:"0.5.0-alpha.1",
    projectRoot:"C:\\project",
    hosts:["claude", "codex"],
    changes:[{ relativePath:".mcp.json", action:"create", beforeHash:null, afterHash:"a".repeat(64), content:"{}\n", originalBase64:null, ownedAfter:true }],
  };
}

function migrationPlan() {
  return {
    schemaVersion:1,
    transactionId:"7bd408df-fb96-4130-b054-433043d79cf9",
    pluginId:"multi-teammates-agents@multi-teammates-agents",
    marketplaceName:"multi-teammates-agents",
    pluginInstalled:true,
    marketplaceInstalled:true,
    staleMcp:true,
    commands:[{ kind:"plugin-remove", command:["codex", "plugin", "remove", "multi-teammates-agents@multi-teammates-agents", "--json"], shell:false }],
  };
}

function updateCheck() {
  return {
    packageName:"multi-teammates-agents",
    currentVersion:"0.5.0-alpha.1",
    latestVersion:"0.5.0-alpha.2",
    updateAvailable:true,
    checkedAt:"2026-08-09T00:00:00.000Z",
    cached:false,
    distTag:"alpha",
  };
}

function updateResult(commit) {
  return {
    transactionId:"ca674659-89a7-4396-a7f6-e8f56e81db38",
    packageName:"multi-teammates-agents",
    currentVersion:"0.5.0-alpha.1",
    targetVersion:"0.5.0-alpha.2",
    updateRequired:true,
    installSource:"global",
    selfUpdateSupported:true,
    cachePath:"C:\\Temp\\mta-npm-update-ca674659-89a7-4396-a7f6-e8f56e81db38",
    command:["npm", "install", "multi-teammates-agents@0.5.0-alpha.2"],
    committed:commit,
    updated:commit,
    rollbackAttempted:false,
    rollbackSucceeded:null,
  };
}

function unapplyPlan() {
  return {
    schemaVersion:1,
    transactionId:"unapply-transaction",
    packageVersion:"0.5.0-alpha.1",
    projectRoot:"C:\\project",
    receiptHash:"b".repeat(64),
    changes:[{ relativePath:".mcp.json", beforeHash:"a".repeat(64), originalBase64:null }],
  };
}

test("TUI previews apply, unapply, update, and migration; cancellation performs zero writes", async () => {
  const { io, output } = scriptedIo([
    "2", "a", "cancel",
    "2", "u", "cancel",
    "3", "cancel",
    "2", "m", "cancel",
    "q",
  ]);
  const commits = { apply:0, unapply:0, update:0, migration:0 };
  const result = await runTui("C:\\project", undefined, {
    io,
    services:{
      applyProject:async (_project, _hosts, commit) => {
        assert.equal(commit, false);
        return applyPlan();
      },
      commitApply:async () => { commits.apply += 1; throw new Error("unexpected commit"); },
      planUnapply:async () => unapplyPlan(),
      commitUnapply:async () => { commits.unapply += 1; throw new Error("unexpected commit"); },
      checkForUpdate:async () => updateCheck(),
      planPackageUpdate:async () => updateResult(false),
      commitPackageUpdate:async () => { commits.update += 1; throw new Error("unexpected commit"); },
      probeMarketplaceMigration:async () => ({
        schemaVersion:1,
        pluginId:"multi-teammates-agents@multi-teammates-agents",
        marketplaceName:"multi-teammates-agents",
        pluginInstalled:true,
        marketplaceInstalled:true,
        staleMcp:true,
      }),
      planMarketplaceMigration:() => migrationPlan(),
      commitMarketplaceMigration:async () => { commits.migration += 1; throw new Error("unexpected commit"); },
    },
  });
  assert.equal(result, 0);
  assert.deepEqual(commits, { apply:0, unapply:0, update:0, migration:0 });
  assert.match(output.join(""), /Apply preview/u);
  assert.match(output.join(""), /Unapply preview/u);
  assert.match(output.join(""), /Update preview/u);
  assert.match(output.join(""), /Migration preview/u);
});

test("TUI explicit confirmations commit the previewed plans", async () => {
  const { io, output } = scriptedIo([
    "2", "a", "APPLY",
    "2", "u", "UNAPPLY",
    "3", "UPDATE",
    "2", "m", "MIGRATE",
    "q",
  ]);
  const frozenApply = applyPlan();
  const frozenMigration = migrationPlan();
  const frozenUnapply = unapplyPlan();
  const unapplyCommits = [];
  const updateCommits = [];
  let committedApply;
  let committedMigration;
  let committedUpdate;
  const frozenUpdate = updateResult(false);
  await runTui("C:\\project", undefined, {
    io,
    services:{
      applyProject:async () => frozenApply,
      commitApply:async (plan) => {
        committedApply = plan;
        return { ...plan, appliedAt:"2026-08-09T00:00:00.000Z", files:[] };
      },
      planUnapply:async () => { unapplyCommits.push("plan"); return frozenUnapply; },
      commitUnapply:async (plan) => { unapplyCommits.push(plan); return { projectRoot:"C:\\project", changed:true, wouldRemove:[".mcp.json"] }; },
      checkForUpdate:async () => updateCheck(),
      planPackageUpdate:async (options) => {
        updateCommits.push({ commit:false, targetVersion:options.targetVersion });
        return frozenUpdate;
      },
      commitPackageUpdate:async (plan) => {
        committedUpdate = plan;
        updateCommits.push({ commit:true, targetVersion:plan.targetVersion });
        return { ...plan, committed:true, updated:true };
      },
      probeMarketplaceMigration:async () => ({
        schemaVersion:1,
        pluginId:"multi-teammates-agents@multi-teammates-agents",
        marketplaceName:"multi-teammates-agents",
        pluginInstalled:true,
        marketplaceInstalled:true,
        staleMcp:true,
      }),
      planMarketplaceMigration:() => frozenMigration,
      commitMarketplaceMigration:async (plan) => {
        committedMigration = plan;
        return { ...frozenMigration, committed:true, succeeded:true, commandResults:[] };
      },
    },
  });
  assert.equal(committedApply, frozenApply);
  assert.equal(committedMigration, frozenMigration);
  assert.equal(committedUpdate, frozenUpdate);
  assert.deepEqual(unapplyCommits, ["plan", frozenUnapply]);
  assert.deepEqual(updateCommits, [
    { commit:false, targetVersion:"0.5.0-alpha.2" },
    { commit:true, targetVersion:"0.5.0-alpha.2" },
  ]);
  assert.match(output.join(""), /Restart Codex and Claude, then run Apply again/u);
  assert.match(output.join(""), /Channel: alpha/u);
});

test("TUI renders Overview before the first menu choice", async () => {
  const { io, output } = scriptedIo(["q"]);
  await runTui("C:\\project", undefined, {
    io,
    services:{
      readControlStatus:async () => ({
        packageVersion:"0.5.0-alpha.1", projectRoot:"C:\\project", applied:false,
        receiptPath:"C:\\project\\.mta\\apply-receipt.json", receiptValid:null, hosts:[], ownedPaths:[],
        driftedPaths:[], ownershipValid:false,
        integrations:{ codex:{ installed:false, trusted:null, enforced:false }, claude:{ installed:false, trusted:null, enforced:false } },
        trellis:{ bound:false, sessionId:null, taskId:null, taskPath:null, taskStatus:null, error:null },
        diagnostics:{ packageVersion:"0.5.0-alpha.1", requiredNode:">=22", projectRoot:"C:\\project", healthy:true, probes:[] },
      }),
      checkForUpdate:async () => updateCheck(),
      detectInstallSource:async () => "global",
    },
  });
  const rendered = output.join("");
  assert.match(rendered, /=== Overview ===/u);
  assert.match(rendered, /Version: 0\.5\.0-alpha\.1/u);
  assert.match(rendered, /Install source: global/u);
  assert.match(rendered, /Update \(alpha\)/u);
});
