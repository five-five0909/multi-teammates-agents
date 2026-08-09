import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { z } from "zod";

import {
  auditDecisionSchema,
  decodeContract,
  runEventSchema,
  runSnapshotSchema,
  runtimeSchemas,
  taskContractSchema,
  workItemSchema,
} from "../dist/runtime/core/contracts.js";
import { decodeEvent } from "../dist/runtime/core/codec.js";
import { applyEvent, replay } from "../dist/runtime/core/reducer.js";
import { scopesOverlap, validateParallelWave, validateWorkGraph } from "../dist/runtime/core/scheduling.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/runtime/python-two-rounds.json", import.meta.url), "utf8"));

test("strict contracts reject unknown fields and invalid audit independence", () => {
  assert.throws(() => decodeContract(taskContractSchema, { ...fixture.initial.contract, extra: true }, "TaskContract"));
  const baseItem = fixture.initial.work_items.foundation;
  assert.throws(() => decodeContract(workItemSchema, { ...baseItem, mode: "read" }, "WorkItem"));
  const audit = fixture.events[4].payload;
  assert.throws(() => decodeContract(auditDecisionSchema, { ...audit, auditor_id: audit.executor_id }, "AuditDecision"));
  assert.throws(() => decodeContract(auditDecisionSchema, { ...audit, integrity: "dirty" }, "AuditDecision"));
});

test("codec rejects empty, corrupt, and unknown-field event lines", () => {
  assert.throws(() => decodeEvent(""), /empty/u);
  assert.throws(() => decodeEvent("{"), /invalid JSON/u);
  assert.throws(() => decodeEvent(JSON.stringify({ ...fixture.events[0], extra: 1 })), /invalid/u);
});

test("TypeScript replay matches the frozen Python worktree golden snapshot", () => {
  const initial = decodeContract(runSnapshotSchema, fixture.initial, "RunSnapshot");
  const events = fixture.events.map((event) => decodeContract(runEventSchema, event, "RunEvent"));
  assert.deepEqual(replay(initial, events), fixture.expected);
});

test("duplicate event is idempotent and stale version fails closed", () => {
  const initial = decodeContract(runSnapshotSchema, fixture.initial, "RunSnapshot");
  const event = decodeContract(runEventSchema, fixture.events[0], "RunEvent");
  const once = applyEvent(initial, event);
  assert.equal(applyEvent(once, event), once);
  assert.throws(() => applyEvent(once, { ...fixture.events[1], expected_version: 0 }), /version conflict/u);
});

test("terminal abandonment records history without mutating accepted work", () => {
  const completed = decodeContract(runSnapshotSchema, fixture.expected, "RunSnapshot");
  const abandoned = decodeContract(runEventSchema, {
    schema_version: 1,
    id: "e13",
    run_id: completed.run_id,
    seq: 13,
    expected_version: 12,
    kind: "episode.abandoned",
    timestamp: "2026-08-09T00:00:13+00:00",
    payload: { episode_id: "executor-lost", role: "executor", host: "codex", work_item_id: "foundation" },
  }, "RunEvent");
  const after = applyEvent(completed, abandoned);
  assert.equal(after.state, "completed");
  assert.equal(after.work_items.foundation.status, "accepted");
  assert.deepEqual(after.verified_progress, completed.verified_progress);
});

test("graph and parallel ownership checks reject unsafe plans", () => {
  const foundation = decodeContract(workItemSchema, fixture.initial.work_items.foundation, "WorkItem");
  assert.throws(() => validateWorkGraph([{ ...foundation, depends_on: ["missing"] }]), /unknown dependency/u);
  assert.throws(() => validateWorkGraph([{ ...foundation, depends_on: [foundation.id] }]), /self dependency/u);
  const other = { ...foundation, id: "other", ownership: ["src/runtime/core/contracts"] };
  assert.throws(() => validateParallelWave([foundation, other]), /ownership overlaps/u);
  assert.equal(scopesOverlap("SRC\\Runtime", "src/runtime/core"), true);
  assert.equal(scopesOverlap("src/runtime", "test/runtime"), false);
});

test("committed JSON Schemas are generated from the runtime Zod source", async () => {
  for (const [name, schema] of Object.entries(runtimeSchemas)) {
    const committed = JSON.parse(await readFile(new URL(`../schemas/mta/v1/${name}.schema.json`, import.meta.url), "utf8"));
    assert.deepEqual(committed, z.toJSONSchema(schema, { target:"draft-2020-12", unrepresentable:"any" }));
    assert.equal(committed.additionalProperties, false);
  }
});
