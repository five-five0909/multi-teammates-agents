import assert from "node:assert/strict";
import test from "node:test";

import { probeMcpInitialize } from "../dist/control/doctor.js";

test("doctor performs a real MCP initialize handshake", async () => {
  const probe = await probeMcpInitialize();
  assert.equal(probe.available, true, probe.error);
  assert.equal(probe.command, "mta mcp initialize");
  assert.equal(probe.version, "0.5.0-alpha.0");
});
