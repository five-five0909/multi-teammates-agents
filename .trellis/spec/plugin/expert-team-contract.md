# Expert Team Plugin Contract

## 1. Scope / Trigger

Apply this specification when changing either platform manifest, the
`skills/expert-team/` payload, the expert registry, the managed orchestration
runtime, its task-plan fixtures, or its validators.

The plugin has two approved execution tiers:

- `lightweight` remains skills-first and uses host-native agents without heavy
  runtime persistence.
- `managed` uses the approved local orchestration/MCP boundary for resumable,
  audited, Trellis-backed work.

Do not add another orchestration authority outside these two tiers. Trellis is
the durable project/task authority for managed runs.

## 2. Signatures

Explicit user entry:

```text
$expert-team [software|product|design|ops|security|database] <request>
/multi-teammates-agents:expert-team <request>  # Claude Code
```

Managed MCP entry points:

```text
expert_team_qualify(request, explicit?, dependency_waves?, durable_audit?, human_gate?, cross_session?)
expert_team_start(task_id, run_id, contract, work_items, max_rounds?, retry_limit?)
expert_team_run(task_id, run_id, config_overrides?)
expert_team_status(task_id, run_id)
expert_team_next(task_id, run_id, action, payload)
expert_team_submit_result(task_id, run_id, result)
expert_team_submit_audit(task_id, run_id, audit)
expert_team_answer(task_id, run_id, decision)
expert_team_resume(task_id, run_id)
expert_team_cancel(task_id, run_id)
expert_team_record_host_event(task_id, run_id, host, role, event)
```

Local lifecycle entry:

```text
python scripts/expert_team_run.py --probe
python scripts/expert_team_run.py --task-id <task> --run-id <run>
python scripts/expert_team_run.py --task-id <task> --run-id <run> --quiet
python scripts/expert_team_run.py --task-id <task> --run-id <run> --json
```

The local runner prints a public round-by-round narrative by default. `--quiet`
preserves the legacy snapshot JSON output for scripts, while `--json` emits a
compact structured public projection. Neither mode exposes raw host stdout,
private reasoning, secrets, or command metadata; the projection reads only
validated run events, role results, audits, and persisted Trellis references.

The MCP `expert_team_run` response keeps the existing `snapshot` and
`episode_ids` fields and adds `console` (the structured public projection) and
`narrative` (the same projection rendered as terminal text). Its MCP text
content is `narrative`; callers that need automation should consume
`structuredContent.console` or use the local runner's `--json` mode.

Executable managed-host boundary (required before managed mode may claim runtime
completion):

```text
HostAdapter.probe() -> HostCapabilities
HostAdapter.run_episode(EpisodeRequest, event_sink, cancellation) -> EpisodeResult
HostAdapter.cancel(episode_id) -> CancellationResult
ManagedRunSupervisor.run(task_id, run_id) -> RunSnapshot
```

`run_episode` launches a real fresh Codex or Claude role session. An event
normalizer alone is not a `HostAdapter` implementation.

Mutation calls include a run ID and are converted to `RunEvent` records with
monotonic `seq` and optimistic `expected_version`. The runtime owns event IDs
and timestamps.

Validator entry:

```text
python scripts/validate_contract.py <fixture.json|fixture-directory>
```

The validator exits `0` when every fixture matches `expected_valid`, `1` for a
contract or JSON failure, and `2` when no fixture is found.

## 3. Contracts

The Codex manifest name must equal the plugin-root directory name, its `skills`
field must be `./skills/`, and `mcpServers` must resolve to `./.mcp.json`.
The bundled MCP entry must launch through the package-dependency-free
cross-platform bridge in `scripts/expert_team_mcp_launcher.js`: it selects
`python`/`py -3`
on Windows and `python3`/`python` on POSIX systems, forwards both plugin-root
environment variables, and never edits a user's Codex or Claude configuration.
The Python runtime must remain importable on Python 3.10, including when a
project `.expert-team/config.toml` is present; the package carries its small
MIT-licensed TOML backport instead of installing a user dependency.
Managed mode may declare trusted lifecycle hooks, but installing a plugin never
implicitly trusts them. The Claude package must expose the same
logical workflow from `.claude-plugin/plugin.json`; host-specific components
must not fork the core contracts.

`references/agent-registry.json` contains exactly 20 unique ExpertTeam-Codex
profile IDs and unique relative profile paths. Every profile contains its ID,
responsibilities, boundaries, and evidence requirements. Entries with kind
`coordinator` are lead playbooks and must never be dispatched as nested leads.

Each lightweight task-plan JSON object contains:

| Field | Type / constraint |
|---|---|
| `execution_mode` | `parallel` or `sequential` |
| `outcome` | `success`, `partial`, `blocked`, or `failed` |
| `tasks` | Non-empty array of task records |

Each task record contains a unique string `id`, non-empty `objective` and
`role`, `mode` (`read`, `write`, or `verify`), Boolean `required`, non-negative
integer `wave`, valid `status`, string arrays `depends_on` and `ownership`, and
a non-empty `status_history`. Write tasks require ownership; other modes forbid
it. Legacy runtime persistence remains opt-in under `.expert-team/runs/`.

Managed runs use versioned `TaskContract`, `RunSnapshot`, `WorkItem`,
`RoleResult`, `AuditDecision`, `HumanDecision`, and `BackendEvent` contracts.
The contract/event layer is the only decoder for external JSON/JSONL. Reducers,
views, adapters, and MCP handlers consume validated values rather than
re-parsing payload fields.

Each fresh role process receives an `EpisodeRequest` containing a unique
`episode_id`, `run_id`, round, role/profile, bounded prompt, existing workspace,
optional model, timeout/output limits, permission posture, read-only bit, and
work-item identity where applicable. It returns an `EpisodeResult` with one of
`done`, `error`, `permission_required`, `timeout`, or `cancelled`, normalized
events, visible output, exit status, redacted streams, and bounded metadata.
Before launch, process adapters resolve `argv[0]` with the platform path lookup
used by the current process. This is required on Windows because npm shims such
as `codex.CMD` and `claude.CMD` may be found by `shutil.which()` but not by
`asyncio.create_subprocess_exec()` when passed as bare names.

Host JSONL/stream adapters may receive multiple assistant-visible messages in a
single episode. `visible_output` must prefer the final assistant message that is
itself one JSON object, falling back to the host result field or joined text only
when no structured final message exists. Parsers still require one strict object;
adapters own selection, not schema coercion.

Executor and Auditor prompts must include an exact copyable schema template for
the current contract field names. In particular, Executors return
`RoleResult.summary`, `artifacts`, `evidence`, `checks`, `risks`, and optional
`failure`; Auditors return `AuditDecision.status`, `integrity`,
`contract_alignment`, `evidence`, `findings`, and `required_rework`.

Runtime configuration is loaded in this exact precedence order:

```text
explicit MCP/CLI override > .expert-team/config.toml > environment > defaults
```

Global environment keys are `EXPERT_TEAM_HOST`, `EXPERT_TEAM_MODEL`,
`EXPERT_TEAM_WORKSPACE`, `EXPERT_TEAM_MAX_ROUNDS`,
`EXPERT_TEAM_RETRY_LIMIT`, and `EXPERT_TEAM_MAX_CONCURRENCY`. Per-role keys use
`EXPERT_TEAM_<MANAGER|EXECUTOR|AUDITOR>_<HOST|MODEL|TIMEOUT_SECONDS|CONTEXT_CHARS|OUTPUT_CHARS>`.
Persisted configuration rejects fields whose names contain `api_key`, `token`,
`password`, or `secret`; authentication remains owned by the host runtime.

Episode lifecycle events are durable and monotonic: `episode.started` followed
by exactly one of `episode.completed`, `episode.failed`, `episode.timeout`,
`episode.cancelled`, or restart reconciliation's `episode.abandoned`. An
abandoned Executor/Auditor attempt never adds verified evidence.

Only an independent accepted audit may add evidence to `verified_progress`.
Executor results are never self-certifying. Completion requires every required
contract item to be accepted, clean integrity, contract alignment, and any
configured human completion gate.

Operational independence requires a separately launched Auditor episode and a
workspace integrity guard. Merely submitting different `executor_id` and
`auditor_id` strings proves schema separation, not independent execution.

Managed verification evidence has four explicit levels:

1. `unit` — isolated contract/reducer/parser behavior;
2. `simulated_integration` — fake process or hand-authored host event streams;
3. `local_cli_smoke` — real binary/process lifecycle without a model task;
4. `model_backed_e2e` — real Manager, Executor, and Auditor episodes.

A criterion that claims real host invocation, fresh context, permission
propagation, independent audit, or cross-host parity requires the corresponding
level 3 or level 4 evidence. Lower-level tests cannot be relabeled as E2E.

Managed task state is stored under
`.trellis/tasks/<task>/runs/<run-id>/`; bulky raw host trajectories are stored
separately under `.trellis/workspace/<developer>/traces/<run-id>/`. Only the
Trellis storage adapter may write this layout. Event sequence IDs are monotonic,
snapshots are atomic, and replay must reproduce the accepted state.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Missing, self, or cyclic dependency | Reject the plan. |
| Dependency in the same/later wave | Reject the plan. |
| Required dependency failed | Dependent task is blocked or cancelled. |
| Parallel write scopes are equal or ancestor-related | Reject the wave. |
| Sequential wave contains multiple tasks | Reject the plan. |
| `success` has an incomplete required task | Reject the outcome. |
| Same gate fails after two repair rounds | Stop retrying and report blocked. |
| Production/live-data mutation lacks clear authorization | Keep work read-only. |
| Executor claims success without accepted independent audit | Keep the result unverified. |
| Adapter requests an approval/sandbox bypass | Reject the invocation. |
| Managed mutation uses a stale state version | Reject with a version conflict. |
| Event or snapshot cannot be validated/replayed | Stop advancement and report recovery diagnostics. |
| Managed start targets a non-active Trellis task | Reject until task status is `in_progress`. |
| WorkItem selects a coordinator profile as Executor | Reject the run contract. |
| Manager route is empty, malformed, or unknown | Persist bounded repair feedback; never default to execution/completion. |
| Auditor episode is missing, unavailable, or shares the Executor session | Reject acceptance. |
| Auditor changes the workspace or the before/after snapshot is incomplete | Reject the audit fail closed and preserve diagnostics. |
| Role episode times out or is cancelled | Terminate descendants, persist the terminal episode event, and leave no accepted evidence. |
| Host reports `permission_required` | Persist the host event and open a `permission` human gate; never retry by adding a bypass flag. |
| Host binary exists only through a shell shim | Resolve the binary path before `create_subprocess_exec`; do not launch through a shell. |
| Host emits prelude/progress assistant messages before final JSON | Select the final standalone JSON object as `visible_output`; do not parse a concatenated transcript. |
| Model returns a natural-language or wrong-field JSON schema | Fail closed as a structured-output error and consume a bounded retry; do not coerce fields. |
| Config contains an unknown field, invalid host/limit, or persisted secret | Reject before launching any role process. |
| Project config and environment disagree | Project value wins; explicit invocation override wins over both. |
| Supervisor restarts with unmatched `episode.started` | Record `episode.abandoned`, retry only unaccepted work, and keep accepted work unchanged. |
| Test uses only fixture events for a real-host acceptance criterion | Keep the criterion open and label the evidence simulated. |

## 5. Good / Base / Bad Cases

- Good: two read tasks share wave 0; a verification task depends on both in
  wave 1 and records evidence.
- Good managed: two disjoint Executors submit results, two different Auditors
  accept actual evidence, and only then does the human completion gate open.
- Base: one direct specialist task is valid; an expert-team invocation does not
  require an artificial multi-agent graph.
- Bad: `src/api` and `src/api/routes` are assigned to parallel writers because
  their ownership scopes overlap.
- Bad managed: an Executor submits an `accepted` result or uses the same
  identity as Auditor; reject it and leave verified progress unchanged.
- Good executable managed: one start call causes the supervisor to invoke a
  fresh Manager, fresh Executor, and separate read-only Auditor; accepted
  evidence is persisted and the next round starts without manual phase calls.
- Good structured output: an Auditor may emit progress messages during tool use,
  but its final assistant message is the only JSON object and uses the exact
  `AuditDecision` field names.
- Bad executable managed: a test manually calls `next`, `submit_result`, and
  `submit_audit`, then calls that sequence a real end-to-end host run.
- Bad structured output: an Executor returns `status`, `changes_made`, or nested
  evidence objects instead of the versioned `RoleResult` fields; reject and retry
  rather than translating it.
- Good configuration: project config binds Auditor to Claude while an explicit
  invocation override shortens only its timeout; no credentials enter TOML.
- Bad configuration: store a token in `.expert-team/config.toml` or inject a
  host permission-bypass switch into runner arguments.

## 6. Tests Required

- Unit tests assert manifest name/component integrity and skill references.
- MCP package tests launch the bundled stdio server through both plugin-root
  environment names and cover the Windows/POSIX interpreter selection path.
- Fixtures assert parallel reads, disjoint and overlapping writes, dependency
  failure, cycle rejection, and sequential fallback.
- Tests assert the six default Qoder-derived roles, workflow shapes, domain
  lenses, repair limit, and absence of Qoder runtime endpoints.
- Tests assert the exact 20-profile public-source registry, unique paths,
  required profile sections, and three non-nested coordinator playbooks.
- Managed-mode tests assert strict schema decoding, legal transitions, audit
  independence, verified-progress gating, replay equivalence, optimistic
  versions, bounded retries, write-ownership safety, and corrupt-tail failure.
- Adapter tests assert equivalent Codex/Claude normalized events and the absence
  of permission/sandbox bypass flags.
- Runner tests use fake executables to assert argument lists, stdin prompts,
  streaming, malformed output, timeout, cancellation, descendant cleanup,
  permission propagation, redaction, and fresh episode identity.
- Runner tests assert command metadata contains the resolved executable path when
  the host is launched, and that Codex/Claude output extraction prefers the last
  standalone JSON assistant message over prelude messages.
- Prompt tests assert Executor and Auditor prompts contain the exact versioned
  schema field names required by the strict decoders.
- Auditor integrity tests cover add/edit/delete/type-change, unreadable paths,
  incomplete snapshots, mutation restoration failure, and unavailable Auditor;
  every uncertain case must leave `verified_progress` unchanged.
- Supervisor integration tests prove one start call can drive at least two
  complete fake-backend rounds without manual phase submissions.
- Cross-host acceptance requires opt-in model-backed E2E evidence for both Codex
  and Claude. Reports label every result with one of the four proof levels.
- Run the official local plugin validator and skill validator.
- Run mypy for the validator and its tests.
- Configuration tests assert global and per-role environment fallback, project
  precedence, explicit override precedence, strict fields, and secret rejection.
- Human-gate tests assert permission visibility and that disabling the completion
  gate records an attributable `configured-policy` decision instead of silently
  skipping the durable gate event.

## 7. Wrong vs Correct

### Wrong

```json
{"id":"api-route","mode":"write","wave":0,"ownership":["src/api/routes"]}
```

Run that task in parallel with another writer owning `src/api`.

### Correct

Place the tasks in different waves, or narrow ownership until both scopes are
explicit and disjoint. Keep integration and final acceptance with the lead.

### Wrong managed acceptance

```json
{"executor_id":"agent-1","auditor_id":"agent-1","status":"accepted"}
```

### Correct managed acceptance

Use distinct identities, inspect actual evidence, then submit an
`AuditDecision` with clean integrity and aligned contract. The audit reducer is
the only code allowed to add `verified_progress`.

### Wrong end-to-end claim

```text
test -> start -> next -> submit_result(fake) -> submit_audit(fake)
```

Label that `simulated_integration`; it does not prove a role runner or an
independent Auditor.

### Correct end-to-end claim

```text
one start -> supervisor -> real Manager -> real Executor -> protected real
Auditor -> accepted evidence -> next round/human gate
```

Record host versions, run ID, episode IDs, trace/evidence references, permission
posture, and terminal state, and label the proof `model_backed_e2e`.

### Wrong permission handling

```text
permission_required -> silently rerun with a bypass option
```

### Correct permission handling

```text
permission_required -> durable episode failure -> permission gate -> attributable answer
```

### Wrong structured output handling

```text
agent_message("I'll inspect first")
agent_message({"decision":"accepted","accepted":true})
parser accepts by translating fields
```

### Correct structured output handling

```text
adapter selects the final standalone JSON object
parser accepts only exact RoleResult/AuditDecision fields or fails closed
```

### Wrong Windows host launch

```text
create_subprocess_exec("codex", ...)
```

### Correct Windows host launch

```text
resolved = shutil.which("codex")
create_subprocess_exec(resolved or "codex", ...)
```

## Design Decisions

- Keep the six default roles separate from domain lenses. Roles define
  responsibility; lenses modify safety and evidence gates.
- Apply the portable delegation guardrails in
  `skills/expert-team/references/delegation-guardrails.md`: delegate only when
  context reduction, independent parallelism, or verification justifies it;
  keep small/foundational reads in the lead; make prompts self-contained;
  default exploration and verification to read-only; prohibit recursive
  spawning; require compact `file:line` evidence with facts separated from
  inferences; and keep decisions, integration, and final acceptance with the
  lead. These rules supplement, rather than replace, the `explorer`, `worker`,
  and `default` role semantics.
- Prefer `direct` or `fast` over `standard` for bounded work.
- Use lightweight mode for bounded work. Select managed mode explicitly or for
  cross-session, multi-wave, evidence-heavy, or human-gated tasks.
- Keep the role registry canonical; generate or validate platform-specific
  representations against it.
- Keep host permissions visible and user-controlled. Never inject bypass flags
  copied from an externally isolated harness.
- Adapt only portable behavior from Qoder and ExpertTeam-Codex; never depend on
  Qoder binaries/private RPCs or obsolete direct-install agent formats.
- Treat host visible output selection as adapter work. The strict parser remains
  the schema authority and never translates model-invented field names.
- Resolve command shims before shell-free process launch so Windows npm CLI
  installs remain compatible without introducing shell execution.
