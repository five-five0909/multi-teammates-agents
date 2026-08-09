import { findGitRoot } from "./project-root.js";
import { probeCommand, type CommandProbe } from "../platform/probe.js";
import { NODE_VERSION_RANGE, PACKAGE_VERSION } from "../version.js";

export interface DoctorReport {
  readonly packageVersion: string;
  readonly requiredNode: string;
  readonly projectRoot: string | null;
  readonly healthy: boolean;
  readonly probes: readonly CommandProbe[];
}

export async function runDoctor(startPath: string): Promise<DoctorReport> {
  const [node, npm, git, codex, claude] = await Promise.all([
    probeCommand(process.execPath),
    probeCommand("npm"),
    probeCommand("git"),
    probeCommand("codex"),
    probeCommand("claude"),
  ]);
  const projectRoot = await findGitRoot(startPath).catch(() => null);
  const requiredAvailable = node.available && npm.available && git.available;

  return {
    packageVersion: PACKAGE_VERSION,
    requiredNode: NODE_VERSION_RANGE,
    projectRoot,
    healthy: requiredAvailable && projectRoot !== null,
    probes: [node, npm, git, codex, claude],
  };
}
