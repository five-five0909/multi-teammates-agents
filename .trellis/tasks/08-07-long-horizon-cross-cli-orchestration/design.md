# Technical Design: Long-Horizon Cross-CLI Expert Team Orchestration

## 1. Decision summary

Build a shared, local-first orchestration kernel with thin Codex CLI and Claude
Code plugin adapters. Package workflow guidance as skills and expose durable
run-control operations through a bundled local MCP server. Use Trellis as the
storage and project-lifecycle integration layer for managed runs.

The first implementation should keep two execution tiers:

1. `lightweight`: the current skills-first workflow delegates directly to host
   agents and persists no heavy run state.
2. `managed`: a Manager drives audited execution waves through a durable state
   machine whose accepted state is recorded under Trellis.

The user approved this hybrid design on 2026-08-07.

## 2. Why the current skills-only shape is insufficient

A skill can guide decomposition and delegation, but it cannot by itself enforce
atomic persistence, replay, independent evidence acceptance, cross-session
leases, normalized backend events, or deterministic human gates. Those are
stateful capabilities and need one executable owner.

MCP is the common extension point supported by both target plugin systems. A
bundled local MCP server can provide typed run-control tools while skills retain
the user-facing workflow and role guidance. No custom UI is required initially.

## 3. Cross-platform capability map

| Concern | Codex CLI plugin | Claude Code plugin | Shared design |
|---|---|---|---|
| Identity | `.codex-plugin/plugin.json` | `.claude-plugin/plugin.json` | Generate/validate both manifests from one release version. |
| Workflow | `skills/*/SKILL.md` | `skills/*/SKILL.md` | Keep one semantic workflow; render host-specific invocation wording. |
| Specialists | Native Codex subagents and bounded dispatch prompts | Plugin `agents/` plus native subagents | Shared role registry, host adapter chooses native representation. |
| Stateful tools | Inline `mcpServers` map in `.codex-plugin/plugin.json` | Root `.mcp.json` | One local MCP orchestration server and tool schema; keep host-specific wrappers at the packaging boundary. |
| Lifecycle | Plugin `hooks/hooks.json`, user trust required | Plugin `hooks/hooks.json` | Hooks may detect/resume and emit notices; they do not silently start mutations. |
| Inspection | Native agent/thread UI plus structured MCP status | `/context`, scoped agents, background status plus MCP status | `expert_team_status` is the portable minimum. |
| Distribution | Codex marketplace/plugin package | Claude marketplace/plugin package | One repository, two manifests, platform-specific marketplace entries. |

## 4. Proposed repository shape

```text
multi-teammates-agents/
├── .codex-plugin/plugin.json
├── .claude-plugin/plugin.json
├── skills/expert-team/...
├── agents/                         # Claude-native rendered expert definitions
├── hooks/hooks.json
├── .mcp.json
├── runtime/
│   ├── core/                       # state machine, contracts, scheduling
│   ├── adapters/
│   │   ├── codex/
│   │   ├── claude/
│   │   └── trellis/
│   ├── events/                     # schema, decoder, replay reducer
│   └── server/                     # local stdio MCP surface
├── schemas/
├── tests/
└── scripts/
```

The shared runtime is Python and remains standard-library-first unless a new
dependency is separately justified. Serialized contracts remain
language-neutral and versioned.

## 5. Runtime components

### Manager

- Reads the original goal, task contract, verified progress, unresolved work,
  budget, and selected audit references.
- Creates or revises a dependency-aware execution wave.
- Chooses executor profiles but never edits executor evidence into acceptance.
- Routes to execute, ask, block, complete proposal, or cancel.

### Executor

- Receives one bounded objective, dependencies, role contract, ownership,
  permission posture, and evidence requirements in a fresh context.
- May produce changes or observations according to its assigned mode.
- Returns a structured result; it cannot write `verified_progress`.

### Auditor

- Runs independently from the Executor and inspects real artifacts/evidence.
- Returns `accepted`, `rework`, `blocked`, or `invalid`, plus integrity and
  contract-alignment findings.
- Defaults to read-only verification. Any detected unauthorized mutation makes
  integrity fail closed.

## 6. State machine

```text
initialized
    -> managing
    -> executing_wave
    -> auditing_wave
       -> accepted -> managing
       -> rework   -> managing
       -> needs_input
       -> blocked
    -> proposed_complete -> human_gate -> completed
    -> cancelled
```

Only the audit reducer may emit an `evidence.accepted` event. Only accepted
events update verified progress. Completion requires all required contract items
accepted, latest integrity clean, contract aligned, and the configured human
completion gate resolved.

## 7. Core data contracts

- `TaskContract`: immutable goal, constraints, deliverables, acceptance checks.
- `RunSnapshot`: current state, version, verified progress, unresolved items,
  budgets, active leases, and latest event sequence.
- `WorkItem`: ID, objective, role, dependencies, mode, ownership, required flag,
  attempt count, and state.
- `RoleResult`: summary, artifacts, evidence references, checks, risks, failure.
- `AuditDecision`: work item/attempt, status, evidence findings, integrity,
  contract alignment, required rework, and auditor identity.
- `HumanDecision`: gate type, instruction/decision, actor, timestamp, event ID.
- `BackendEvent`: normalized host, role, action kind, tool, status, references,
  and source-event locator.

All external JSON/JSONL is decoded and validated in one event/contract layer.
Views and reducers must not reinterpret raw payloads independently.

## 8. Trellis persistence layout

For a managed run attached to a Trellis task:

```text
.trellis/tasks/<task>/runs/<run-id>/
├── state.json                       # atomic compact snapshot
├── events.jsonl                     # append-only authoritative transitions
├── rounds.jsonl                     # one compact record per orchestration round
├── contract.json
├── work-items/<id>/attempt-<n>.json
├── audits/<id>/attempt-<n>.json
├── decisions.jsonl
└── final-report.md

.trellis/workspace/<developer>/traces/<run-id>/
└── ...                              # bulky raw host trajectories
```

The Trellis adapter is the only writer for this layout. Writes use validated
paths, append discipline, atomic snapshot replacement, monotonic sequence IDs,
and a run lock/lease. Task PRD/design/implement files remain human-curated
planning artifacts rather than event sinks.

## 9. MCP tool surface

Initial portable tools:

- `expert_team_start`: qualify mode, bind/create Trellis task context, persist
  contract, and return the first Manager action.
- `expert_team_status`: return compact state and pending gates.
- `expert_team_next`: advance one legal orchestration transition.
- `expert_team_submit_result`: record a normalized Executor result.
- `expert_team_submit_audit`: validate and record an independent audit.
- `expert_team_answer`: resolve an ask/human gate with an append-only decision.
- `expert_team_resume`: acquire a lease and build compact resume context.
- `expert_team_cancel`: request a safe cancellation without deleting evidence.

Mutation tools require explicit run IDs and optimistic state versions. Tool
schemas reject unknown fields and illegal transitions.

## 10. Host adapter contract

Each adapter owns:

- capability detection and plugin-root resolution;
- role invocation and fresh-context construction;
- foreground/background lifecycle and cancellation;
- raw stream normalization into `BackendEvent`;
- permission prompt propagation without bypass flags;
- path/tool restrictions for Auditor runs;
- final host-native status links or instructions.

The core never parses Codex `exec --json` or Claude `stream-json` directly.

## 11. Interaction contract

- Explicit entry requests may choose `lightweight` or `managed`.
- Automatic routing selects managed mode only when a documented qualifier is
  met: cross-session intent, multiple dependent waves, required durable audit,
  explicit human gates, or evidence volume that exceeds conversation state.
- At each round boundary, show verified progress, rejected/unverified work,
  next plan, budget, and any pending decision.
- Users can inject an instruction at a gate; the instruction becomes a durable
  event and cannot rewrite past audit history.
- Status, resume, and cancel are available on both hosts even if their native
  agent UIs differ.

## 12. Safety and failure behavior

- Never pass `--dangerously-bypass-approvals-and-sandbox` or
  `--dangerously-skip-permissions` from the plugin runtime.
- Never treat an unavailable Auditor as acceptance.
- Failed/corrupt persistence stops advancement and reports recovery guidance.
- Leases expire safely; a second controller cannot concurrently advance the
  same state version.
- Failed optional work is visible and explicitly waived; failed required work
  prevents completion.
- Raw trajectories are diagnostic evidence, not trusted state.

## 13. Migration

The current `$expert-team` behavior becomes `lightweight` compatibility mode.
The role registry remains canonical and gains renderers/adapters rather than a
second list. Existing ledgers are read-only legacy inputs unless an explicit,
versioned importer is later approved.

The current `.trellis/spec/plugin/expert-team-contract.md` forbids an additional
supervisor without separate approval. Starting this task constitutes that
approval only after the spec is updated to describe both modes and the new
runtime boundaries.

## 14. Deliberate differences from LongHorizon-Harness

- Preserve expert-team dependency waves instead of forcing exactly one Executor
  per round.
- Use a bundled plugin-safe supervisor and configured host episodes rather than
  one privileged external harness; never widen the active host permission policy.
- Keep permissions visible and host-controlled.
- Use Trellis as durable project context instead of a parallel `.lh-harness/`
  project lifecycle.
- Defer GUI/dashboard work; keep the core headless and portable.

## 15. Rebaseline: executable task-host architecture

The existing MCP service is a control/data API. It is not the supervisor. Add a
long-running `ManagedRunSupervisor` which is the sole owner of automatic
progression and which uses the existing service/store for every durable change.

```text
Codex skill / Claude command / local launcher
                    |
                    v
          ManagedRunSupervisor
       /            |             \
Manager episode  Executor wave  Auditor wave
       \            |             /
          HostAdapter.run_episode
                    |
          CodexRunner / ClaudeRunner
                    |
        normalized BackendEvent stream
                    |
 ExpertTeamService -> TrellisRunStore -> reducer
                    |
             pending human gate
```

The supervisor must never bypass `ExpertTeamService` to mutate snapshots. It may
read compact projections and role artifacts, but all state changes remain
validated events.

## 16. Episode runner contract

Add `runtime/adapters/base.py` with a typed asynchronous contract:

```text
probe() -> HostCapabilities
run_episode(request, event_sink, cancellation) -> EpisodeResult
cancel(episode_id) -> CancellationResult
```

`EpisodeRequest` includes run/round/attempt identity, role, selected profile,
prompt, workspace, host/model, timeout, output budget, permission posture, and
read-only policy. `EpisodeResult` includes status, visible output, normalized
events, trace reference, timing, exit information, and a secret-redacted error.

Each invocation receives a unique prompt artifact and a new host session. The
runner launches an argument list without a shell, streams stdout/stderr, assigns
the process to a killable process group/job, enforces timeout, drains streams,
and kills descendants on cancellation. Raw output is diagnostic-only and is
written to the Trellis trace area, not the authoritative reducer log.

### Codex runner

- Launch `codex exec --json` with prompt over stdin.
- Do not pass `--dangerously-bypass-approvals-and-sandbox`.
- Resolve the installed plugin/workspace explicitly and preserve host approval
  and sandbox configuration.
- Parse JSONL incrementally and fail on malformed terminal output while retaining
  the trace and diagnostics.

### Claude runner

- Launch Claude in print/stream-json mode with prompt over stdin.
- Do not pass `--dangerously-skip-permissions`.
- Apply role-specific tool restrictions, especially Auditor write restrictions.
- Parse stream-json incrementally and preserve permission-required events.

## 17. Supervisor algorithm

For each round, under the run lease:

1. Reconcile any persisted in-flight episode with the operating-system process
   registry and mark abandoned work explicitly.
2. Build the Manager prompt from compact authoritative state.
3. Run a fresh Manager episode and strictly parse one route:
   `execute`, `ask`, `blocked`, `propose_complete`, or `cancel`.
4. Validate the proposed dependency-ready wave and ownership scopes.
5. Run eligible Executors with bounded concurrency and one fresh episode per
   work item. Persist each unverified result.
6. For every result, run a separate Auditor identity/session with the workspace
   guard. Audits may be concurrent only when their read scopes and process policy
   are safe.
7. Reduce accepted/rework/blocked decisions and persist the complete round
   projection.
8. Open a human gate when policy requires it; otherwise continue automatically.

Invalid Manager output creates durable repair feedback and consumes a bounded
attempt. It never defaults to execution or completion. A missing/unavailable
Auditor blocks acceptance.

## 18. Auditor integrity guard

Add a shared, host-neutral workspace guard:

- take a bounded manifest before audit using path, type, size, modification
  metadata, and content digest where safe;
- take the same manifest after audit;
- report added, deleted, changed, and type-changed entries;
- reject the audit if either snapshot is incomplete or inconsistent;
- reject acceptance on any unauthorized mutation;
- keep restoration separate from acceptance and record whether restoration was
  attempted and verified.

Auditor prompt/tool restrictions are defense in depth. Snapshot/diff enforcement
is the authoritative integrity check.

## 19. Prompt and parser ownership

Add `runtime/prompts/` as the only owner of Manager, Executor, and Auditor prompt
construction and structured-output parsing. Prompts are versioned and include a
machine-readable envelope plus human-readable role instructions. Parsers reject
unknown fields, invalid routes, mismatched work/attempt identities, self-audit,
and missing evidence.

Manager history is composed from verified progress, unresolved work, operator
instructions, budget, and explicitly selected audit references. Character/token
limits are enforced before invocation and recorded in episode metadata.

## 20. Configuration

Use a versioned project file such as `.expert-team/config.toml`. Resolution is:

```text
explicit run arguments > project config > environment-backed secret/endpoint
overrides > built-in defaults
```

Role bindings inherit from run defaults and can override host, model, timeout,
and context/output budgets. Configuration decoding is strict. API keys and other
secret values are never serialized into Trellis task/run files, prompts, command
metadata, or errors.

## 21. Human interaction without a custom dashboard

The first milestone remains headless. When a gate opens, the supervisor persists
the gate and exits or waits in a resumable paused state. The Codex/Claude skill
renders the same compact gate view, asks the user through the host conversation,
records the answer with `expert_team_answer`, and resumes the supervisor.

Status output must distinguish verified, unverified, rework, blocked, in-flight,
abandoned, pending permission, and pending human decision states.

## 22. Verification topology

Testing is layered so simulated evidence cannot be confused with real parity:

1. unit tests: contracts, parsers, prompt clipping, reducer, workspace diff;
2. fake-process integration: streaming, timeout, cancellation, malformed output,
   crash recovery, permission event propagation;
3. local binary smoke: discovery/version and non-billable lifecycle where the
   host supports it;
4. model-backed E2E: one bounded two-round scenario on Codex and Claude with a
   failed audit/rework path and final human completion gate.

Model-backed tests are opt-in and must report cost-bearing prerequisites. The
task cannot be marked complete until their evidence is recorded for both hosts.

## 23. Upstream reuse discipline

Use the pinned LongHorizon-Harness commit recorded in
`research/longhorizon-gap-rebaseline.md`. Before copying code, record the source
file, relevant symbols, license, intended changes, and rejected behavior. Keep
the local contract names and Trellis persistence model. Never import upstream
permission-bypass defaults, dashboard, computer-use installers, or remote
environment code as incidental dependencies.
