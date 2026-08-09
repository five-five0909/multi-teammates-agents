import { fileURLToPath } from "node:url";

import { findGitRoot } from "./project-root.js";
import { probeCommand, type CommandProbe } from "../platform/probe.js";
import { ProcessRunner } from "../runtime/host/process-runner.js";
import { NODE_VERSION_RANGE, PACKAGE_VERSION } from "../version.js";

export interface DoctorReport {
  readonly packageVersion: string;
  readonly requiredNode: string;
  readonly projectRoot: string | null;
  readonly healthy: boolean;
  readonly probes: readonly CommandProbe[];
}

export async function runDoctor(startPath: string): Promise<DoctorReport> {
  const [node, npm, git, codex, claude, mcp] = await Promise.all([
    probeCommand(process.execPath),
    probeCommand("npm"),
    probeCommand("git"),
    probeCommand("codex"),
    probeCommand("claude"),
    probeMcpInitialize(),
  ]);
  const projectRoot = await findGitRoot(startPath).catch(() => null);
  const requiredAvailable = node.available && npm.available && git.available && mcp.available;

  return {
    packageVersion: PACKAGE_VERSION,
    requiredNode: NODE_VERSION_RANGE,
    projectRoot,
    healthy: requiredAvailable && projectRoot !== null,
    probes: [node, npm, git, codex, claude, mcp],
  };
}

export async function probeMcpInitialize(timeoutMs = 5_000): Promise<CommandProbe> {
  const launcher = fileURLToPath(new URL("../../bin/mta-plugin-mcp.js", import.meta.url));
  const result = await new ProcessRunner().run({
    episodeId:`doctor-mcp-${process.pid}-${Date.now()}`,
    executable:process.execPath,
    args:[launcher],
    cwd:process.cwd(),
    stdin:`${JSON.stringify({ jsonrpc:"2.0", id:1, method:"initialize", params:{} })}\n`,
    timeoutMs,
    maxStdoutChars:16_384,
    maxStderrChars:16_384,
  });
  try {
    const response = JSON.parse(result.stdout.trim()) as { result?: { serverInfo?: { name?: unknown; version?: unknown } } };
    if (result.exitCode !== 0 || response.result?.serverInfo?.name !== "expert-team" || typeof response.result.serverInfo.version !== "string") {
      throw new Error(result.stderr.trim() || "invalid MCP initialize response");
    }
    return { command:"mta mcp initialize", resolvedCommand:launcher, available:true, version:response.result.serverInfo.version };
  } catch (error) {
    return { command:"mta mcp initialize", resolvedCommand:launcher, available:false, error:message(error, result) };
  }
}

function message(error: unknown, result: { spawnError?: string; cleanupError?: string }): string {
  return result.cleanupError ?? result.spawnError ?? (error instanceof Error ? error.message : String(error));
}
