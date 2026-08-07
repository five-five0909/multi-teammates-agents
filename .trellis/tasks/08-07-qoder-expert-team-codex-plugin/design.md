# Technical Design: Qoder-Inspired Expert Team Codex Plugin

## 1. Design summary

Implement the current repository root as a skills-first Codex plugin named
`multi-teammates-agents`. Its primary skill, `$expert-team`, instructs the lead
Codex agent to build a bounded task graph, select specialist roles, dispatch
independent work through native Codex subagents, synchronize results, and run a
final verification gate.

The plugin borrows Qoder Experts' observable collaboration model, not its
private backend or UI. Codex-native subagent threads are the execution and
activity surface; `/agent` is the primary live inspector.

## 2. Boundaries

### In the plugin

- Plugin manifest and presentation metadata.
- `$expert-team` orchestration skill.
- Default expert-role catalog and dispatch/output contracts.
- Dependency, concurrency, failure, and synthesis rules.
- Optional run-ledger template.
- Trellis detection and compatibility instructions.
- Static validation and scenario fixtures for the packaged contracts.
- User documentation.

### Owned by Codex

- Agent creation, concurrency limits, waiting, steering, interruption, and
  thread lifecycle.
- `/agent` status and thread inspection.
- Model selection, sandbox, permissions, and tool availability.
- Conversation persistence.

### Not implemented in MVP

- A custom process supervisor or agent runtime.
- An MCP server or remote service.
- A graphical Experts Canvas.
- Qoder RPCs, hosted models, billing, prompts, or copied assets.
- Installation of project/user `.codex/agents/*.toml`; specialist behavior is
  carried in bounded dispatch prompts so the plugin stays portable.

## 3. Proposed plugin layout

```text
multi-teammates-agents/
├── .codex-plugin/
│   └── plugin.json
├── skills/
│   └── expert-team/
│       ├── SKILL.md
│       ├── agents/
│       │   └── openai.yaml
│       └── references/
│           ├── workflow-routing.md
│           ├── agent-registry.md
│           ├── agent-registry.json
│           ├── agents/
│           │   ├── software/ (5 profiles)
│           │   ├── product/ (6 profiles)
│           │   ├── design/ (6 profiles)
│           │   └── platform/ (3 profiles)
│           ├── orchestration-contract.md
│           ├── expert-catalog.md
│           ├── result-contract.md
│           ├── trellis-integration.md
│           └── run-ledger-template.md
├── tests/
│   ├── fixtures/
│   │   ├── parallel-read.json
│   │   ├── disjoint-write.json
│   │   └── overlapping-write.json
│   └── test_plugin_contract.py
├── scripts/
│   └── validate_contract.py
├── README.md
└── LICENSE
```

No marketplace entry is part of the initial repository implementation. A
personal or team marketplace can be added after local validation when the user
selects the distribution destination.

## 4. Entry and routing contract

The `expert-team` skill supports:

1. Explicit invocation with `$expert-team`.
2. Implicit activation only when the request contains at least two meaningful,
   independently executable workstreams or requires materially different
   specialist perspectives.

It must not auto-trigger for simple questions, single-file mechanical edits,
or tasks where delegation overhead exceeds likely benefit. Explicit invocation
always wins unless the environment has multi-agent execution disabled; in that
case the workflow uses its sequential fallback and reports the limitation.

An invocation may include an optional domain hint (`software`, `product`,
`design`, `ops`, `security`, or `database`). The lead selects the lightest valid
shape from direct, fast, bugfix, standard, and audit. A direct task may use one
specialist; "expert team" does not imply a minimum agent count.

## 5. Orchestration state model

The lead maintains a logical ledger with one row per task:

| Field | Meaning |
|---|---|
| `id` | Stable run-local task identifier. |
| `objective` | One bounded, testable outcome. |
| `role` | Selected expert role. |
| `depends_on` | Task IDs that must finish successfully first. |
| `mode` | `read`, `write`, or `verify`. |
| `ownership` | Explicit files/modules for write tasks; empty for read tasks. |
| `status` | `pending`, `running`, `completed`, `failed`, `blocked`, or `cancelled`. |
| `evidence` | File references, commands, test output, or source links. |
| `result` | Distilled result returned to the lead. |
| `failure` | Actionable failure or blocker information. |

State transitions are monotonic except that a failed verification can create a
new repair task. Completed tasks are not silently reopened or rewritten.

## 6. Role selection

The initial catalog maps the observed Qoder roles to portable Codex prompts:

| Role | Default execution posture | Typical Codex agent type |
|---|---|---|
| Researcher | Read-only discovery and dependency mapping | `explorer` |
| Debug Engineer | Reproduction and root-cause diagnosis; no fix unless assigned | `explorer` or `default` |
| Full-Stack Engineer | Bounded implementation with explicit ownership | `worker` |
| Code Reviewer | Read-only correctness, security, regression review | `default` |
| QA | Build/test execution and evidence collection | `default` |
| UI Operator | Browser/UI reproduction and verification | `default` |

Before using the defaults, the lead checks for project-owned role guidance under
`.expert-team/roles/`. Matching project definitions override the corresponding
default role for that run; unmatched definitions extend the catalog. Overrides
are read-only inputs and are never created automatically.

The public ExpertTeam-Codex catalog is represented by 20 separate profiles and
a machine-readable registry. Software, product, and design team-lead identities
are coordinator playbooks applied by the primary Codex lead, not nested
orchestrators. The remaining 17 identities are dispatchable specialist prompts.
Profiles retain their domain responsibility while replacing obsolete upstream
team commands, fixed stacks, and unsafe defaults with this plugin's native
subagent, ownership, evidence, and authorization contracts.

## 7. Scheduling and concurrency

The lead creates dependency-aware waves:

1. Dispatch all ready read-only tasks that have no unmet dependencies.
2. Dispatch write tasks concurrently only when their ownership sets are
   explicit and disjoint.
3. Sequence overlapping or unknown write scopes.
4. Reserve cross-cutting integration, conflict resolution, and final acceptance
   for the lead unless a dedicated integration task has exclusive ownership.
5. Respect the host's concurrency cap; queued work remains pending.

If native subagents are unavailable or disabled, the lead executes the same
task graph sequentially and labels the run as fallback mode. The acceptance
contract remains unchanged.

## 8. Dispatch and result contracts

Every dispatch includes:

- Run goal and the expert's bounded task objective.
- Role-specific responsibilities and explicit exclusions.
- Known dependencies and relevant upstream findings.
- Read/write mode and exact ownership.
- Required evidence and validation.
- A reminder that other agents may share the workspace and must not revert
  unrelated changes.
- A compact result schema: status, summary, evidence, changed files, checks,
  risks, and follow-ups.

The lead consumes summaries, not raw logs, and may steer or retry a task only
with a narrowed reason. Repeated failures become a reported blocker rather than
an endless retry loop. The same failed gate permits at most two repair-and-
verification rounds.

Operations, security, and database lenses default to read-only investigation
for production systems or live data unless the user has clearly authorized a
mutation. They require scope/fact baselines, evidence, rollback where relevant,
and explicit cross-domain handoffs.

## 9. Failure and completion semantics

- A failed optional task may be omitted only when the lead explains the impact.
- A failed required task blocks dependent tasks and prevents a successful final
  claim.
- Partial subagent output is retained as evidence but is not marked completed.
- Conflicting expert conclusions are surfaced and resolved through evidence or
  an explicit lead decision.
- The final response reports completed, failed, blocked, cancelled, and omitted
  work separately.
- Completion requires the planned verification task or an explicit explanation
  of why verification could not run.

## 10. Trellis integration

At skill start, the lead checks whether `.trellis/` exists.

### Trellis present

- Read the applicable Trellis workflow state and active task context.
- Do not create, start, archive, or mutate a Trellis task without the consent
  and phase gates defined by that repository.
- Treat Trellis PRD/design/implementation artifacts as authoritative project
  requirements.
- Use the expert ledger only as an in-memory execution view unless the Trellis
  workflow itself requires a persisted artifact.

### Trellis absent

- Run independently using the skill contract.
- Do not write runtime files by default.
- Persist `.expert-team/runs/<run-id>.md` only for a long-running/cross-session
  run or when explicitly requested.

The plugin never writes into `.trellis/tasks/` directly as a runtime shortcut.

## 11. Validation strategy

### Static validation

- Validate `.codex-plugin/plugin.json` with the plugin-creator validator.
- Validate skill metadata and references with the skill validator.
- Run a repository contract test that checks required role names, reference
  paths, invocation policy, and absence of Qoder runtime dependencies.

### Deterministic orchestration fixtures

- Parallel read fixture: all independent read tasks are accepted in one wave.
- Disjoint write fixture: non-overlapping ownership may share a wave.
- Overlapping write fixture: overlapping ownership is rejected or sequenced.
- Dependency fixture: unresolved dependencies prevent scheduling.
- Cycle fixture: cyclic plans fail validation.

### Behavioral smoke tests

- Explicit `$expert-team` request.
- Implicit complex request that should activate the skill.
- Simple request that should not activate it.
- Sequential fallback scenario.
- Trellis and non-Trellis scenarios.
- Required expert failure followed by truthful blocked synthesis.

## 12. Compatibility and rollback

- The MVP requires a Codex release with skills and native subagents for full
  parallel behavior; older/disabled environments receive sequential fallback.
- The plugin is local-first and requires no network service or authentication.
- Removal consists of uninstalling/removing the plugin. Optional
  `.expert-team/runs/` files are user-owned artifacts and are not deleted
  automatically.
- Because there is no database migration or external state, rollback is the
  previous plugin directory/version.

## 13. Key trade-offs

- Skills-only is less visually rich than Qoder's canvas but substantially more
  portable and auditable.
- Prompt-carried roles cannot enforce a model setting like project-local custom
  agent TOML, but they can ship inside the plugin and work without installation
  side effects.
- Native threads avoid duplicating orchestration infrastructure, at the cost of
  relying on Codex's host-provided activity UI and concurrency limits.
- Default non-persistence keeps repositories clean; opt-in ledgers cover audit
  and cross-session needs.
