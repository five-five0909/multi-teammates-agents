import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { findGitRoot } from "./project-root.js";
import { PACKAGE_VERSION } from "../version.js";

export interface ProjectStatus {
  readonly packageVersion: string;
  readonly projectRoot: string;
  readonly applied: boolean;
  readonly receiptPath: string;
  readonly receiptValid: boolean | null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readProjectStatus(startPath: string): Promise<ProjectStatus> {
  const projectRoot = await findGitRoot(startPath);
  const receiptPath = resolve(projectRoot, ".mta", "apply-receipt.json");
  const applied = await exists(receiptPath);
  let receiptValid: boolean | null = null;

  if (applied) {
    try {
      const value: unknown = JSON.parse(await readFile(receiptPath, "utf8"));
      receiptValid = typeof value === "object" && value !== null;
    } catch {
      receiptValid = false;
    }
  }

  return { packageVersion: PACKAGE_VERSION, projectRoot, applied, receiptPath, receiptValid };
}
