import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

import { resolveCommand } from "../dist/platform/probe.js";

const packageName = "multi-teammates-agents";
const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "mta-pack-install-"));
const prefix = join(temporary, "prefix");
const project = join(temporary, "project space");
const packDirectory = join(temporary, "pack");
const toolDirectory = join(temporary, "tools");
const npmEnvironment = {
  ...process.env,
  npm_config_cache:join(temporary, "npm-cache"),
  NPM_CONFIG_CACHE:join(temporary, "npm-cache"),
};

function appendBounded(current, chunk, limit = 1_000_000) {
  const next = current + chunk;
  return next.length > limit ? next.slice(-limit) : next;
}

function run(executable, args, { cwd = root, env = process.env, stdin = "" } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(executable, args, { cwd, env, shell:false, windowsHide:true, stdio:["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.once("error", rejectRun);
    child.once("close", (code) => resolveRun({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

async function runChecked(executable, args, options) {
  const result = await run(executable, args, options);
  assert.equal(result.code, 0, `${executable} ${args.join(" ")}\n${result.stderr}\n${result.stdout}`);
  return result;
}

async function npm(args, options) {
  const command = await npmCommand(options?.env ?? process.env);
  return runChecked(command.executable, [...command.prefixArgs, ...args], options);
}

async function npmCommand(environment) {
  const injected = environment.MTA_SMOKE_NPM_CLI;
  if (injected) return { executable:process.execPath, prefixArgs:[injected] };
  return resolveCommand("npm", environment);
}

async function installed(alias, args, options = {}) {
  const command = await resolveCommand(alias, options.env ?? cleanEnvironment);
  return runChecked(command.executable, [...command.prefixArgs, ...args], { ...options, env:options.env ?? cleanEnvironment });
}

function assertPackWhitelist(files) {
  const exact = new Set([
    "package.json", "README.md", "README_zh.md", "docs/npm-only-control-plane.md", "LICENSE", "THIRD_PARTY_NOTICES.md",
  ]);
  const prefixes = ["bin/", "dist/", "schemas/mta/", "skills/expert-team/", "agents/"];
  for (const file of files) {
    assert.ok(exact.has(file) || prefixes.some((prefixPath) => file.startsWith(prefixPath)), `unexpected tarball file: ${file}`);
    assert.doesNotMatch(file, /(?:^|\/)tests?(?:\/|$)|\.py$/u);
    assert.doesNotMatch(file, /^schemas\/(?!mta\/)/u);
    assert.ok(!file.endsWith(".ts") || file.endsWith(".d.ts"), `source TypeScript entered tarball: ${file}`);
  }
  assert.ok(files.includes("bin/mta.js"));
  assert.ok(files.includes("skills/expert-team/SKILL.md"));
  assert.ok(files.includes("agents/software-engineer.md"));
  assert.ok(files.includes("docs/npm-only-control-plane.md"));
  assert.ok(!files.includes("bin/mta-plugin-mcp.js"));
  assert.ok(!files.includes(".codex-plugin/plugin.json"));
  assert.ok(!files.includes(".claude-plugin/plugin.json"));
  assert.ok(!files.includes(".mcp.json"));
  assert.ok(files.some((file) => file === "dist/cli/index.js"));
}

let cleanEnvironment;
try {
  await mkdir(packDirectory, { recursive:true });
  const packed = JSON.parse((await npm(["pack", "--json", "--pack-destination", packDirectory], { env:npmEnvironment })).stdout);
  assert.equal(packed.length, 1);
  assertPackWhitelist(packed[0].files.map((file) => file.path));
  const tarball = join(packDirectory, packed[0].filename);
  await npm(["install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", tarball], { env:npmEnvironment });

  const binDirectory = process.platform === "win32" ? prefix : join(prefix, "bin");
  const installRoot = await realpath(process.platform === "win32"
    ? join(prefix, "node_modules", packageName)
    : join(prefix, "lib", "node_modules", packageName));
  await mkdir(toolDirectory, { recursive:true });
  if (process.platform !== "win32") await symlink("/bin/sh", join(toolDirectory, "sh"));
  cleanEnvironment = {
    ...npmEnvironment,
    PATH:[binDirectory, dirname(process.execPath), toolDirectory].join(delimiter),
    Path:undefined,
    npm_config_cache:join(temporary, "npm-cache"),
    NPM_CONFIG_CACHE:join(temporary, "npm-cache"),
  };
  for (const excluded of ["python", "python3", "py", "cargo", "rustc"]) {
    await assert.rejects(resolveCommand(excluded, cleanEnvironment), /not found on PATH/u);
  }
  assert.equal((await installed("mta", ["--version"])).stdout.trim(), "0.5.0-alpha.2");
  assert.equal((await installed("multi-teammates-agents", ["--version"])).stdout.trim(), "0.5.0-alpha.2");
  const initialize = `${JSON.stringify({ jsonrpc:"2.0", id:1, method:"initialize", params:{} })}\n`;

  const oneTimeNpm = await npmCommand(npmEnvironment);
  const npxEnvironment = { ...cleanEnvironment, PATH:[dirname(process.execPath), toolDirectory].join(delimiter), Path:undefined };
  const oneTime = await runChecked(oneTimeNpm.executable, [...oneTimeNpm.prefixArgs, "exec", "--yes", "--ignore-scripts", "--package", tarball, "--", "mta", "--version"], { env:npxEnvironment });
  assert.equal(oneTime.stdout.trim(), "0.5.0-alpha.2");

  await mkdir(join(project, ".git"), { recursive:true });
  const applied = JSON.parse((await installed("mta", ["apply", "--project", project, "--yes", "--json"])).stdout);
  assert.deepEqual(applied.hosts, ["claude", "codex"]);
  assert.match(await readFile(join(project, ".agents", "skills", "expert-team", "SKILL.md"), "utf8"), /name: expert-team/u);
  assert.match(await readFile(join(project, ".claude", "skills", "expert-team", "SKILL.md"), "utf8"), /name: expert-team/u);
  assert.match(await readFile(join(project, ".claude", "agents", "software-engineer.md"), "utf8"), /name: software-engineer/u);
  const codexHooks = JSON.parse(await readFile(join(project, ".codex", "hooks.json"), "utf8")).hooks;
  const contextEvents = new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart"]);
  for (const [event, groups] of Object.entries(codexHooks)) {
    const handler = groups.at(-1).hooks[0];
    assert.equal(Object.hasOwn(handler, "additionalContextLimit"), contextEvents.has(event));
  }
  const claudeSettings = JSON.parse(await readFile(join(project, ".claude", "settings.json"), "utf8"));
  const claudeHook = claudeSettings.hooks.SessionStart[0].hooks[0];
  assert.equal(claudeHook.command, process.execPath);
  assert.equal(await realpath(claudeHook.args[0]), join(installRoot, "bin", "mta.js"));
  const status = JSON.parse((await installed("mta", ["status", "--project", project, "--json"])).stdout);
  assert.equal(status.ownershipValid, true);
  assert.equal(status.trellis.bound, false);
  assert.equal(status.diagnostics.probes.some((probe) => probe.command === "mta mcp initialize" && probe.available), true);
  const hookInput = JSON.stringify({ session_id:"pack-smoke", cwd:project, hook_event_name:"SessionStart" });
  const hook = JSON.parse((await installed("mta", ["hook", "dispatch", "--host", "codex", "--project", project], { stdin:hookInput })).stdout);
  assert.match(hook.hookSpecificOutput.additionalContext, /no active task/u);
  const claudeHookResult = JSON.parse((await runChecked(claudeHook.command, claudeHook.args, { cwd:project, env:cleanEnvironment, stdin:hookInput })).stdout);
  assert.match(claudeHookResult.hookSpecificOutput.additionalContext, /no active task/u);
  const projectMcp = JSON.parse(await readFile(join(project, ".mcp.json"), "utf8")).mcpServers["expert-team"];
  assert.equal(projectMcp.command, process.execPath);
  assert.equal(await realpath(projectMcp.args[0]), join(installRoot, "bin", "mta.js"));
  const mcp = JSON.parse((await runChecked(projectMcp.command, projectMcp.args, { cwd:project, env:cleanEnvironment, stdin:initialize })).stdout.trim());
  assert.equal(mcp.result.serverInfo.name, "expert-team");
  const unapplied = JSON.parse((await installed("mta", ["unapply", "--project", project, "--yes", "--json"])).stdout);
  assert.equal(unapplied.changed, true);
  await assert.rejects(readFile(join(project, ".mta", "apply-receipt.json")), { code:"ENOENT" });
  await assert.rejects(readFile(join(project, ".agents", "skills", "expert-team", "SKILL.md")), { code:"ENOENT" });
  await assert.rejects(readFile(join(project, ".claude", "skills", "expert-team", "SKILL.md")), { code:"ENOENT" });
  await assert.rejects(readFile(join(project, ".claude", "agents", "software-engineer.md")), { code:"ENOENT" });

  process.stdout.write(`${JSON.stringify({ package:packageName, tarball, files:packed[0].files.length, pythonOnPath:false, cargoOnPath:false, aliases:["mta", "multi-teammates-agents"], lifecycle:"passed" })}\n`);
} finally {
  await rm(temporary, { recursive:true, force:true });
}
