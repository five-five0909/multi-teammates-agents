import { randomUUID } from "node:crypto";

import { z } from "zod";

import { resolveCommand } from "../platform/probe.js";
import { ProcessRunner } from "../runtime/host/process-runner.js";

export const LEGACY_PLUGIN_ID = "multi-teammates-agents@multi-teammates-agents";
export const LEGACY_MARKETPLACE_NAME = "multi-teammates-agents";

const SCHEMA_VERSION = 1;
const PLUGIN_LIST_COMMAND = ["codex", "plugin", "list", "--json"] as const;
const MARKETPLACE_LIST_COMMAND = ["codex", "plugin", "marketplace", "list", "--json"] as const;
const MCP_LIST_COMMAND = ["codex", "mcp", "list", "--json"] as const;

const commandKindSchema = z.enum(["mcp-remove", "plugin-remove", "marketplace-remove"]);
const frozenCommandSchema = z.strictObject({
  kind:commandKindSchema,
  command:z.array(z.string()).min(1),
  shell:z.literal(false),
});

const probeSchema = z.strictObject({
  schemaVersion:z.literal(SCHEMA_VERSION),
  pluginId:z.literal(LEGACY_PLUGIN_ID),
  marketplaceName:z.literal(LEGACY_MARKETPLACE_NAME),
  pluginInstalled:z.boolean(),
  marketplaceInstalled:z.boolean(),
  staleMcp:z.boolean(),
});

const planSchema = z.strictObject({
  schemaVersion:z.literal(SCHEMA_VERSION),
  transactionId:z.string().uuid(),
  pluginId:z.literal(LEGACY_PLUGIN_ID),
  marketplaceName:z.literal(LEGACY_MARKETPLACE_NAME),
  pluginInstalled:z.boolean(),
  marketplaceInstalled:z.boolean(),
  staleMcp:z.boolean(),
  commands:z.array(frozenCommandSchema),
}).superRefine((plan, context) => {
  const expected = expectedCommands(plan.pluginInstalled, plan.marketplaceInstalled, plan.staleMcp);
  if (JSON.stringify(plan.commands) !== JSON.stringify(expected)) {
    context.addIssue({ code:"custom", path:["commands"], message:"migration commands do not match the frozen legacy identities" });
  }
});

const commandResultSchema = z.strictObject({
  kind:commandKindSchema,
  command:z.array(z.string()).min(1),
  exitCode:z.number().int().nullable(),
  stdout:z.string(),
  stderr:z.string(),
});

const resultSchema = z.strictObject({
  schemaVersion:z.literal(SCHEMA_VERSION),
  transactionId:z.string().uuid(),
  pluginId:z.literal(LEGACY_PLUGIN_ID),
  marketplaceName:z.literal(LEGACY_MARKETPLACE_NAME),
  committed:z.literal(true),
  succeeded:z.boolean(),
  commandResults:z.array(commandResultSchema),
  error:z.string().optional(),
});

const pluginListSchema = z.object({
  installed:z.array(z.object({ pluginId:z.string() }).passthrough()),
}).passthrough();

const marketplaceListSchema = z.object({
  marketplaces:z.array(z.object({ name:z.string() }).passthrough()),
}).passthrough();

const mcpListSchema = z.array(z.object({
  name:z.string(),
  transport:z.object({
    type:z.string(),
    command:z.string().optional(),
    args:z.array(z.string()).optional(),
    cwd:z.string().nullable().optional(),
  }).passthrough(),
}).passthrough());

export type MarketplaceMigrationProbe = z.infer<typeof probeSchema>;
export type MarketplaceMigrationPlan = z.infer<typeof planSchema>;
export type MarketplaceMigrationResult = z.infer<typeof resultSchema>;

export interface MarketplaceCommandRequest {
  command: readonly string[];
  cwd: string;
  shell: false;
}

export interface MarketplaceCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export type MarketplaceCommandRunner = (request: MarketplaceCommandRequest) => Promise<MarketplaceCommandResult>;

export interface MarketplaceMigrationOptions {
  cwd?: string;
  runner?: MarketplaceCommandRunner;
}

function expectedCommands(pluginInstalled: boolean, marketplaceInstalled: boolean, staleMcp: boolean): Array<z.infer<typeof frozenCommandSchema>> {
  const commands: Array<z.infer<typeof frozenCommandSchema>> = [];
  if (staleMcp) {
    commands.push({
      kind:"mcp-remove",
      command:["codex", "mcp", "remove", "expert-team"],
      shell:false,
    });
  }
  if (pluginInstalled) {
    commands.push({
      kind:"plugin-remove",
      command:["codex", "plugin", "remove", LEGACY_PLUGIN_ID, "--json"],
      shell:false,
    });
  }
  if (marketplaceInstalled) {
    commands.push({
      kind:"marketplace-remove",
      command:["codex", "plugin", "marketplace", "remove", LEGACY_MARKETPLACE_NAME, "--json"],
      shell:false,
    });
  }
  return commands;
}

function isLegacyPluginMcp(entry: z.infer<typeof mcpListSchema>[number]): boolean {
  if (entry.name !== "expert-team" || entry.transport.type !== "stdio") return false;
  const args = entry.transport.args ?? [];
  const launcher = args.some((argument) => /mta-plugin-mcp\.js/u.test(argument));
  const cacheIdentity = [entry.transport.cwd ?? "", ...args].some((value) =>
    /[\\/]plugins[\\/]cache[\\/]multi-teammates-agents[\\/]multi-teammates-agents[\\/]/u.test(value));
  return launcher && cacheIdentity;
}

const defaultRunner: MarketplaceCommandRunner = async (request) => {
  const [executableName, ...args] = request.command;
  if (executableName === undefined) throw new Error("migration command cannot be empty");
  const resolved = await resolveCommand(executableName);
  const result = await new ProcessRunner().run({
    episodeId:`marketplace-migration-${randomUUID()}`,
    executable:resolved.executable,
    args:[...resolved.prefixArgs, ...args],
    cwd:request.cwd,
    stdin:"",
    timeoutMs:30_000,
    maxStdoutChars:262_144,
    maxStderrChars:65_536,
  });
  return { exitCode:result.exitCode, stdout:result.stdout, stderr:result.cleanupError ?? result.spawnError ?? result.stderr };
};

async function runReadOnlyJson(
  command: readonly string[],
  options: MarketplaceMigrationOptions,
): Promise<unknown> {
  const result = await (options.runner ?? defaultRunner)({ command, cwd:options.cwd ?? process.cwd(), shell:false });
  if (result.exitCode !== 0) {
    throw new Error(`${command.slice(0, -1).join(" ")} failed: ${result.stderr.trim() || `exit code ${String(result.exitCode)}`}`);
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch (error) {
    throw new Error(`${command.slice(0, -1).join(" ")} returned invalid JSON`, { cause:error });
  }
}

export async function probeMarketplaceMigration(options: MarketplaceMigrationOptions = {}): Promise<MarketplaceMigrationProbe> {
  const pluginOutput = pluginListSchema.parse(await runReadOnlyJson(PLUGIN_LIST_COMMAND, options));
  const marketplaceOutput = marketplaceListSchema.parse(await runReadOnlyJson(MARKETPLACE_LIST_COMMAND, options));
  const mcpOutput = mcpListSchema.parse(await runReadOnlyJson(MCP_LIST_COMMAND, options));
  return probeSchema.parse({
    schemaVersion:SCHEMA_VERSION,
    pluginId:LEGACY_PLUGIN_ID,
    marketplaceName:LEGACY_MARKETPLACE_NAME,
    pluginInstalled:pluginOutput.installed.some((plugin) => plugin.pluginId === LEGACY_PLUGIN_ID),
    marketplaceInstalled:marketplaceOutput.marketplaces.some((marketplace) => marketplace.name === LEGACY_MARKETPLACE_NAME),
    staleMcp:mcpOutput.some(isLegacyPluginMcp),
  });
}

export function planMarketplaceMigration(probe: unknown): MarketplaceMigrationPlan {
  const parsed = probeSchema.parse(probe);
  return planSchema.parse({
    ...parsed,
    transactionId:randomUUID(),
    commands:expectedCommands(parsed.pluginInstalled, parsed.marketplaceInstalled, parsed.staleMcp),
  });
}

export async function commitMarketplaceMigration(
  plan: unknown,
  options: MarketplaceMigrationOptions = {},
): Promise<MarketplaceMigrationResult> {
  const parsed = planSchema.parse(plan);
  const commandResults: Array<z.infer<typeof commandResultSchema>> = [];
  for (const frozen of parsed.commands) {
    const output = await (options.runner ?? defaultRunner)({
      command:frozen.command,
      cwd:options.cwd ?? process.cwd(),
      shell:false,
    });
    commandResults.push(commandResultSchema.parse({
      kind:frozen.kind,
      command:frozen.command,
      exitCode:output.exitCode,
      stdout:output.stdout,
      stderr:output.stderr,
    }));
    if (output.exitCode !== 0) {
      return resultSchema.parse({
        schemaVersion:SCHEMA_VERSION,
        transactionId:parsed.transactionId,
        pluginId:parsed.pluginId,
        marketplaceName:parsed.marketplaceName,
        committed:true,
        succeeded:false,
        commandResults,
        error:`${frozen.command.join(" ")} failed: ${output.stderr.trim() || `exit code ${String(output.exitCode)}`}`,
      });
    }
  }
  return resultSchema.parse({
    schemaVersion:SCHEMA_VERSION,
    transactionId:parsed.transactionId,
    pluginId:parsed.pluginId,
    marketplaceName:parsed.marketplaceName,
    committed:true,
    succeeded:true,
    commandResults,
  });
}
