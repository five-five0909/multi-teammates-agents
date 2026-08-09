import { parseArgs } from "node:util";

import { applyProject, unapplyProject } from "../control/apply.js";
import type { ApplyHost } from "../control/apply-contract.js";
import { runDoctor } from "../control/doctor.js";
import { readControlStatus } from "../control/status.js";
import { legacyDetach, planLegacyDetach } from "../control/legacy.js";
import { checkForUpdate, updatePackage } from "../control/update.js";
import { TaskRepository } from "../lifecycle/task-repository.js";
import { dispatchHook } from "../hooks/dispatcher.js";
import { normalizeNativeHook, renderHostDecision } from "../hooks/host-adapter.js";
import { serveMcp } from "../mcp/server.js";
import { BoundRunService } from "../lifecycle/run-service.js";
import { runForeground } from "../runtime/foreground.js";
import { decodeContract, humanDecisionSchema } from "../runtime/core/contracts.js";
import { runTui } from "../tui/index.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";

const HELP = `multi-teammates-agents ${PACKAGE_VERSION}

Usage:
  mta [command] [options]

Commands:
  apply        Plan project takeover; pass --yes to commit
  status       Inspect project ownership and applied state
  doctor       Probe Node, npm, Git, Codex, Claude, and the project root
  unapply      Plan removal of owned files; pass --yes to commit
  check-update Check the npm registry for a newer version
  update       Plan an exact npm update; pass --yes to commit
  task         Create, start, inspect, finish, or archive Trellis tasks
  hook         Dispatch one Codex or Claude lifecycle event from stdin
  legacy       Inspect or detach exact legacy Python integration entries
  mcp          Serve the TypeScript MCP control plane over stdio
  run          Start, inspect, resume, cancel, or execute a managed run

Options:
  --project <path>  Project path (defaults to current directory)
  --codex           Include Codex integration
  --claude          Include Claude Code integration
  --yes             Commit a planned mutation
  --json            Emit machine-readable JSON
  --session <id>    Session identity for task binding
  --host <name>     Default foreground host: codex or claude
  --config <json>   Explicit foreground role configuration
  --model <name>    Default model for foreground roles
  --version <exact> Exact target for the update command
  -h, --help        Show this help
  -v, --version     Show package version
`;

function write(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeError(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  } else {
    process.stderr.write(`mta: ${message}\n`);
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    const versionOnly = argv.some((argument) => argument === "--version" || argument === "-v")
      && argv.every((argument) => argument === "--version" || argument === "-v" || argument === "--json");
    if (versionOnly) {
      write(PACKAGE_VERSION, argv.includes("--json"));
      return 0;
    }
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "string" },
        json: { type: "boolean" },
        project: { type: "string" },
        codex: { type: "boolean" },
        claude: { type: "boolean" },
        yes: { type: "boolean" },
        session: { type: "string" },
        slug: { type: "string" },
        host: { type: "string" },
        contract: { type: "string" },
        workItems: { type: "string" },
        config: { type: "string" },
        model: { type: "string" },
        decision: { type: "string" },
      },
    });
    const json = parsed.values.json ?? false;
    const command = parsed.positionals[0];
    if (parsed.values.help) {
      write(json ? { name: PACKAGE_NAME, version: PACKAGE_VERSION, commands: ["apply", "status", "doctor", "check-update", "update", "unapply", "task", "hook", "legacy", "mcp", "run"] } : HELP.trimEnd(), json);
      return 0;
    }
    if (command === undefined) {
      if (!json && process.stdin.isTTY && process.stdout.isTTY) return runTui(parsed.values.project ?? process.cwd(), parsed.values.session ?? process.env.MTA_SESSION_ID);
      write(json ? { name: PACKAGE_NAME, version: PACKAGE_VERSION, commands: ["apply", "status", "doctor", "check-update", "update", "unapply", "task", "hook", "legacy", "mcp", "run"] } : HELP.trimEnd(), json);
      return 0;
    }
    if (command !== "task" && command !== "hook" && command !== "legacy" && command !== "mcp" && command !== "run" && parsed.positionals.length > 1) {
      throw new Error(`unexpected argument: ${parsed.positionals[1]}`);
    }
    const project = parsed.values.project ?? process.cwd();
    const hosts: ApplyHost[] = [];
    if (parsed.values.codex) hosts.push("codex");
    if (parsed.values.claude) hosts.push("claude");

    switch (command) {
      case "apply":
        write(await applyProject(project, hosts, parsed.values.yes ?? false), json);
        return 0;
      case "status":
        write(await readControlStatus(project, parsed.values.session ?? process.env.MTA_SESSION_ID), json);
        return 0;
      case "doctor": {
        const report = await runDoctor(project);
        write(report, json);
        return report.healthy ? 0 : 1;
      }
      case "check-update":
        write(await checkForUpdate({ useCache:false }), json);
        return 0;
      case "update": {
        const result = await updatePackage({
          ...(parsed.values.version === undefined ? {} : { targetVersion:parsed.values.version }),
          commit:parsed.values.yes ?? false,
        });
        write(result, json);
        return result.committed && result.updateRequired && !result.updated ? 1 : 0;
      }
      case "unapply":
        write(await unapplyProject(project, parsed.values.yes ?? false), json);
        return 0;
      case "task":
        write(await runTaskCommand(project, parsed.positionals.slice(1), {
          session: parsed.values.session,
          slug: parsed.values.slug,
          host: parsed.values.host,
        }), json);
        return 0;
      case "hook": {
        if (parsed.positionals[1] !== "dispatch" || parsed.positionals.length > 2) throw new Error("usage: mta hook dispatch --host <codex|claude>");
        const host = parsed.values.host;
        if (host !== "codex" && host !== "claude") throw new Error("hook dispatch requires --host codex or --host claude");
        const input = await readStandardInput();
        const repository = await TaskRepository.open(project);
        const decision = await dispatchHook(repository, normalizeNativeHook(host, input, repository.projectRoot));
        const output = renderHostDecision(host, decision);
        if (output !== null) write(output, false);
        return 0;
      }
      case "legacy": {
        const action = parsed.positionals[1];
        if (parsed.positionals.length > 2) throw new Error(`unexpected argument: ${parsed.positionals[2]}`);
        if (action === "status") write(await planLegacyDetach(project), json);
        else if (action === "detach") write(await legacyDetach(project, parsed.values.yes ?? false), json);
        else throw new Error("usage: mta legacy status|detach [--yes]");
        return 0;
      }
      case "mcp":
        if (parsed.positionals[1] !== "serve" || parsed.positionals.length > 2) throw new Error("usage: mta mcp serve [--project <path>] [--session <id>]");
        await serveMcp(parsed.values.project, parsed.values.session ?? process.env.MTA_SESSION_ID);
        return 0;
      case "run": {
        const action = parsed.positionals[1];
        const runId = parsed.positionals[2];
        if (parsed.positionals.length > 3 || action === undefined || runId === undefined) throw new Error("usage: mta run <start|status|resume|answer|cancel|foreground> <run-id>");
        const service = await BoundRunService.open(project, parsed.values.session ?? process.env.MTA_SESSION_ID);
        if (action === "start") {
          if (parsed.values.contract === undefined || parsed.values.workItems === undefined) throw new Error("run start requires --contract <json> and --workItems <json>");
          write(await service.start(runId, JSON.parse(parsed.values.contract) as unknown, JSON.parse(parsed.values.workItems) as unknown), json);
        } else if (action === "status") write(await service.runtime(runId).load(), json);
        else if (action === "resume") write(await service.resume(runId), json);
        else if (action === "answer") {
          if (parsed.values.decision === undefined) throw new Error("run answer requires --decision <json>");
          write(await service.runtime(runId).answer(decodeContract(humanDecisionSchema, JSON.parse(parsed.values.decision) as unknown, "HumanDecision")), json);
        }
        else if (action === "cancel") write(await service.runtime(runId).transition("run.cancelled", { reason:"cancelled through CLI" }, "cli-cancel"), json);
        else if (action === "foreground") {
          const host = parsed.values.host ?? "codex";
          if (host !== "codex" && host !== "claude") throw new Error("run foreground --host must be codex or claude");
          const controller = new AbortController();
          const abort = (): void => controller.abort();
          process.once("SIGINT", abort);
          process.once("SIGTERM", abort);
          try {
            const config = parsed.values.config === undefined ? undefined : JSON.parse(parsed.values.config) as unknown;
            write(await runForeground(service, runId, config, {
              defaultHost:host,
              ...(parsed.values.model === undefined ? {} : { model:parsed.values.model }),
              signal:controller.signal,
            }), json);
          } finally {
            process.removeListener("SIGINT", abort);
            process.removeListener("SIGTERM", abort);
          }
        }
        else throw new Error(`unknown run command: ${action}`);
        return 0;
      }
      default:
        throw new Error(`unknown command: ${command}`);
    }
  } catch (error) {
    writeError(error, argv.includes("--json"));
    return 2;
  }
}

async function readStandardInput(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const value: unknown = chunk;
    if (Buffer.isBuffer(value)) chunks.push(Buffer.from(value));
    else if (typeof value === "string") chunks.push(Buffer.from(value));
    else throw new Error("hook stdin produced a non-text chunk");
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) throw new Error("hook dispatch requires one JSON object on stdin");
  return JSON.parse(text) as unknown;
}

async function runTaskCommand(
  project: string,
  positionals: string[],
  options: { session: string | undefined; slug: string | undefined; host: string | undefined },
): Promise<unknown> {
  const repository = await TaskRepository.open(project);
  const action = positionals[0];
  const reference = positionals[1];
  if (positionals.length > 2) throw new Error(`unexpected argument: ${positionals[2]}`);
  if (action === "create") {
    if (reference === undefined) throw new Error("task create requires a title");
    return repository.create(reference, options.slug === undefined ? {} : { slug:options.slug });
  }
  const session = options.session ?? process.env.MTA_SESSION_ID;
  if (session === undefined) throw new Error(`task ${action ?? "command"} requires --session or MTA_SESSION_ID`);
  if (action === undefined) throw new Error("task command is required");
  switch (action) {
    case "start": {
      if (reference === undefined) throw new Error("task start requires a task reference");
      const host = options.host ?? "cli";
      if (host !== "codex" && host !== "claude" && host !== "cli") throw new Error("--host must be codex, claude, or cli");
      return repository.start(reference, session, host);
    }
    case "current": return repository.current(session);
    case "finish": return { cleared:await repository.finish(session) };
    case "archive": {
      if (reference === undefined) throw new Error("task archive requires a task reference");
      return { archived:await repository.archive(reference, session) };
    }
    default: throw new Error(`unknown task command: ${action ?? "(missing)"}`);
  }
}
