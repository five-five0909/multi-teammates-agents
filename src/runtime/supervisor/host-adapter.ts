import { z } from "zod";

import { backendEventSchema } from "../core/contracts.js";

const nonEmpty = z.string().trim().min(1);
export const hostNameSchema = z.enum(["codex", "claude"]);
export const episodeRoleSchema = z.enum(["manager", "executor", "auditor"]);
export const episodeStatusSchema = z.enum(["done", "error", "timeout", "cancelled", "permission_required"]);
export const hostCapabilitiesSchema = z.strictObject({
  schema_version:z.literal(1),
  host:hostNameSchema,
  available:z.boolean(),
  command:nonEmpty,
  resolved_command:nonEmpty.nullable(),
  version:nonEmpty.nullable(),
  stream_json:z.boolean(),
  read_only:z.boolean(),
  cancellation:z.boolean(),
  error:nonEmpty.nullable(),
}).meta({ id:"HostCapabilities" });
export const episodeRequestSchema = z.strictObject({
  episodeId:nonEmpty,
  runId:nonEmpty,
  roundIndex:z.int().nonnegative(),
  role:episodeRoleSchema,
  profile:nonEmpty,
  prompt:nonEmpty,
  workspace:nonEmpty,
  model:nonEmpty.optional(),
  timeoutSeconds:z.number().positive().finite(),
  maxOutputChars:z.int().min(1),
  permissionPosture:z.literal("host-controlled"),
  readOnly:z.boolean(),
  workItemId:nonEmpty.optional(),
}).superRefine((request, context) => {
  if (request.role === "auditor" && !request.readOnly) {
    context.addIssue({ code:"custom", path:["readOnly"], message:"Auditor episodes must be read-only" });
  }
}).meta({ id:"EpisodeRequest" });
export const episodeResultSchema = z.strictObject({
  episodeId:nonEmpty,
  host:hostNameSchema,
  role:episodeRoleSchema,
  status:episodeStatusSchema,
  visibleOutput:z.string(),
  events:z.array(backendEventSchema),
  durationMs:z.number().nonnegative(),
  exitCode:z.int().nullable(),
  error:nonEmpty.optional(),
  rawStdout:z.string(),
  rawStderr:z.string(),
  metadata:z.record(z.string(), z.unknown()),
}).meta({ id:"EpisodeResult" });
export const cancellationResultSchema = z.strictObject({
  episodeId:nonEmpty,
  found:z.boolean(),
  terminated:z.boolean(),
}).superRefine((result, context) => {
  if (result.terminated && !result.found) {
    context.addIssue({ code:"custom", path:["terminated"], message:"A terminated episode must have been found" });
  }
}).meta({ id:"CancellationResult" });

export type HostName = z.infer<typeof hostNameSchema>;
export type EpisodeRole = z.infer<typeof episodeRoleSchema>;
export type EpisodeStatus = z.infer<typeof episodeStatusSchema>;
export type HostCapabilities = z.infer<typeof hostCapabilitiesSchema>;
export type EpisodeRequest = z.infer<typeof episodeRequestSchema>;
export type EpisodeResult = z.infer<typeof episodeResultSchema>;
export type CancellationResult = z.infer<typeof cancellationResultSchema>;

export const hostAdapterSchemas = {
  HostCapabilities:hostCapabilitiesSchema,
  EpisodeRequest:episodeRequestSchema,
  EpisodeResult:episodeResultSchema,
  CancellationResult:cancellationResultSchema,
} as const;

export interface HostAdapter {
  readonly host: HostName;
  probe(): Promise<HostCapabilities>;
  runEpisode(request: EpisodeRequest, signal?: AbortSignal): Promise<EpisodeResult>;
  cancel(episodeId: string): Promise<CancellationResult>;
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
