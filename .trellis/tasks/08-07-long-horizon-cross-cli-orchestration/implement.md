# Implementation Plan: Long-Horizon Cross-CLI Expert Team Orchestration

## Task shape

Keep one parent Trellis task because the shared contracts, persistence schema,
and cross-host acceptance gate form one product change. During implementation,
split work into child tasks only when ownership is disjoint and each child has
an independently testable deliverable.

## Phase 0 — decision and activation

- [x] Confirm the hybrid lightweight/managed policy in `prd.md`.
- [x] Review and approve `prd.md`, `design.md`, and this implementation plan.
- [x] Update the active plugin specification to authorize and constrain the new
  supervisor/MCP boundary.
- [x] Start this Trellis task only after approval.

## Phase 1 — contract and schema foundation

- [x] Define versioned schemas for task contract, snapshot, work item, role
  result, audit decision, human decision, and backend event.
- [x] Implement one strict decoder/validator and replay reducer.
- [x] Implement state-transition guards, completion invariant, retry/budget
  limits, ownership conflict detection, and optimistic versions.
- [x] Add golden replay, invalid transition, corrupted tail, and idempotency
  tests before host integration.

Rollback: schemas and core live behind managed-mode capability detection; the
existing lightweight skill remains unchanged.

## Phase 2 — Trellis storage adapter

- [x] Finalize the managed-run directory contract and retention policy.
- [x] Implement validated task/run path resolution, atomic snapshots,
  append-only writers, sequence assignment, leases, and recovery diagnostics.
- [x] Separate compact task state from bulky per-developer trajectories.
- [x] Test crash boundaries around every durable transition and prove replay
  equals the latest valid snapshot.

Rollback: disable managed mode; do not delete user-owned run evidence.

## Phase 3 — orchestration service and MCP surface

- [x] Implement an automatic Manager -> Executor wave -> Auditor wave supervisor.
- [x] Implement typed start/status/next/submit/answer/resume/cancel MCP tools.
- [x] Enforce distinct audit identity and prevent Executor self-acceptance in the
  reducer contract.
- [x] Launch the Auditor independently and enforce actual evidence inspection.
- [x] Produce bounded role prompts from compact state and selected evidence.
- [ ] Make human gates operational through both plugin interaction surfaces.

Rollback: remove MCP declaration from both manifests and retain lightweight
skills-only operation.

## Phase 4 — Codex CLI adapter

- [x] Add host-managed bundled MCP configuration and required manifest fields
  (Codex inline map; Claude root `.mcp.json`).
- [x] Add a cross-platform Node MCP launcher that selects `python`/`py -3` on
  Windows and `python3`/`python` on POSIX systems without editing user config.
- [x] Keep MCP startup and project TOML configuration importable on Python 3.10
  with the bundled TOML backport; do not install a user dependency.
- [x] Render Codex-specific skill instructions.
- [x] Implement executable Codex capability probing.
- [x] Normalize Codex agent/tool events without leaking raw formats into core.
- [x] Implement real Codex episode invocation, fresh context, event streaming,
  timeout, cancellation, process cleanup, and permission propagation.
- [x] Validate hook trust behavior; no hook is bundled in the first milestone,
  so enabling the plugin cannot silently start a managed run.
- [x] Run official Codex plugin/skill validators and simulated adapter tests.
- [ ] Run real Codex runner smoke and model-backed end-to-end tests.

## Phase 5 — Claude Code adapter and package

- [x] Add `.claude-plugin/plugin.json`, namespaced skills, rendered custom agent
  definitions, and bundled MCP configuration. No automatic hook is needed for
  the first milestone.
- [x] Use `${CLAUDE_PLUGIN_ROOT}` for installed paths and keep components at the
  plugin root.
- [x] Normalize foreground/background subagent events and permission prompts.
- [x] Implement real Claude episode invocation, fresh context, event streaming,
  timeout, cancellation, process cleanup, and permission propagation.
- [x] Validate with `claude plugin validate`; avoid a model-billed `--plugin-dir`
  prompt in automated tests and smoke-test the shared MCP launcher directly.
- [x] Verify every expert identity and coordinator boundary matches Codex.
- [ ] Run real Claude runner smoke and model-backed end-to-end tests.

## Phase 6 — interaction, migration, and documentation

- [x] Document the implemented explicit lightweight/managed entry, automatic qualification,
  status, resume, answer, cancel, and failure semantics on both hosts.
- [x] Document Trellis storage, retention, recovery, privacy, and cleanup.
- [x] Add a portable CC Switch configuration generator and document Windows,
  Ubuntu, and WSL setup without user-specific absolute paths.
- [x] Document the LongHorizon-Harness adaptation and attribution.
- [x] Preserve current `$expert-team` scenarios as compatibility tests.
- [x] Keep marketplace mutation out of this task because no personal/team
  distribution destination was selected; document local validation instead.

## Phase 7 — full verification

- [x] Run unit tests for schemas, state machine, replay, leases, scheduling,
  audit invariants, and context clipping.
- [x] Run simulated contract tests against fake Codex and Claude event streams.
- [x] Run fake-process integration tests for streaming, timeout, cancellation,
  malformed output, crash recovery, and orphan cleanup.
- [ ] Run model-backed end-to-end interrupt/resume, failed audit/rework, human
  gate, permission, cancellation, and concurrent ownership scenarios on both
  hosts.
- [x] Map every rebaselined PRD acceptance criterion to correctly classified
  evidence in `check.md`.
- [ ] Run `trellis-check`, then perform a cross-platform runtime drift review.

## Phase 8 — upstream reuse ledger and executable contracts

- [x] Inventory the pinned upstream Manager, prompt, adapter, Auditor guard,
  configuration, logging, and process-cleanup implementations.
- [x] For every selected algorithm/file, record upstream commit/path, license,
  local adaptation, tests, and deliberately excluded behavior.
- [x] Define `HostAdapter`, `HostCapabilities`, `EpisodeRequest`,
  `EpisodeResult`, cancellation, process identity, and normalized stream event
  contracts.
- [x] Define durable episode-started/completed/abandoned/timeout/cancelled events
  and upgrade/replay behavior for existing schema-v1 runs.
- [x] Update `THIRD_PARTY_NOTICES.md` and source headers for derived code.

Gate: no runner implementation begins until the process, permission, secret,
and persistence contracts pass review.

## Phase 9 — process runtime and real host runners

- [x] Implement shell-free asynchronous child-process execution with stdin
  prompts, incremental stdout/stderr draining, trace redaction, timeout, and
  Windows/POSIX descendant cleanup.
- [x] Implement Codex capability probing and `codex exec --json` runner without
  approval/sandbox bypass flags.
- [x] Implement Claude capability probing and stream-json runner without
  permission bypass flags.
- [x] Connect both streams to the existing event normalizers and diagnostic
  trace store; malformed terminal streams fail closed.
- [x] Add fake executable fixtures for deterministic lifecycle, permission,
  timeout, crash, and cancellation tests.

Gate: both runners pass the same adapter contract suite and leave no child
process after timeout/cancel.

## Phase 10 — prompts, parsers, and automatic supervisor

- [x] Port/adapt bounded Manager, Executor, and Auditor prompt construction from
  the reviewed upstream concepts into `runtime/prompts/`.
- [x] Implement strict Manager route and role-result parsing with repair
  feedback for invalid/empty output.
- [x] Implement `ManagedRunSupervisor` and its continuous bounded loop.
- [x] Schedule dependency-ready waves, invoke fresh Executor episodes, persist
  unverified results, and invoke separate Auditor episodes automatically.
- [x] Make retry, round, timeout, permission, cancellation, and completion paths
  converge on explicit durable terminal/gate states; model-backed cross-host
  interruption remains an acceptance gate.

Gate: a fake-backend two-round scenario runs from one start call with no manual
`next/result/audit` calls.

## Phase 11 — independent Auditor integrity

- [x] Implement bounded workspace snapshots and add/delete/change/type-change
  diffing with Windows path and unreadable-file handling.
- [x] Add role-specific Auditor prompt/tool restrictions for both hosts.
- [x] Reject audits on mutation, incomplete snapshot, malformed report,
  mismatched work/attempt, self-audit, unavailable Auditor, or uncertain restore.
- [x] Record evidence provenance and workspace-guard diagnostics without placing
  bulky manifests in compact task state.
- [x] Test mutation, unreadable-file, snapshot-failure, and restoration-
  uncertainty paths fail closed without automatic file restoration.

Gate: an Executor success claim cannot become verified progress unless a real
independent Auditor episode and integrity guard both pass.

## Phase 12 — configuration, gates, and lifecycle UX

- [x] Implement strict versioned project configuration and precedence resolution
  for per-role host/model/timeout/context/output settings.
- [x] Prove secrets are sourced at runtime, redacted, and absent from prompts,
  command metadata, events, snapshots, reports, and diagnostics.
- [x] Add MCP and repository-CLI start/foreground/status/resume/answer/cancel
  entry points backed by the same service contracts.
- [x] Implement and test deterministic lightweight/managed qualification so a
  bounded preview creates no managed run and an explicit managed `auto_start`
  request creates one in the same MCP operation.
- [x] Update Codex and Claude skill instructions to drive the same paused human
  gate contract through their native conversation UX.
- [x] Add in-flight reconciliation and abandoned-attempt recovery on resume.

Gate: ask, permission, blocked, repeated failure, budget, completion, and cancel
all pause/resume correctly on both package surfaces.

## Phase 13 — real cross-host acceptance

- [x] Run official plugin/skill validators and all unit/simulated integration
  tests.
- [x] Smoke-test the bundled MCP initialize handshake through the installed
  plugin shape on Windows and Ubuntu 22.04 (WSL).
- [x] Re-test fresh public plugin installation on isolated Codex and Claude
  config directories after the host-specific MCP packaging fix (`0.3.2`).
- [x] Run local Codex and Claude binary probes and runner smoke tests.
- [ ] With explicit cost-bearing test authorization, run one bounded two-round
  model-backed scenario on Codex and the same scenario on Claude. Codex passed
  as `e2e-codex-20260807-r3`; Claude is blocked by local organization/account
  model access in `e2e-claude-20260807`.
- [ ] Run a failed-audit/rework scenario and a crash/resume scenario on both
  hosts, recording run IDs, versions, trace references, and final evidence.
- [ ] Verify no permission-bypass flags, orphan processes, leaked secrets, or
  repeated accepted work. Codex real traces and runner tests cover bypass flags
  for the passing scenario; full cross-host and leak/orphan matrix remains open.
- [x] Update documentation and map AC1-AC19 to proof levels in `check.md`.

Gate: AC2, AC3, AC7, AC8, AC10, and AC12-AC19 remain open until their required
real-host evidence exists.

## Phase 14 — finish

- [x] Run `trellis-check` across runtime, schemas, tests, packages, and docs.
- [x] Run `trellis-update-spec` for runner, supervisor, Auditor integrity,
  configuration, and proof-level contracts.
- [x] Review the complete diff and source-reuse ledger.
- [x] Commit on a real Git worktree and record the commit in the task.
- [ ] Run `trellis-finish-work` only after every required AC is closed.

## Implementation workstreams

1. `episode-contracts`: shared runner/config/process/event contracts.
2. `process-runtime`: streaming, timeout, cancellation, cleanup, redaction.
3. `codex-runner`: actual Codex episodes and capability/permission handling.
4. `claude-runner`: actual Claude episodes and capability/permission handling.
5. `supervisor-prompts`: role prompts/parsers and continuous managed loop.
6. `auditor-integrity`: read-only policies, workspace guard, fail-closed audit.
7. `lifecycle-ux`: configuration, gates, resume/reconciliation, plugin guidance.
8. Parent integration: real cross-host E2E, documentation, reuse ledger, release.

Contracts and process runtime are sequential foundations. Codex and Claude
runners can proceed independently only after that contract is frozen. The
supervisor consumes both through the shared interface; Auditor integrity and
lifecycle UX integrate after the supervisor's fake-backend gate passes. Parent
integration owns schema migration and final cross-host evidence.

## Quality gates

- No platform adapter can mutate verified progress directly.
- No raw event consumer defines a private schema.
- No bypass-permission flags appear in source, fixtures, or documentation except
  explicit deny-list tests.
- A successful final state must be reproducible from durable events.
- Both platform packages must expose equivalent user-visible lifecycle actions.
- Lightweight mode must remain functional if MCP startup or Trellis managed
  mode is unavailable.
