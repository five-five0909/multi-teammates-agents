# Expert Team Product Contract

## 1. Scope / Trigger

Apply this specification when changing the npm product surface, the canonical
`skills/expert-team/` payload, generated expert profiles, the project MCP
compatibility surface, or the TypeScript managed runtime.

The product has exactly two execution tiers:

- `lightweight`: host-native agents coordinated by the installed skill, without
  durable managed-run state.
- `managed`: Trellis-bound Manager → Executor → independent Auditor execution
  with durable replay, recovery, and human gates.

Trellis remains the project/task authority. Do not add another routing or task
store, and do not add a Python or host-specific runtime fallback.

## 2. Public Entries

Explicit skill entry:

```text
$expert-team <request>                              # Codex CLI
/multi-teammates-agents:expert-team <request>      # Claude Code
```

Project lifecycle and managed-run CLI:

```text
mta apply [--codex] [--claude] [--yes]
mta task create|start|current|finish|archive
mta run start <run-id> --contract <json> --workItems <json>
mta run foreground <run-id> [--host codex|claude] [--config <json>]
mta run status|resume|cancel <run-id>
mta run answer <run-id> --decision <HumanDecision-json>
mta mcp serve --project <canonical-root> [--session <id>]
```

The MCP server keeps these 15 public names discoverable during migration:

```text
expert_team_start, expert_team_status, expert_team_version,
expert_team_compliance, expert_team_next, expert_team_submit_result,
expert_team_submit_audit, expert_team_answer, expert_team_resume,
expert_team_cancel, expert_team_record_host_event, expert_team_prepare,
expert_team_select_mode, expert_team_qualify, expert_team_run
```

`prepare`, `select_mode`, `qualify`, `next`, and `record_host_event` are
compatibility names only in the TypeScript alpha. They remain visible but fail
closed instead of creating a second orchestration route. New managed execution
uses the installed skill entry gate followed by `start` and `run`.

Executable host boundary:

```text
HostAdapter.probe() -> Promise<HostCapabilities>
HostAdapter.runEpisode(EpisodeRequest, AbortSignal) -> Promise<EpisodeResult>
HostAdapter.cancel(episodeId) -> Promise<CancellationResult>
ManagedRunSupervisor.run() -> Promise<RunSnapshot>
```

## 3. Contracts

### Entry and task binding

- The skill offers only lightweight and managed execution. Use lightweight for
  bounded single-session work; use managed for explicit, multi-wave,
  cross-session, evidence-heavy, recovery-sensitive, or human-gated work.
- Managed work requires an attributable user choice, an active reviewed
  `in_progress` Trellis task, a strict `TaskContract` / `WorkItem[]`, and
  `qualification_receipt.approved=true`. The caller may create that receipt only
  after the skill entry gate has checked those facts.
- The MCP server requires an explicit applied project root and resolves the
  explicit or unique session pointer. It never treats the plugin directory or
  process cwd as a project binding.
- `run start` creates durable state but launches no model. `run foreground` and
  `expert_team_run` are the only entries that may construct a HostAdapter.
  Status and resume only replay persisted state.

### Managed runtime

- Manager owns route selection and trusted progress; Executor receives one
  bounded work item in a fresh Episode; Auditor uses a distinct identity, fresh
  Episode, and read-only host policy.
- Executor output never enters `verified_progress` directly. Only a strict
  `AuditDecision` with clean workspace integrity and aligned evidence may accept
  the item.
- Ready reads and disjoint writes may share a dependency wave. Overlapping,
  unknown, cross-cutting, or integration-sensitive writes are sequential.
- Permission, repeated failure, budget, cancellation, blockage, and completion
  produce attributable human gates. No host permission or sandbox bypass flag
  is allowed.
- On recovery, unmatched `episode.started` records become
  `episode.abandoned`; accepted work is never executed again.
- Persistence order is fixed: strict normalized event → append `events.jsonl`
  → reducer validation → atomic `state.json` → public projection.
- Public output contains validated snapshots, results, audits, bounded evidence
  references, and Trellis identity only. Raw host output, secrets, private
  reasoning, and full transcripts remain outside public state and are redacted
  before diagnostic trace persistence.

### Schemas and npm package surface

- Zod is the runtime authority for TaskContract, WorkItem, RoleResult,
  AuditDecision, HumanDecision, BackendEvent, RunSnapshot, ApplyPlan,
  ApplyReceipt, HostCapabilities, EpisodeRequest, EpisodeResult, and
  CancellationResult. Generated `schemas/mta/v1/*.schema.json` must match it.
- The shared role registry contains exactly 20 unique profile IDs and paths.
  Coordinator profiles are lead playbooks and are never dispatched as nested
  coordinators. Generated Claude profiles must match this registry.
- npm is the only installation and version source. The tarball contains
  `dist/`, both bin aliases, schemas, the canonical skill, and generated agents;
  it contains no host plugin manifest, root `.mcp.json`, or plugin launcher.
- Project `mta apply` writes absolute Node + `bin/mta.js` commands for Codex and
  Claude Hooks and the project MCP, so direct spawn never depends on an npm
  `.cmd` shim or Git marketplace cache.
- `mta apply` installs the same canonical skill for Codex and Claude and the
  generated profiles for Claude. Every installed asset belongs to the same
  ownership receipt, drift check, rollback, and unapply transaction.

## 4. Validation / Error Matrix

| Condition | Required behavior |
|---|---|
| Managed start has no active Trellis binding | Return `workspace_unbound`; create no run. |
| Task is still planning or graph/schema is malformed | Reject before durable run creation. |
| Qualification receipt is absent or not approved | Reject before durable run creation. |
| Status/resume is requested | Replay state only; do not launch a model. |
| Executor and Auditor identities match | Reject audit; keep verified progress unchanged. |
| Auditor mutates files or integrity scan is incomplete | Mark audit invalid; keep verified progress unchanged. |
| Parallel write ownership overlaps or is unknown | Sequence the work. |
| Role output contains unknown fields or malformed JSON | Strictly reject and consume a bounded retry. |
| Permission, cancellation, budget, or completion needs a decision | Persist a human gate; never infer approval. |
| Host command requests bypass flags or shell concatenation | Reject the configuration. |
| Process times out or is cancelled | Terminate the process tree and verify no descendant remains. |
| MCP starts without an explicit/unique project binding | Initialize/list may work; project tools return `workspace_unbound`. |
| Apply detects an old Python Hook/MCP entry | Refuse takeover and require explicit `mta legacy detach --yes`; preserve old data. |
| Installed owned config drifts | Refuse overwrite/unapply and preserve user bytes. |
| Fake host passes but a real-host gate is required | Keep the real-host gate open and label evidence simulated. |

## 5. Required Tests

- npm tarball, skill, 20-profile registry, generated-agent, and project MCP validation.
- Strict schema generation and unknown-field rejection at every durable/public
  boundary.
- Dependency waves, overlapping ownership, reducer transition legality, golden
  replay, corrupt tail, optimistic versions, crash recovery, and accepted-work
  deduplication.
- At least two complete fake-host Manager → Executor → Auditor rounds, failed
  audit/rework, every human gate, cancellation races, and resume.
- Codex/Claude adapter argument lists, fresh episode IDs, streaming, output
  bounds, redaction, malformed output, timeout, cancellation, descendant
  cleanup, read-only Auditor posture, and absence of bypass flags.
- CLI start/status/resume/answer/cancel/foreground and MCP initialize/list/tool
  behavior against the same repository.
- Apply idempotency, shared-config preservation, concurrent drift, rollback,
  exact unapply, legacy conflict/detach, installed skill/profile discovery, and
  direct execution of installed Claude Hook and project MCP commands.
- Isolated npm tarball install on Windows and POSIX with Python/Rust/Cargo absent
  from PATH; both bin aliases, npm exec, apply/hook/project-MCP/run status,
  Doctor, and unapply must pass. Old plugin manifests and launcher must be absent.
- Opt-in model-backed managed E2E for both Codex and Claude. Reports must label
  fixture, fake, real local host, remote CI, and model-backed evidence
  separately.

## 6. Wrong vs Correct

Wrong: treat an Executor success message as accepted progress, reuse the same
identity as Auditor, or retry with a permission-bypass flag.

Correct: persist the strict Executor result, run a separate read-only Auditor,
verify workspace integrity and evidence, then let the reducer alone promote
accepted progress or open an attributable human gate.

Wrong: launch `mta.cmd` directly from a Windows exec-form Claude Hook.

Correct: generate the absolute Node executable plus installed `bin/mta.js` as
separate command/argument fields and execute with `shell:false`.

## 7. Design Decisions

- One npm package and one TypeScript runtime serve both hosts; Git marketplace
  is not a product installation path.
- The skill is the human-facing entry gate; Trellis and strict runtime schemas
  are the durable authorities.
- The canonical role registry, skill tree, project MCP server, and managed
  runtime are shared. Only Hook rendering and installed host assets differ.
- Lightweight remains available for small bounded work; managed mode is not
  weakened to simulate unsupported native delegation or independent audit.
- Old Python code remains only as a migration oracle until every cutover gate
  passes. It is neither packaged nor invoked by the npm product.
