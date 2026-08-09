import { backendEventSchema, decodeContract, SCHEMA_VERSION, type BackendEvent } from "../core/contracts.js";
import type { EpisodeRequest, HostName } from "../supervisor/host-adapter.js";

export interface NormalizedHostOutput {
  visibleOutput: string;
  events: BackendEvent[];
  permissionRequired: boolean;
  parsedRecords: number;
  ignoredLines: number;
}

const permissionPattern = /(?:permission|approval)\s+(?:is\s+)?(?:required|needed|denied)|requires?\s+(?:user\s+)?approval|not\s+approved|denied\s+by\s+(?:the\s+)?user/iu;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function nestedString(value: unknown, key: string): string | undefined {
  return string(record(value)?.[key]);
}

function extractText(host: HostName, value: Record<string, unknown>): string | undefined {
  if (host === "codex") {
    const item = record(value.item);
    if (value.type === "item.completed" && item?.type === "agent_message") return string(item.text);
    return undefined;
  }
  if (value.type === "result") return string(value.result);
  const message = record(value.message);
  if (message === null || !Array.isArray(message.content)) return undefined;
  const texts = message.content.map((part) => nestedString(part, "text")).filter((part): part is string => part !== undefined);
  return texts.length === 0 ? undefined : texts.join("\n");
}

function eventStatus(action: string): BackendEvent["status"] {
  if (permissionPattern.test(action)) return "permission_required";
  if (/(?:cancelled|canceled)/iu.test(action)) return "cancelled";
  if (/(?:failed|error)/iu.test(action)) return "failed";
  if (/(?:completed|result|success)/iu.test(action)) return "completed";
  if (/(?:started|init)/iu.test(action)) return "started";
  return "progress";
}

function normalizeRecord(host: HostName, request: EpisodeRequest, value: Record<string, unknown>, index: number): BackendEvent {
  const item = record(value.item);
  const action = string(value.type) ?? string(value.subtype) ?? string(value.status) ?? "host.event";
  const sourceId = string(value.id) ?? string(item?.id) ?? string(value.thread_id) ?? string(value.session_id) ?? `${request.episodeId}:${String(index)}`;
  const references = [string(value.thread_id), string(value.session_id), string(item?.id)]
    .filter((entry): entry is string => entry !== undefined && entry !== sourceId);
  const tool = string(item?.type)?.includes("tool") === true
    ? string(item?.name) ?? string(item?.type)
    : string(value.tool_name) ?? null;
  return decodeContract(backendEventSchema, {
    schema_version:SCHEMA_VERSION,
    host,
    role:request.role,
    action,
    status:eventStatus(`${action} ${string(value.error) ?? ""} ${string(value.result) ?? ""}`),
    source_id:sourceId,
    references:[...new Set(references)],
    tool,
  }, "BackendEvent");
}

function permissionEvidence(value: Record<string, unknown>): string {
  const evidence = [string(value.type), string(value.subtype), string(value.status), string(value.error)];
  if (value.is_error === true) evidence.push(string(value.result));
  const nestedError = record(value.error);
  if (nestedError !== null) evidence.push(string(nestedError.message), string(nestedError.type));
  return evidence.filter((entry): entry is string => entry !== undefined).join(" ");
}

export function normalizeHostOutput(host: HostName, request: EpisodeRequest, stdout: string, stderr: string): NormalizedHostOutput {
  const events: BackendEvent[] = [];
  let visibleOutput = "";
  let parsedRecords = 0;
  let ignoredLines = 0;
  let permissionRequired = permissionPattern.test(stderr);
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try { value = JSON.parse(line) as unknown; }
    catch { ignoredLines += 1; continue; }
    const parsed = record(value);
    if (parsed === null) { ignoredLines += 1; continue; }
    parsedRecords += 1;
    const text = extractText(host, parsed);
    if (text !== undefined) visibleOutput = text;
    if (permissionPattern.test(permissionEvidence(parsed))) permissionRequired = true;
    if (events.length < 256) events.push(normalizeRecord(host, request, parsed, parsedRecords));
  }
  return { visibleOutput, events, permissionRequired, parsedRecords, ignoredLines };
}
