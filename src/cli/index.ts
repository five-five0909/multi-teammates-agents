import { parseArgs } from "node:util";

import { applyProject, unapplyProject } from "../control/apply.js";
import type { ApplyHost } from "../control/apply-contract.js";
import { runDoctor } from "../control/doctor.js";
import { readProjectStatus } from "../control/status.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";

const HELP = `multi-teammates-agents ${PACKAGE_VERSION}

Usage:
  mta [command] [options]

Commands:
  apply        Plan project takeover; pass --yes to commit
  status       Inspect project ownership and applied state
  doctor       Probe Node, npm, Git, Codex, Claude, and the project root
  unapply      Plan removal of owned files; pass --yes to commit

Options:
  --project <path>  Project path (defaults to current directory)
  --codex           Include Codex integration
  --claude          Include Claude Code integration
  --yes             Commit a planned mutation
  --json            Emit machine-readable JSON
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
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        json: { type: "boolean" },
        project: { type: "string" },
        codex: { type: "boolean" },
        claude: { type: "boolean" },
        yes: { type: "boolean" },
      },
    });
    const json = parsed.values.json ?? false;
    if (parsed.values.version) {
      write(PACKAGE_VERSION, json);
      return 0;
    }
    const command = parsed.positionals[0];
    if (parsed.values.help || command === undefined) {
      write(json ? { name: PACKAGE_NAME, version: PACKAGE_VERSION, commands: ["apply", "status", "doctor", "unapply"] } : HELP.trimEnd(), json);
      return 0;
    }
    if (parsed.positionals.length > 1) {
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
        write(await readProjectStatus(project), json);
        return 0;
      case "doctor": {
        const report = await runDoctor(project);
        write(report, json);
        return report.healthy ? 0 : 1;
      }
      case "unapply":
        write(await unapplyProject(project, parsed.values.yes ?? false), json);
        return 0;
      default:
        throw new Error(`unknown command: ${command}`);
    }
  } catch (error) {
    writeError(error, argv.includes("--json"));
    return 2;
  }
}
