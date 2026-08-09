export const APPLY_SCHEMA_VERSION = 1;

export type ApplyHost = "codex" | "claude";
export type ApplyAction = "create" | "update" | "unchanged" | "remove";

export interface ApplyChange {
  readonly relativePath: string;
  readonly action: ApplyAction;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly content: string | null;
  readonly originalBase64: string | null;
  readonly ownedAfter: boolean;
}

export interface ApplyPlan {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly packageVersion: string;
  readonly projectRoot: string;
  readonly hosts: readonly ApplyHost[];
  readonly changes: readonly ApplyChange[];
}

export interface OwnedFileReceipt {
  readonly relativePath: string;
  readonly originalBase64: string | null;
  readonly appliedHash: string;
}

export interface ApplyReceipt {
  readonly schemaVersion: 1;
  readonly transactionId: string;
  readonly packageVersion: string;
  readonly projectRoot: string;
  readonly hosts: readonly ApplyHost[];
  readonly appliedAt: string;
  readonly files: readonly OwnedFileReceipt[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHost(value: unknown): value is ApplyHost {
  return value === "codex" || value === "claude";
}

function isOwnedFile(value: unknown): value is OwnedFileReceipt {
  if (!isRecord(value)) return false;
  return typeof value.relativePath === "string"
    && (value.originalBase64 === null || typeof value.originalBase64 === "string")
    && typeof value.appliedHash === "string";
}

export function decodeApplyReceipt(value: unknown): ApplyReceipt {
  if (!isRecord(value)
    || value.schemaVersion !== APPLY_SCHEMA_VERSION
    || typeof value.transactionId !== "string"
    || typeof value.packageVersion !== "string"
    || typeof value.projectRoot !== "string"
    || !Array.isArray(value.hosts)
    || !value.hosts.every(isHost)
    || typeof value.appliedAt !== "string"
    || !Array.isArray(value.files)
    || !value.files.every(isOwnedFile)) {
    throw new Error("invalid .mta/apply-receipt.json contract");
  }
  return value as unknown as ApplyReceipt;
}
