import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function writeFileAtomic(
  targetPath: string,
  content: Uint8Array | string,
  transactionId: string,
): Promise<void> {
  const temporaryPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${transactionId}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
