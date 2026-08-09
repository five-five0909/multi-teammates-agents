import { z } from "zod";

import type { BoundRunService } from "../lifecycle/run-service.js";
import { decodeContract } from "./core/contracts.js";
import { ClaudeHostAdapter } from "./host/claude-adapter.js";
import { CodexHostAdapter } from "./host/codex-adapter.js";
import { ManagedRunSupervisor, type SupervisorOutcome } from "./supervisor/managed-run-supervisor.js";
import type { EpisodeRequest, EpisodeResult, HostAdapter, HostName, RuntimeConfig } from "./supervisor/host-adapter.js";

const roleInputSchema = z.strictObject({
  host:z.enum(["codex", "claude"]),
  model:z.string().trim().min(1).optional(),
  timeout_seconds:z.int().min(1).max(86_400).default(600),
  context_chars:z.int().min(1_000).max(1_000_000).default(32_000),
  output_chars:z.int().min(1_000).max(1_000_000).default(32_000),
});

const foregroundInputSchema = z.strictObject({
  max_concurrency:z.int().min(1).max(32).default(2),
  human_completion_gate:z.boolean().default(true),
  roles:z.strictObject({
    manager:roleInputSchema,
    executor:roleInputSchema,
    auditor:roleInputSchema,
  }),
});

export type ForegroundConfigInput = z.input<typeof foregroundInputSchema>;

export interface ForegroundOptions {
  defaultHost?: HostName;
  model?: string;
  signal?: AbortSignal;
  adapters?: Partial<Record<HostName, HostAdapter>>;
}

function defaultInput(host: HostName, model?: string): ForegroundConfigInput {
  const role = { host, ...(model === undefined ? {} : { model }) };
  return { roles:{ manager:{ ...role }, executor:{ ...role }, auditor:{ ...role } } };
}

export function decodeForegroundConfig(input: unknown, workspace: string, options: Pick<ForegroundOptions, "defaultHost" | "model"> = {}): RuntimeConfig {
  const decoded = decodeContract(foregroundInputSchema, input ?? defaultInput(options.defaultHost ?? "codex", options.model), "ForegroundConfig");
  return {
    workspace,
    maxConcurrency:decoded.max_concurrency,
    humanCompletionGate:decoded.human_completion_gate,
    roles:Object.fromEntries(Object.entries(decoded.roles).map(([role, binding]) => [role, {
      host:binding.host,
      model:binding.model,
      timeoutSeconds:binding.timeout_seconds,
      contextChars:binding.context_chars,
      outputChars:binding.output_chars,
    }])) as RuntimeConfig["roles"],
  };
}

class SignalledAdapter implements HostAdapter {
  public readonly host: HostName;

  public constructor(private readonly delegate: HostAdapter, private readonly signal?: AbortSignal) {
    this.host = delegate.host;
  }

  public runEpisode(request: EpisodeRequest): Promise<EpisodeResult> {
    return this.delegate.runEpisode(request, this.signal);
  }

  public cancel(episodeId: string): Promise<{ episodeId: string; found: boolean; terminated: boolean }> {
    return this.delegate.cancel(episodeId);
  }
}

export async function runForeground(
  service: BoundRunService,
  runId: string,
  configInput?: unknown,
  options: ForegroundOptions = {},
): Promise<SupervisorOutcome> {
  const config = decodeForegroundConfig(configInput, service.repository.projectRoot, options);
  const hosts = new Set(Object.values(config.roles).map((role) => role.host));
  const adapters: Record<string, HostAdapter> = {};
  for (const host of hosts) {
    const adapter = options.adapters?.[host] ?? (host === "codex" ? new CodexHostAdapter() : new ClaudeHostAdapter());
    adapters[host] = new SignalledAdapter(adapter, options.signal);
  }
  return new ManagedRunSupervisor(service.runtime(runId), config, adapters).run();
}
