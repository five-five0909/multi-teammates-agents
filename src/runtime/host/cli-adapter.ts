import { resolveCommand, type ResolvedCommand } from "../../platform/probe.js";
import type { EpisodeRequest, EpisodeResult, HostAdapter, HostName } from "../supervisor/host-adapter.js";
import { normalizeHostOutput } from "./event-normalizer.js";
import { ProcessRunner } from "./process-runner.js";

export interface CliAdapterOptions {
  command?: string;
  prefixArgs?: readonly string[];
  environment?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
}

export abstract class CliHostAdapter implements HostAdapter {
  public readonly host: HostName;
  private readonly runner: ProcessRunner;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly command: string;
  private readonly prefixArgs: readonly string[];
  private resolved?: Promise<ResolvedCommand>;

  protected constructor(host: HostName, options: CliAdapterOptions = {}) {
    this.host = host;
    this.runner = options.runner ?? new ProcessRunner();
    this.environment = options.environment ?? process.env;
    this.command = options.command ?? host;
    this.prefixArgs = options.prefixArgs ?? [];
  }

  protected abstract buildArgs(request: EpisodeRequest): readonly string[];

  public async runEpisode(request: EpisodeRequest, signal?: AbortSignal): Promise<EpisodeResult> {
    if (request.permissionPosture !== "host-controlled") throw new Error("unsupported permission posture");
    if (request.role === "auditor" && !request.readOnly) throw new Error("Auditor episodes must be read-only");
    const resolved = await (this.resolved ??= resolveCommand(this.command, this.environment));
    const args = [...resolved.prefixArgs, ...this.prefixArgs, ...this.buildArgs(request)];
    const rawLimit = Math.min(Math.max(request.maxOutputChars * 4, 262_144), 4_194_304);
    const processResult = await this.runner.run({
      episodeId:request.episodeId,
      executable:resolved.executable,
      args,
      cwd:request.workspace,
      environment:this.environment,
      stdin:request.prompt,
      timeoutMs:request.timeoutSeconds * 1_000,
      maxStdoutChars:rawLimit,
      maxStderrChars:Math.min(rawLimit, 262_144),
    }, signal);
    const normalized = normalizeHostOutput(this.host, request, processResult.stdout, processResult.stderr);
    const visibleOutput = normalized.visibleOutput.length > request.maxOutputChars
      ? normalized.visibleOutput.slice(-request.maxOutputChars)
      : normalized.visibleOutput;
    const status = processResult.terminationReason === "timeout" ? "timeout"
      : processResult.terminationReason === "cancelled" ? "cancelled"
        : normalized.permissionRequired ? "permission_required"
          : processResult.exitCode === 0 && processResult.spawnError === undefined ? "done" : "error";
    const error = status === "done" ? undefined
      : processResult.cleanupError ?? processResult.spawnError
        ?? (processResult.stderr.trim() || normalized.visibleOutput.trim() || `${this.host} episode ${status}`);
    return {
      episodeId:request.episodeId,
      host:this.host,
      role:request.role,
      status,
      visibleOutput,
      events:normalized.events,
      durationMs:processResult.durationMs,
      exitCode:processResult.exitCode,
      ...(error === undefined ? {} : { error }),
      rawStdout:processResult.stdout,
      rawStderr:processResult.stderr,
      metadata:{
        executable:resolved.executable,
        arguments:args,
        shell:false,
        permission_posture:request.permissionPosture,
        read_only:request.readOnly,
        parsed_records:normalized.parsedRecords,
        ignored_lines:normalized.ignoredLines,
        stdout_truncated:processResult.stdoutTruncated,
        stderr_truncated:processResult.stderrTruncated,
        visible_output_truncated:normalized.visibleOutput.length > request.maxOutputChars,
        ...(processResult.cleanupError === undefined ? {} : { cleanup_error:processResult.cleanupError }),
      },
    };
  }

  public cancel(episodeId: string): Promise<{ episodeId: string; found: boolean; terminated: boolean }> {
    return this.runner.cancel(episodeId);
  }
}
