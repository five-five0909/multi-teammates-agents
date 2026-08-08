#!/usr/bin/env node
"use strict";

/*
 * Generate a CC Switch MCP entry for the checkout that contains this file.
 *
 * CC Switch stores the command as a local configuration.  The generated
 * launcher path is therefore intentionally resolved at install time, rather
 * than committing a user's drive letter, home directory, or plugin cache
 * layout to the repository.  The output is dependency-free and works on
 * Windows, Ubuntu, and WSL with Node 12+.
 */

var fs = require("fs");
var path = require("path");

var VALID_APPS = new Set(["claude", "codex", "gemini", "opencode"]);
var DEFAULT_APPS = ["claude"];

function usage() {
  return [
    "Usage:",
    "  node scripts/expert_team_ccswitch_config.js --json [--root <path>]",
    "  node scripts/expert_team_ccswitch_config.js --server-json [--root <path>]",
    "  node scripts/expert_team_ccswitch_config.js --deeplink [--apps <list>] [--root <path>]",
    "",
    "Options:",
    "  --json       Print a complete mcpServers JSON object (default).",
    "  --server-json Print only the server object for a CC Switch custom form.",
    "  --deeplink   Print a ccswitch:// import link for the generated server.",
    "  --apps       Comma-separated CC Switch targets; defaults to claude.",
    "  --root       Explicit plugin root; otherwise locate this checkout.",
  ].join("\n");
}

function fail(message) {
  process.stderr.write("Expert Team CC Switch config: " + message + "\n\n" + usage() + "\n");
  process.exitCode = 2;
}

function hasLauncher(root) {
  return fs.existsSync(path.join(root, "scripts", "expert_team_mcp_launcher.js"));
}

function resolveRoot(explicitRoot) {
  var candidates = [];
  if (explicitRoot) {
    candidates.push(explicitRoot);
  }
  if (process.env.PLUGIN_ROOT) {
    candidates.push(process.env.PLUGIN_ROOT);
  }
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    candidates.push(process.env.CLAUDE_PLUGIN_ROOT);
  }
  candidates.push(process.cwd());
  candidates.push(path.resolve(__dirname, ".."));

  for (var index = 0; index < candidates.length; index += 1) {
    var candidate = path.resolve(candidates[index]);
    if (hasLauncher(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "cannot find the plugin root; run this command from the repository or pass --root <path>",
  );
}

function parseArgs(argv) {
  var result = { format: "json", apps: DEFAULT_APPS.slice(), root: null };
  for (var index = 0; index < argv.length; index += 1) {
    var argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      process.stdout.write(usage() + "\n");
      process.exit(0);
    }
    if (argument === "--json") {
      result.format = "json";
      continue;
    }
    if (argument === "--server-json") {
      result.format = "server-json";
      continue;
    }
    if (argument === "--deeplink") {
      result.format = "deeplink";
      continue;
    }
    if (argument === "--root" || argument === "--apps") {
      if (index + 1 >= argv.length) {
        throw new Error(argument + " requires a value");
      }
      var value = argv[index + 1];
      index += 1;
      if (argument === "--root") {
        result.root = value;
      } else {
        result.apps = parseApps(value);
      }
      continue;
    }
    if (argument.indexOf("--root=") === 0) {
      result.root = argument.slice("--root=".length);
      continue;
    }
    if (argument.indexOf("--apps=") === 0) {
      result.apps = parseApps(argument.slice("--apps=".length));
      continue;
    }
    throw new Error("unknown option: " + argument);
  }
  return result;
}

function parseApps(value) {
  var apps = value
    .split(",")
    .map(function (item) {
      return item.trim().toLowerCase();
    })
    .filter(Boolean);
  if (!apps.length) {
    throw new Error("--apps must contain at least one target");
  }
  for (var index = 0; index < apps.length; index += 1) {
    if (!VALID_APPS.has(apps[index])) {
      throw new Error(
        "unsupported CC Switch target " + apps[index] + "; choose claude, codex, gemini, or opencode",
      );
    }
  }
  return apps;
}

function buildServer(root) {
  var launcher = path.join(root, "scripts", "expert_team_mcp_launcher.js");
  if (!fs.existsSync(launcher)) {
    throw new Error("missing bundled launcher: " + launcher);
  }
  return {
    // Use the Node executable that generated this entry. GUI launchers often
    // have a smaller PATH than an interactive shell; resolving it now keeps
    // the generated entry reliable on the current machine.
    command: process.execPath || "node",
    args: [launcher],
  };
}

function encodeQuery(parameters) {
  return parameters
    .map(function (pair) {
      return encodeURIComponent(pair[0]) + "=" + encodeURIComponent(pair[1]);
    })
    .join("&");
}

function render(format, apps, server) {
  if (format === "json") {
    return JSON.stringify({ mcpServers: { "expert-team": server } }, null, 2);
  }
  if (format === "server-json") {
    return JSON.stringify(server, null, 2);
  }
  return "ccswitch://v1/import?" + encodeQuery([
    ["resource", "mcp"],
    ["apps", apps.join(",")],
    ["name", "expert-team"],
    ["enabled", "true"],
    ["config", JSON.stringify(server)],
  ]);
}

try {
  var options = parseArgs(process.argv.slice(2));
  var root = resolveRoot(options.root);
  process.stdout.write(render(options.format, options.apps, buildServer(root)) + "\n");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
