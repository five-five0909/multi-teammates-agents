import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { ApplyHost } from "../control/apply-contract.js";
import { APPLY_SCHEMA_VERSION } from "../control/apply-contract.js";
import { PACKAGE_VERSION } from "../version.js";

export interface ProjectTemplate {
  readonly relativePath: string;
  readonly render: (original: Buffer | null) => string;
}

async function assetTemplates(sourceDirectory: URL, targetDirectory: string): Promise<ProjectTemplate[]> {
  const sourceRoot = fileURLToPath(sourceDirectory);
  const templates: ProjectTemplate[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        const assetPath = relative(sourceRoot, path).replaceAll("\\", "/");
        const content = await readFile(path, "utf8");
        templates.push({ relativePath: `${targetDirectory}/${assetPath}`, render: () => content });
      }
    }
  };
  await visit(sourceRoot);
  return templates;
}

const EVENTS = [
  "SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse",
  "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "Stop", "SessionEnd",
] as const;

const MTA_EXECUTABLE = process.execPath;
const MTA_BIN = fileURLToPath(new URL("../../bin/mta.js", import.meta.url));

function parseObject(original: Buffer | null, relativePath: string): Record<string, unknown> {
  if (original === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(original.toString("utf8"));
  } catch {
    throw new Error(`${relativePath} is not valid JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${relativePath} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

function hooksObject(value: Record<string, unknown>): Record<string, unknown[]> {
  const hooks = value.hooks;
  if (hooks === undefined) return {};
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
    throw new Error("hooks must be a JSON object");
  }
  const result: Record<string, unknown[]> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new Error(`hooks.${event} must be an array`);
    result[event] = Array.from(groups as unknown[]);
  }
  return result;
}

function codexConfig(original: Buffer | null): string {
  const value = parseObject(original, ".codex/hooks.json");
  const hooks = hooksObject(value);
  for (const event of EVENTS) {
    const handler: Record<string, unknown> = {
      type: "command",
      command: MTA_EXECUTABLE,
      commandWindows: MTA_EXECUTABLE,
      args: [MTA_BIN, "hook", "dispatch", "--host", "codex"],
      timeout: event === "SessionEnd" ? 3 : 10,
      statusMessage: "Applying MTA lifecycle policy",
    };
    if (["SessionStart", "UserPromptSubmit", "PreCompact", "PostCompact", "SubagentStart", "SubagentStop", "Stop"].includes(event)) {
      handler.additionalContextLimit = 1200;
    }
    hooks[event] = [...(hooks[event] ?? []), { hooks: [handler] }];
  }
  return `${JSON.stringify({ ...value, description: value.description ?? "MTA project lifecycle hooks", hooks }, null, 2)}\n`;
}

function claudeConfig(original: Buffer | null): string {
  const value = parseObject(original, ".claude/settings.json");
  const hooks = hooksObject(value);
  for (const event of EVENTS) {
    hooks[event] = [...(hooks[event] ?? []), {
      hooks: [{
        type: "command",
        command: MTA_EXECUTABLE,
        args: [MTA_BIN, "hook", "dispatch", "--host", "claude"],
        timeout: event === "SessionEnd" ? 3 : 10,
        statusMessage: "Applying MTA lifecycle policy",
      }],
    }];
  }
  return `${JSON.stringify({ ...value, hooks }, null, 2)}\n`;
}

function mcpConfig(original: Buffer | null, projectRoot: string): string {
  const value = parseObject(original, ".mcp.json");
  const rawServers = value.mcpServers;
  if (rawServers !== undefined && (typeof rawServers !== "object" || rawServers === null || Array.isArray(rawServers))) {
    throw new Error(".mcp.json mcpServers must be a JSON object");
  }
  const mcpServers = rawServers === undefined ? {} : rawServers as Record<string, unknown>;
  return `${JSON.stringify({
    ...value,
    mcpServers: {
      ...mcpServers,
      "expert-team": { command:MTA_EXECUTABLE, args:[MTA_BIN, "mcp", "serve", "--project", projectRoot] },
    },
  }, null, 2)}\n`;
}

const MARKER_START = "<!-- mta:lifecycle:start -->";
const MARKER_END = "<!-- mta:lifecycle:end -->";

function instructionFile(original: Buffer | null, host: ApplyHost): string {
  const existing = original?.toString("utf8") ?? "";
  const block = `${MARKER_START}\nMTA lifecycle policy (${host}): keep managed writes bound to the active in_progress Trellis task. Use \`mta task current --session <id>\` and do not bypass human permission, cancellation, completion, or destructive-operation gates.\n${MARKER_END}`;
  const start = existing.indexOf(MARKER_START);
  const end = existing.indexOf(MARKER_END);
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) throw new Error(`${host} instruction file has a malformed MTA marker`);
  if (start !== -1) return `${existing.slice(0, start)}${block}${existing.slice(end + MARKER_END.length)}`.trimEnd() + "\n";
  return `${existing.trimEnd()}${existing.trim().length === 0 ? "" : "\n\n"}${block}\n`;
}

export async function projectTemplates(projectRoot: string, hosts: readonly ApplyHost[]): Promise<readonly ProjectTemplate[]> {
  const templates: ProjectTemplate[] = [{
    relativePath: ".mta/runtime.json",
    render: () => `${JSON.stringify({
      schemaVersion: APPLY_SCHEMA_VERSION,
      packageVersion: PACKAGE_VERSION,
      projectRoot,
      hosts,
      hookCommand: `${MTA_EXECUTABLE} ${MTA_BIN} hook dispatch`,
    }, null, 2)}\n`,
  }];
  templates.push({ relativePath:".mcp.json", render:(original) => mcpConfig(original, projectRoot) });
  if (hosts.includes("codex")) {
    templates.push({ relativePath: ".codex/hooks.json", render: codexConfig });
    templates.push({ relativePath:"AGENTS.md", render:(original) => instructionFile(original, "codex") });
    templates.push(...await assetTemplates(
      new URL("../../skills/expert-team/", import.meta.url),
      ".agents/skills/expert-team",
    ));
  }
  if (hosts.includes("claude")) {
    templates.push({ relativePath: ".claude/settings.json", render: claudeConfig });
    templates.push({ relativePath:"CLAUDE.md", render:(original) => instructionFile(original, "claude") });
    templates.push(...await assetTemplates(
      new URL("../../skills/expert-team/", import.meta.url),
      ".claude/skills/expert-team",
    ));
    templates.push(...await assetTemplates(
      new URL("../../agents/", import.meta.url),
      ".claude/agents",
    ));
  }
  return templates;
}
