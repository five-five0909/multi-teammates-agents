import type { BackendEvent } from "../core/contracts.js";

export type HostName = "codex" | "claude";
export type EpisodeRole = "manager" | "executor" | "auditor";
export type EpisodeStatus = "done" | "error" | "timeout" | "cancelled" | "permission_required";

export interface EpisodeRequest {
  episodeId: string;
  runId: string;
  roundIndex: number;
  role: EpisodeRole;
  profile: string;
  prompt: string;
  workspace: string;
  model: string | undefined;
  timeoutSeconds: number;
  maxOutputChars: number;
  permissionPosture: "host-controlled";
  readOnly: boolean;
  workItemId?: string;
}

export interface EpisodeResult {
  episodeId: string;
  host: HostName;
  role: EpisodeRole;
  status: EpisodeStatus;
  visibleOutput: string;
  events: BackendEvent[];
  durationMs: number;
  exitCode: number | null;
  error?: string;
  rawStdout: string;
  rawStderr: string;
  metadata: Record<string, unknown>;
}

export interface HostAdapter {
  readonly host: HostName;
  runEpisode(request: EpisodeRequest, signal?: AbortSignal): Promise<EpisodeResult>;
  cancel(episodeId: string): Promise<{ episodeId: string; found: boolean; terminated: boolean }>;
}

export interface RoleBinding {
  host: HostName;
  model?: string;
  timeoutSeconds: number;
  contextChars: number;
  outputChars: number;
}

export interface RuntimeConfig {
  workspace: string;
  maxConcurrency: number;
  humanCompletionGate: boolean;
  roles: Record<EpisodeRole, RoleBinding>;
}
