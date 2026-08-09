import { createHash } from "node:crypto";

export function sha256(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}
