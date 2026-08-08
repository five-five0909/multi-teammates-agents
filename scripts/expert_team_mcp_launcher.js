"use strict";

/*
 * Cross-platform stdio launcher for the bundled Expert Team MCP server.
 *
 * Plugin hosts invoke MCP commands directly, without a shell.  Ubuntu commonly
 * exposes Python as `python3`, while Windows commonly exposes it as `python`
 * or through the `py -3` launcher.  Node is already required by the supported
 * Codex/Claude CLI distributions, so this small dependency-free bridge can
 * select the available Python command without mutating user configuration.
 */

var childProcess = require("child_process");
var path = require("path");

function pluginRoot() {
  var fromEnvironment = process.env.PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
  if (fromEnvironment) {
    return path.resolve(fromEnvironment);
  }
  return path.resolve(__dirname, "..");
}

function pythonCommands() {
  var override = process.env.EXPERT_TEAM_PYTHON;
  if (override) {
    return [[override]];
  }
  if (process.platform === "win32") {
    return [["python"], ["py", "-3"], ["python3"]];
  }
  return [["python3"], ["python"]];
}

function start(index, root, script) {
  var command = pythonCommands()[index];
  if (!command) {
    process.stderr.write(
      "Expert Team MCP requires Python 3.10+; install Python or set EXPERT_TEAM_PYTHON.\n",
    );
    process.exitCode = 127;
    return;
  }

  var executable = command[0];
  var args = command.slice(1).concat([script]);
  var child = childProcess.spawn(executable, args, {
    cwd: root,
    env: Object.assign({}, process.env, {
      PLUGIN_ROOT: root,
      CLAUDE_PLUGIN_ROOT: root,
    }),
    stdio: "inherit",
    windowsHide: true,
  });
  var retried = false;

  child.once("error", function (error) {
    if (error && error.code === "ENOENT") {
      retried = true;
      start(index + 1, root, script);
      return;
    }
    process.stderr.write("Unable to start Expert Team MCP: " + error.message + "\n");
    process.exitCode = 1;
  });
  child.once("exit", function (code, signal) {
    if (retried) {
      return;
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = typeof code === "number" ? code : 1;
  });
}

var root = pluginRoot();
var script = path.join(root, "scripts", "expert_team_mcp.py");
start(0, root, script);
