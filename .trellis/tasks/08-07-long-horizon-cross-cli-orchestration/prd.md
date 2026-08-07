# Long-Horizon Cross-CLI Expert Team Orchestration

## Goal

Evolve the existing Expert Team plugin from a prompt-only, Codex-specific
orchestration workflow into a resumable long-horizon task host that works on
both Codex CLI and Claude Code.

The interaction and run-control model will adapt the portable parts of
LongHorizon-Harness: strict Manager / Executor / Auditor separation, fresh
execution contexts, evidence-backed progress, bounded retries, human gates,
and resumable state. Trellis will be the durable source of truth for complex
and cross-session work; lightweight expert requests must remain low-overhead.

## 2026-08-07 completion rebaseline

The first verification report proved the schema, reducer, Trellis store, MCP
control API, and package structure, but incorrectly treated simulated host
events and caller-driven transitions as proof of a working long-horizon task
host. This task remains `in_progress` until the runtime itself can invoke role
episodes and drive the Manager -> Executor -> Auditor loop on both target hosts.

The following do **not** count as end-to-end completion:

- manually calling `start_execution`, `submit_result`, and `submit_audit` from a
  test or lead conversation;
- normalizing hand-authored Codex/Claude fixture events;
- validating manifests or starting the MCP process without executing a role;
- accepting an externally supplied audit object without launching a protected,
  independent Auditor episode.

The user approved and explicitly started this task on 2026-08-07. It is now an
active implementation project governed by the rebaselined acceptance criteria.

## Confirmed baseline

- The current repository already ships a skills-first Codex plugin with a
  native expert-team workflow, six Qoder-derived fallback roles, and twenty
  separately maintained public ExpertTeam-Codex profiles.
- The original plugin delegated execution to native Codex subagents. The current
  foundation adds an MCP state/control API and cross-session store, but still has
  no independent process supervisor or executable role runners.
- LongHorizon-Harness commit `b1b804519c1ffe1b00e60c19290157c82e3e5c83`
  was inspected from a read-only shallow clone. It uses a Manager -> Executor
  -> Auditor loop and persists task state, append-only round/event records,
  audits, trajectories, workspace evidence, and a final report.
- LongHorizon-Harness only merges independently audited work into verified
  progress. Completion additionally requires clean integrity and contract
  alignment.
- Codex plugins can package skills, bundled MCP servers, and lifecycle hooks
  behind `.codex-plugin/plugin.json`.
- Claude Code plugins can package skills, custom agents, hooks, MCP servers,
  executables, and settings behind `.claude-plugin/plugin.json`; plugin
  components are namespaced and installed from marketplaces or loaded locally.
- Codex and Claude Code expose different native agent lifecycle and inspection
  surfaces. Cross-platform parity therefore requires a shared logical contract
  plus host-specific adapters, not identical prompts alone.

## Requirements

- R1. Provide one platform-neutral orchestration contract and two supported
  packaging surfaces: Codex CLI and Claude Code.
- R2. Preserve strict role boundaries:
  - Manager owns goal interpretation, contract, decomposition, scheduling, and
    next-step selection; it does not claim execution evidence.
  - Executors receive one bounded assignment in a fresh context and return
    artifacts plus evidence; they cannot certify their own work.
  - Auditors independently inspect actual files, commands, tests, logs, or UI
    evidence and return an explicit acceptance decision.
- R3. Only auditor-accepted evidence may enter `verified_progress`. Executor
  summaries, optimistic claims, and incomplete output remain unverified.
- R4. Adapt the existing expert catalog as executor profiles. Coordinator
  profiles are Manager playbooks and must not be recursively dispatched as
  nested managers.
- R5. Schedule dependency-aware waves. Independent read work and explicitly
  disjoint writes may run concurrently; overlapping or unknown write scopes
  must be sequenced.
- R6. Define a resumable state machine with explicit states for planning,
  execution, audit, rework, user input, blocked, completed, and cancelled.
- R7. Persist complex managed runs in Trellis with a single schema owner:
  compact authoritative snapshots, append-only events/rounds, audit decisions,
  work-item results, human decisions, and final reports. Raw high-volume role
  trajectories must be separated from compact task planning documents.
- R8. Keep a lightweight mode for bounded work. Lightweight runs use native
  host agents and conversation state without creating heavy Trellis run logs.
- R9. Support interruption and resume without replaying the full conversation.
  A resumed Manager receives the contract, verified progress, unresolved work,
  selected evidence references, and current budget—not raw historical traces.
- R10. Normalize Codex and Claude role events into one backend-neutral event
  taxonomy before reducers, status views, or audit logic consume them.
- R11. Provide human gates for completion, requests for input, repeated audit
  failures, blocked work, budget exhaustion, and cancellation. Human decisions
  are append-only and attributable.
- R12. Enforce bounded rounds, per-role timeouts, retry ceilings, and context
  budgets. Repeated identical failures must escalate instead of looping.
- R13. Never widen the host's permissions. The design must not copy upstream
  `dangerously-*` flags; sandboxing, approvals, and tool policy remain under the
  active Codex or Claude host and user configuration.
- R14. Preserve the existing explicit/implicit Expert Team entry experience and
  all twenty specialist identities. Existing lightweight behavior remains a
  compatible fallback when managed mode is unavailable.
- R15. Keep the shared orchestration core independent of either CLI's raw event
  format. Codex and Claude adapters own invocation, event normalization,
  cancellation, permission surfacing, and capability detection.
- R16. Do not copy LongHorizon-Harness source wholesale. Reuse is limited to
  MIT-compatible, attributed concepts or deliberately selected code after a
  file-level review.
- R17. Add an executable supervisor that owns the continuous managed loop. It
  must build a compact Manager prompt, invoke the configured Manager backend,
  parse a strict route, dispatch the selected dependency-ready wave, wait for
  role completion, invoke independent Auditors, reduce accepted evidence, and
  continue until a terminal state or human gate.
- R18. Implement real Codex and Claude episode runners behind one `HostAdapter`
  contract. Each runner must create a fresh role context, launch the actual host
  runtime, stream and normalize events, enforce episode timeout, support safe
  cancellation/process cleanup, report capability/permission failures, and
  never add approval- or sandbox-bypass flags.
- R19. The Manager output must be strictly parsed and fail closed. Invalid or
  empty routes become durable repair feedback; they cannot be interpreted as
  execution or completion. A completion proposal is legal only after all
  required work has a clean, aligned, independent accepted audit.
- R20. Auditors must be launched independently from Executors with an explicit
  read-only policy. The runtime must snapshot the task workspace before and
  after audit, detect added/deleted/changed/type-changed paths, and reject the
  audit whenever inspection is incomplete or mutation integrity is uncertain.
- R21. Implement actual prompt construction and context budgets for all roles.
  Manager input contains the original goal, authoritative contract, verified
  progress, unresolved work, budgets, current operator instruction, and selected
  audit references. It excludes raw role trajectories and unrelated historical
  reports. Executor and Auditor prompts are bounded to one work item/attempt.
- R22. Add versioned runtime configuration with defaults, project configuration,
  environment/CLI overrides, and secret-safe handling. It must support per-role
  host, model, timeout, context/output limits, maximum rounds, retry ceilings,
  workspace, trace policy, and human-gate policy, with documented precedence.
- R23. Human gates must be operational, not only representable in state. The
  supervisor pauses on ask, blocked, repeated failure, budget exhaustion,
  proposed completion, permission request, and cancellation; exposes the exact
  pending decision through both plugin surfaces; and resumes only after an
  attributable append-only answer or explicit policy decision.
- R24. Managed execution must survive controller or host interruption. Resume
  must reconcile leases and in-flight episodes, never silently repeat accepted
  work, make abandoned attempts explicit, and reconstruct the next Manager
  episode from compact durable state.
- R25. Add a real run entry point and lifecycle UX for Codex CLI and Claude Code:
  start, foreground progress, status, answer, resume, and cancel. Both packages
  must expose equivalent semantics even where their native presentation differs.
- R26. Maintain a source-reuse ledger for LongHorizon-Harness. Every transplanted
  file or algorithm records upstream commit/path, license, local adaptation, and
  excluded unsafe behavior. Preserve attribution and do not import dashboard,
  GUI/computer-use, remote environment, or bypass-permission code unless a later
  requirement explicitly brings it into scope.

## Constraints

- Trellis remains the project/task lifecycle authority; the new runtime may
  write only through a documented Trellis integration adapter and schema.
- Introducing a process/MCP supervisor changes the current plugin contract and
  requires an approved spec update before implementation.
- The solution must work without Qoder installed and must not depend on Qoder
  private endpoints, bundles, prompts, or accounts.
- No custom dashboard is required for the first implementation milestone; CLI
  summaries and native Codex/Claude inspection surfaces are sufficient.
- A task cannot be marked complete solely because an Executor says it is done.
- Planning artifacts must distinguish upstream facts, design inferences, and
  decisions still awaiting user approval.

## Acceptance Criteria (rebaselined)

- [x] AC1. Both a valid Codex plugin package and a valid Claude Code plugin
  package expose the same logical Expert Team managed workflow.
- [ ] AC2. One representative scenario produces the same contract, work-item
  identities, dependency semantics, audit outcomes, and final completion rule
  through real role episodes on both hosts.
- [ ] AC3. An Executor success claim with failing evidence is rejected by a
  separately launched, read-only Auditor; it does not
  update verified progress and creates bounded rework or a blocker.
- [x] AC4. A run interrupted after any durable transition resumes from Trellis
  without losing accepted evidence or repeating already accepted work.
- [x] AC5. Event replay reconstructs the same state as the latest atomic
  snapshot, and truncated/corrupt tail records fail safely with diagnostics.
- [ ] AC6. Concurrent write tests allow disjoint ownership and reject or
  sequence overlapping ownership on both host adapters.
- [ ] AC7. Operational human-gate tests cover ask, blocked, repeated failure,
  budget limit, proposed completion, permission request, instruction injection,
  and cancellation, including pause and resume through both plugin surfaces.
- [ ] AC8. Real runner invocation tests prove that neither adapter injects
  approval-bypass or sandbox-bypass flags and that actual permission requests
  remain visible to users.
- [ ] AC9. A bounded lightweight request creates no managed-run directory,
  while an explicit or auto-qualified long-horizon request creates a valid
  Trellis-backed run record.
- [ ] AC10. Context-budget tests prove actual Manager resume prompts use compact state
  and selected evidence references rather than full role trajectories.
- [x] AC11. Every existing specialist profile remains addressable, role duties
  stay separated, and coordinator profiles cannot be dispatched as Executors.
- [ ] AC12. Official/local validators pass for both plugin formats, and unit,
  state-machine, replay, runner-contract, process-cleanup, and real end-to-end
  resume tests pass on Codex CLI and Claude Code.
- [ ] AC13. Documentation includes installation, invocation, configuration,
  backend prerequisites, managed/lightweight
  mode selection, status/resume/cancel flows, Trellis storage, permissions,
  failure semantics, migration, and rollback.
- [ ] AC14. Starting a managed run causes the supervisor—not a test or human
  caller—to invoke a Manager episode and autonomously drive at least two complete
  Manager -> Executor -> Auditor rounds.
- [ ] AC15. Codex and Claude runners demonstrably create fresh role sessions,
  enforce configured timeouts, stream normalized events, and terminate child
  processes on timeout/cancel without orphaning them.
- [ ] AC16. Auditor mutation tests cover add, edit, delete, rename/type change,
  unreadable paths, snapshot failure, and restoration failure; every uncertain
  case rejects acceptance fail closed.
- [ ] AC17. Configuration precedence tests cover explicit invocation override >
  project config > environment/defaults, per-role fallback, invalid combinations,
  and proof that secrets are not persisted in run artifacts or logs.
- [ ] AC18. Crash/restart tests interrupt every episode boundary and prove that
  accepted work is not repeated, abandoned work is explicit, and the resumed
  Manager sees only compact authoritative context.
- [ ] AC19. No acceptance criterion may be closed using fixture-only host events
  where it claims real host execution. The verification report must distinguish
  unit, simulated integration, local CLI smoke, and model-backed end-to-end proof.

## Out of scope for the first implementation milestone

- A graphical dashboard or MCP Apps UI.
- Remote hosted orchestration, billing, or model brokering.
- General computer-use automation beyond host-native tools.
- Pixel-identical or source-identical emulation of LongHorizon-Harness or Qoder;
  the Manager/Executor/Auditor task-hosting behavior above is in scope.
- Automatic migration or deletion of existing user run records.

## Product decision

- D1. Approved on 2026-08-07: use a hybrid policy—lightweight native execution
  by default, and Trellis-managed mode when explicitly requested or when the
  task is cross-session, multi-wave, evidence-heavy, or requires human gates.
