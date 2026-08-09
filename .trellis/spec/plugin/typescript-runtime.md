# TypeScript Managed Runtime

## 1. Scope / Trigger

Apply this specification when changing `src/runtime/`, `schemas/mta/`, the
TypeScript golden fixtures, or the new managed-run persistence boundary. The
Python runtime is a migration oracle only; new product runs use the TypeScript
path and never fall back to Python.

## 2. Signatures

```text
TrellisRunStore.create(runId, contract, workItems, options) -> Promise<RunSnapshot>
TrellisRunStore.append(event, { owner, leaseSeconds? }) -> Promise<RunSnapshot>
RuntimeRepository.transition(kind, payload, owner?) -> Promise<RunSnapshot>
ManagedRunSupervisor.run() -> Promise<{ snapshot, episodeIds }>
HostAdapter.probe() -> Promise<HostCapabilities>
HostAdapter.runEpisode(request, signal?) -> Promise<EpisodeResult>
```

## 3. Contracts

- External JSON and JSONL enter only through Zod schemas in the runtime,
  apply-control, and host-adapter boundaries. Apply plans/receipts and Episode
  requests/results and cancellation results are parsed at the real transaction/process boundary, not
  treated as static TypeScript-only interfaces.
- `src/contracts/public-schemas.ts` collects all 15 current public schemas:
  TaskContract, WorkItem, RoleResult, AuditDecision, DecisionProvenance,
  HumanDecision, BackendEvent, RunEvent, RunSnapshot, ApplyPlan, ApplyReceipt,
  HostCapabilities, EpisodeRequest, EpisodeResult, and CancellationResult. TypeScript types and
  `schemas/mta/v1/*.schema.json` come from those same Zod sources.
- The npm package includes only `schemas/mta/`; legacy `schemas/v1` and
  `schemas/v2` remain in the repository as migration material but never enter
  the tarball.
- New runs live under `.trellis/tasks/<task>/mta-runs/<run-id>/`. Legacy
  `runs/` directories remain read-only and are never imported or deleted.
- A mutation validates and reduces first, appends and fsyncs `events.jsonl`,
  then atomically replaces `state.json`.
- Parallel Episode callbacks enter one repository mutation queue before the
  filesystem lease, so only one writer assigns the next sequence/version.
- Only an independent `accepted + clean + aligned` audit adds
  `verified_progress`; Auditor requests are separate and read-only.
- `executor.result_submitted` carries the complete strict `RoleResult`. Resume
  rebuilds a missing attempt projection from that event instead of repeating
  submitted work.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Unknown contract field or invalid cross-field invariant | Reject at the Zod boundary. |
| Tarball contains a schema outside `schemas/mta/` | Fail the pack/install smoke. |
| Duplicate event ID | Return the current snapshot without another log record. |
| Stale `expected_version` or non-monotonic sequence | Reject without writing. |
| Snapshot behind the event log | Replay and atomically repair the projection. |
| Snapshot ahead of the log or corrupt JSONL tail | Fail closed with recovery diagnostics. |
| Active lease owned by another controller | Raise `LeaseConflict`; never overwrite. |
| Unmatched `episode.started` after restart | Append `episode.abandoned`; do not repeat accepted work. |
| Auditor changes the workspace or snapshot is incomplete | Record invalid/dirty audit and leave verified progress unchanged. |
| Role result projection missing after a crash | Rebuild it from the authoritative submitted-result event. |

## 5. Good / Base / Bad Cases

- Good: one foreground call completes two dependency-ordered rounds with fresh
  Executor and separate Auditor episode IDs.
- Base: status/load replays an empty event log to the initialized snapshot.
- Bad: two callbacks read the same version and call the store directly in
  parallel.
- Bad: a convenience result file is treated as more authoritative than the
  event that submitted it.

## 6. Tests Required

- Zod strictness across all 15 public schemas, JSON Schema generation stability, codec corruption, graph
  cycles, ownership overlap, event idempotency, stale versions and cancellation
  races.
- Frozen Python-worktree golden replay without launching Python from Node tests.
- `mta-runs/` isolation, event-first repair, ahead-snapshot rejection, leases,
  redaction and missing-projection healing.
- Fake-host two-round Supervisor, audit rework, every human gate, timeout,
  external cancellation, abandoned recovery and Auditor mutation fail-closed.
- Windows and POSIX Node 22/24 verification; Windows shim assertions may be
  skipped only on non-Windows hosts.

## 7. Wrong vs Correct

### Wrong

```typescript
await Promise.all(events.map((event) => store.append(event, options)));
```

Each caller may have read the same version before taking the disk lease.

### Correct

```typescript
await repository.transition(kind, payload);
```

The repository serializes version assignment; the store lease protects the
durable write.
