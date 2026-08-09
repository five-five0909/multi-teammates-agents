import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, parse, resolve } from "node:path";

export class ProjectRootError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProjectRootError";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findGitRoot(startPath: string): Promise<string> {
  const start = resolve(startPath);
  const info = await stat(start).catch(() => undefined);
  if (!info) {
    throw new ProjectRootError(`path does not exist: ${start}`);
  }

  let current = info.isDirectory() ? start : dirname(start);
  for (;;) {
    if (await exists(resolve(current, ".git"))) {
      return realpath(current);
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new ProjectRootError(`no Git project found from: ${start}`);
    }
    current = parent;
  }
}

export async function assertSafeApplyRoot(projectRoot: string): Promise<void> {
  const canonical = await realpath(projectRoot);
  const filesystemRoot = parse(canonical).root;
  const canonicalHome = await realpath(homedir()).catch(() => resolve(homedir()));

  if (canonical === filesystemRoot) {
    throw new ProjectRootError("refusing to apply at a filesystem root");
  }
  if (canonical === canonicalHome) {
    throw new ProjectRootError("refusing to apply at the user home directory");
  }
  if (!(await exists(resolve(canonical, ".git")))) {
    throw new ProjectRootError("apply target must be a Git project root");
  }
}
