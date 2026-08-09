import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import { probeMcpInitialize } from "../dist/control/doctor.js";

test("doctor performs a real MCP initialize handshake", async () => {
  const projectRoot = await realpath(new URL("..", import.meta.url));
  const probe = await probeMcpInitialize(projectRoot);
  assert.equal(probe.available, true, probe.error);
  assert.equal(probe.command, "mta mcp initialize");
  assert.equal(probe.resolvedCommand, process.execPath);
  assert.equal(probe.version, "0.5.0-alpha.2");
});
