import { z } from "zod";

export const APPLY_SCHEMA_VERSION = 1;

const nonEmpty = z.string().trim().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const applyHostSchema = z.enum(["codex", "claude"]);
export const applyActionSchema = z.enum(["create", "update", "unchanged", "remove"]);
export const applyChangeSchema = z.strictObject({
  relativePath:nonEmpty,
  action:applyActionSchema,
  beforeHash:hash.nullable(),
  afterHash:hash.nullable(),
  content:z.string().nullable(),
  originalBase64:z.string().nullable(),
  ownedAfter:z.boolean(),
});
export const applyPlanSchema = z.strictObject({
  schemaVersion:z.literal(APPLY_SCHEMA_VERSION),
  transactionId:nonEmpty,
  packageVersion:nonEmpty,
  projectRoot:nonEmpty,
  hosts:z.array(applyHostSchema),
  changes:z.array(applyChangeSchema),
}).meta({ id:"ApplyPlan" });
export const ownedFileReceiptSchema = z.strictObject({
  relativePath:nonEmpty,
  originalBase64:z.string().nullable(),
  appliedHash:hash,
});
export const applyReceiptSchema = z.strictObject({
  schemaVersion:z.literal(APPLY_SCHEMA_VERSION),
  transactionId:nonEmpty,
  packageVersion:nonEmpty,
  projectRoot:nonEmpty,
  hosts:z.array(applyHostSchema),
  appliedAt:z.string().datetime(),
  files:z.array(ownedFileReceiptSchema),
}).meta({ id:"ApplyReceipt" });
export const unapplyChangeSchema = z.strictObject({
  relativePath:nonEmpty,
  beforeHash:hash,
  originalBase64:z.string().nullable(),
});
export const unapplyPlanSchema = z.strictObject({
  schemaVersion:z.literal(APPLY_SCHEMA_VERSION),
  transactionId:nonEmpty,
  packageVersion:nonEmpty,
  projectRoot:nonEmpty,
  receiptHash:hash,
  changes:z.array(unapplyChangeSchema),
}).meta({ id:"UnapplyPlan" });

export type ApplyHost = z.infer<typeof applyHostSchema>;
export type ApplyAction = z.infer<typeof applyActionSchema>;
export type ApplyChange = z.infer<typeof applyChangeSchema>;
export type ApplyPlan = z.infer<typeof applyPlanSchema>;
export type OwnedFileReceipt = z.infer<typeof ownedFileReceiptSchema>;
export type ApplyReceipt = z.infer<typeof applyReceiptSchema>;
export type UnapplyPlan = z.infer<typeof unapplyPlanSchema>;

export const applySchemas = { ApplyPlan:applyPlanSchema, ApplyReceipt:applyReceiptSchema, UnapplyPlan:unapplyPlanSchema } as const;

export function decodeApplyReceipt(value: unknown): ApplyReceipt {
  const parsed = applyReceiptSchema.safeParse(value);
  if (!parsed.success) throw new Error(`invalid .mta/apply-receipt.json contract: ${parsed.error.issues[0]?.message ?? "unknown field"}`);
  return parsed.data;
}
