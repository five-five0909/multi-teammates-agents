import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import test from "node:test";

import { assertSafeApplyRoot, findGitRoot } from "../dist/control/project-root.js";

test("findGitRoot rejects paths outside a Git project", async () => {
  await assert.rejects(findGitRoot(parse(tmpdir()).root), /no Git project found/u);
});

test("assertSafeApplyRoot accepts a Git root and rejects a filesystem root", async () => {
  const project = await mkdtemp(join(tmpdir(), "mta-safe-"));
  try {
    await mkdir(join(project, ".git"));
    await assert.doesNotReject(assertSafeApplyRoot(project));
    await assert.rejects(assertSafeApplyRoot(parse(project).root), /filesystem root/u);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
