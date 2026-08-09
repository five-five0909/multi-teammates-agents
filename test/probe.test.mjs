import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveCommand } from "../dist/platform/probe.js";

test("resolveCommand converts an npm-style Windows cmd shim to a shell-free target", async (context) => {
  if (process.platform !== "win32") {
    context.skip("Windows-specific command shim contract");
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), "mta-shim-"));
  try {
    const target = join(directory, "node_modules", "tool", "cli.js");
    await mkdir(join(directory, "node_modules", "tool"), { recursive: true });
    await writeFile(target, "console.log('ok');\n");
    await writeFile(
      join(directory, "tool.cmd"),
      '"%dp0%\\node_modules\\tool\\cli.js" %*\r\n',
    );
    const resolved = await resolveCommand("tool", { PATH: directory });
    assert.equal(resolved.executable, process.execPath);
    assert.deepEqual(resolved.prefixArgs, [target]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
