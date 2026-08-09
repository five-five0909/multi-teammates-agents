import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { commitLegacyDetach, legacyDetach, planLegacyDetach } from "../dist/control/legacy.js";

test("legacy detach removes only exact Python hook and MCP entries", async () => {
  const project = await mkdtemp(join(tmpdir(), "mta-legacy-"));
  await mkdir(join(project, ".git"));
  await mkdir(join(project, ".codex"));
  try {
    const hookPath = join(project, ".codex", "hooks.json");
    await writeFile(hookPath, JSON.stringify({ hooks:{ PreToolUse:[{ hooks:[
      { type:"command", command:"python hooks/expert_team_entry.py" },
      { type:"command", command:"node user-policy.mjs" },
    ] }] } }));
    await writeFile(join(project, ".mcp.json"), JSON.stringify({ mcpServers:{
      "expert-team":{ command:"node", args:["scripts/expert_team_mcp_launcher.js"] },
      user:{ command:"node", args:["server.mjs"] },
    } }));
    const preview = await planLegacyDetach(project);
    assert.equal(preview.removedEntries, 2);
    assert.match(await readFile(hookPath, "utf8"), /expert_team_entry/u);
    await legacyDetach(project, true);
    const hooks = JSON.parse(await readFile(hookPath, "utf8"));
    assert.equal(hooks.hooks.PreToolUse[0].hooks[0].command, "node user-policy.mjs");
    const mcp = JSON.parse(await readFile(join(project, ".mcp.json"), "utf8"));
    assert.deepEqual(Object.keys(mcp.mcpServers), ["user"]);
    const receipt = JSON.parse(await readFile(join(project, ".mta", "legacy-detach-receipt.json"), "utf8"));
    assert.equal(receipt.files.length, 2);
  } finally {
    await rm(project, { recursive:true, force:true });
  }
});

test("legacy detach rolls back all shared configs on partial failure", async () => {
  const project = await mkdtemp(join(tmpdir(), "mta-legacy-rollback-"));
  await mkdir(join(project, ".git"));
  await mkdir(join(project, ".codex"));
  try {
    const hookPath = join(project, ".codex", "hooks.json");
    const original = JSON.stringify({ hooks:{ Stop:[{ hooks:[{ type:"command", command:"python hooks/expert_team_entry.py" }] }] } });
    await writeFile(hookPath, original);
    await writeFile(join(project, ".mcp.json"), JSON.stringify({ mcpServers:{ "expert-team":{ command:"python", args:["expert_team.py"] } } }));
    await assert.rejects(commitLegacyDetach(await planLegacyDetach(project), { failAfterWrites:1 }), /injected/u);
    assert.equal(await readFile(hookPath, "utf8"), original);
  } finally {
    await rm(project, { recursive:true, force:true });
  }
});
