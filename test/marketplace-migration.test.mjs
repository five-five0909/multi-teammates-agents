import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_MARKETPLACE_NAME,
  LEGACY_PLUGIN_ID,
  commitMarketplaceMigration,
  planMarketplaceMigration,
  probeMarketplaceMigration,
} from "../dist/control/marketplace-migration.js";

function probeRunner({ plugins = [], marketplaces = [], mcps = [], failAt } = {}) {
  const calls = [];
  return {
    calls,
    runner:async (request) => {
      calls.push(request);
      if (calls.length === failAt) return { exitCode:2, stdout:"", stderr:"command failed" };
      if (request.command.join(" ") === "codex plugin list --json") {
        return { exitCode:0, stdout:JSON.stringify({ installed:plugins, available:[] }), stderr:"" };
      }
      if (request.command.join(" ") === "codex plugin marketplace list --json") {
        return { exitCode:0, stdout:JSON.stringify({ marketplaces }), stderr:"" };
      }
      return { exitCode:0, stdout:JSON.stringify(mcps), stderr:"" };
    },
  };
}

async function probeAndPlan(fixture) {
  const fake = probeRunner(fixture);
  const probe = await probeMarketplaceMigration({ runner:fake.runner, cwd:"C:\\fixture" });
  return { fake, probe, plan:planMarketplaceMigration(probe) };
}

test("no legacy installation produces an empty read-only cleanup plan", async () => {
  const { fake, probe, plan } = await probeAndPlan({
    plugins:[{ pluginId:"other@other", installed:true }],
    marketplaces:[{ name:"other" }],
  });
  assert.equal(probe.pluginInstalled, false);
  assert.equal(probe.marketplaceInstalled, false);
  assert.equal(probe.staleMcp, false);
  assert.deepEqual(plan.commands, []);
  assert.deepEqual(fake.calls.map((call) => call.command), [
    ["codex", "plugin", "list", "--json"],
    ["codex", "plugin", "marketplace", "list", "--json"],
    ["codex", "mcp", "list", "--json"],
  ]);
  assert.ok(fake.calls.every((call) => call.shell === false));
});

test("plugin-only installation freezes only the exact official plugin remove", async () => {
  const { plan } = await probeAndPlan({ plugins:[{ pluginId:LEGACY_PLUGIN_ID, installed:true }] });
  assert.deepEqual(plan.commands, [{
    kind:"plugin-remove",
    command:["codex", "plugin", "remove", LEGACY_PLUGIN_ID, "--json"],
    shell:false,
  }]);
});

test("marketplace-only installation freezes only the exact official marketplace remove", async () => {
  const { plan } = await probeAndPlan({ marketplaces:[{ name:LEGACY_MARKETPLACE_NAME }] });
  assert.deepEqual(plan.commands, [{
    kind:"marketplace-remove",
    command:["codex", "plugin", "marketplace", "remove", LEGACY_MARKETPLACE_NAME, "--json"],
    shell:false,
  }]);
});

test("stale plugin-cache MCP is detected and frozen without matching a user-owned expert-team server", async () => {
  const legacy = await probeAndPlan({ mcps:[{
    name:"expert-team",
    transport:{ type:"stdio", command:"node", args:["-e", "import(root + 'bin/mta-plugin-mcp.js')"], cwd:"C:\\Users\\test\\.codex\\plugins\\cache\\multi-teammates-agents\\multi-teammates-agents\\0.5.0-alpha.0" },
  }] });
  assert.equal(legacy.probe.staleMcp, true);
  assert.deepEqual(legacy.plan.commands, [{ kind:"mcp-remove", command:["codex", "mcp", "remove", "expert-team"], shell:false }]);

  const custom = await probeAndPlan({ mcps:[{
    name:"expert-team",
    transport:{ type:"stdio", command:"node", args:["C:\\custom\\mta-plugin-mcp.js"], cwd:"C:\\custom" },
  }] });
  assert.equal(custom.probe.staleMcp, false);
  assert.deepEqual(custom.plan.commands, []);
});

test("dual installation commits plugin removal before marketplace removal with shell disabled", async () => {
  const { plan } = await probeAndPlan({
    plugins:[{ pluginId:LEGACY_PLUGIN_ID }],
    marketplaces:[{ name:LEGACY_MARKETPLACE_NAME }],
  });
  const calls = [];
  const result = await commitMarketplaceMigration(plan, { runner:async (request) => {
    calls.push(request);
    return { exitCode:0, stdout:"{}", stderr:"" };
  } });
  assert.equal(result.succeeded, true);
  assert.deepEqual(calls.map((call) => call.command), [
    ["codex", "plugin", "remove", LEGACY_PLUGIN_ID, "--json"],
    ["codex", "plugin", "marketplace", "remove", LEGACY_MARKETPLACE_NAME, "--json"],
  ]);
  assert.ok(calls.every((call) => call.shell === false));
});

test("a failed plugin command stops before marketplace removal and preserves the exact error", async () => {
  const { plan } = await probeAndPlan({
    plugins:[{ pluginId:LEGACY_PLUGIN_ID }],
    marketplaces:[{ name:LEGACY_MARKETPLACE_NAME }],
  });
  const calls = [];
  const result = await commitMarketplaceMigration(plan, { runner:async (request) => {
    calls.push(request);
    return { exitCode:7, stdout:"", stderr:"permission denied" };
  } });
  assert.equal(result.succeeded, false);
  assert.equal(calls.length, 1);
  assert.match(result.error, /permission denied/u);
  assert.equal(result.commandResults[0].exitCode, 7);
});

test("strict probe and plan validation reject unknown fields and forged identities", async () => {
  const validProbe = {
    schemaVersion:1,
    pluginId:LEGACY_PLUGIN_ID,
    marketplaceName:LEGACY_MARKETPLACE_NAME,
    pluginInstalled:true,
    marketplaceInstalled:false,
    staleMcp:false,
  };
  assert.throws(() => planMarketplaceMigration({ ...validProbe, surprise:true }), /unrecognized|unknown/iu);
  assert.throws(() => planMarketplaceMigration({ ...validProbe, pluginId:"other@other" }), /invalid|expected/iu);

  const validPlan = planMarketplaceMigration(validProbe);
  await assert.rejects(commitMarketplaceMigration({ ...validPlan, surprise:true }, { runner:async () => {
    throw new Error("runner must not execute");
  } }), /unrecognized|unknown/iu);
  await assert.rejects(commitMarketplaceMigration({ ...validPlan, marketplaceName:"other" }, { runner:async () => {
    throw new Error("runner must not execute");
  } }), /invalid|expected/iu);
  await assert.rejects(commitMarketplaceMigration({
    ...validPlan,
    commands:[{ ...validPlan.commands[0], command:["codex", "plugin", "remove", "other@other", "--json"] }],
  }), /frozen legacy identities/u);
});

test("read-only probe exposes command failures without fabricating absence", async () => {
  const fake = probeRunner({ failAt:1 });
  await assert.rejects(probeMarketplaceMigration({ runner:fake.runner }), /command failed/u);
  assert.equal(fake.calls.length, 1);
});
