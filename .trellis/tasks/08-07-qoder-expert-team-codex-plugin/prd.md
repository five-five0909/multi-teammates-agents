# Port Qoder Expert Team to Codex CLI Plugin

## Goal

Build a Codex CLI plugin for this repository that reproduces the useful,
portable parts of Qoder's Experts mode: a lead agent decomposes a request,
selects specialist roles, coordinates work that can run in parallel, tracks
dependencies and status, and synthesizes a final result with verification.

The result should feel like an "expert team" workflow to a Codex user while
using Codex-native plugin, skill, subagent, and tool capabilities rather than
depending on Qoder services or copying proprietary implementation code.

## Confirmed Facts

- The repository currently contains Trellis workflow infrastructure and no
  existing product implementation outside `.trellis/`, `.agents/`, and
  `.codex/` support files.
- Local Qoder version `1.23.0` has `supportExpertsMode` enabled.
- Qoder describes Experts as a mode that automatically assembles multiple AI
  engineering experts and lets them collaborate in parallel.
- Qoder exposes at least these built-in specialist roles: full-stack engineer,
  researcher, debug engineer, code reviewer, QA, and UI operator.
- The Qoder UI and protocol expose a lead-agent/task model with `TaskCreate`,
  `TaskUpdate`, `TaskList`, task states, blocking relationships, unassigned
  work, and a `leader_waiting_experts` synchronization state.
- Qoder retrieves its built-in expert catalog through the backend RPC
  `webview/experts/listBuiltinAgents`; its complete orchestration engine is not
  present as reusable local source code.
- Qoder supports custom subagents for Agent and Experts modes, while its
  Experts session remains a distinct mode that cannot be switched in place.
- Current Codex releases enable native subagent workflows by default, expose
  their threads through `/agent` in the CLI, and can delegate when a user asks
  directly or an applicable skill instructs them to do so.
- Codex skills support both explicit `$skill-name` invocation and implicit
  activation through their descriptions.
- Official Codex plugin architecture supports skills and optional MCP-backed
  tools/UI. Project-scoped custom agents live under `.codex/agents/`, but that
  directory is not documented as a portable plugin payload.
- A valid Codex plugin requires `.codex-plugin/plugin.json` and can package
  skills plus an optional MCP server; the MVP needs only a skill because native
  Codex already supplies the subagent runtime.
- This task is managed through Trellis and remains in planning until the user
  reviews the planning artifacts and explicitly approves implementation.

## Requirements

- R1. Package the solution as a valid Codex CLI plugin with a normalized plugin
  name and a validated `.codex-plugin/plugin.json` manifest.
- R1a. Expose the MVP primarily through an explicitly invokable
  `$expert-team` skill, while allowing the skill description to auto-route
  clearly complex, multi-workstream requests into the same workflow.
- R2. Provide a lead-orchestrator workflow that converts a user request into
  independently verifiable expert tasks, including explicit dependencies.
- R3. Provide a configurable specialist catalog whose initial roles cover the
  six locally confirmed Qoder roles without hard-coding the system to only
  those roles.
- R3a. Route each invocation to the lightest useful workflow shape and support
  optional software, product, design, operations, security, and database lenses
  without manufacturing unnecessary agents.
- R3b. Migrate every one of the 20 public ExpertTeam-Codex agent identities into
  a separately maintained, registry-backed Codex profile while retaining the six
  Qoder-observed general roles as fallbacks.
- R4. Dispatch independent work concurrently when Codex execution facilities
  permit it, while preserving a correct sequential fallback.
- R4a. Use Codex-native subagent threads and lifecycle controls as the runtime
  execution substrate rather than building a second process supervisor.
- R4b. Parallelize read-only research, diagnosis, review, and verification by
  default. Permit implementation experts to write concurrently only when the
  lead assigns explicit, disjoint file or module ownership; overlapping or
  integration-sensitive writes must be sequenced.
- R5. Track expert task identity, assignee/role, state, dependencies, evidence,
  result, and failure information in an inspectable run ledger.
- R5a. Use native Codex subagent threads and the lead's structured summary as
  the default activity record. Persist `.expert-team/runs/<run-id>.md` only for
  long-running or cross-session work, or when the user explicitly requests it;
  Trellis-managed repositories reuse their existing task artifacts.
- R6. Require the lead orchestrator to integrate expert outputs, resolve
  conflicts, identify incomplete work, and run an explicit verification gate
  before reporting completion.
- R6a. Ship a default software-delivery catalog containing full-stack engineer,
  researcher, debug engineer, code reviewer, QA, and UI operator role
  templates, while supporting project-owned additions and overrides.
- R6b. Bound repeated repair and verification to two rounds for the same failed
  gate, then report the blocker and retained evidence.
- R7. Integrate with Trellis task planning and status rather than introducing a
  competing project-level planning lifecycle.
- R7a. Do not require Trellis at plugin runtime. Detect `.trellis/` and use its
  active task, phase, and planning artifacts when available; otherwise use the
  plugin's self-contained lightweight run contract.
- R8. Keep the implementation local-first and avoid requiring Qoder binaries,
  Qoder accounts, or private Qoder backend endpoints at runtime.
- R9. Document the mapping from observed Qoder behavior to Codex-native
  mechanisms, including features that cannot or should not be ported directly.
- R10. Include automated validation for plugin structure and deterministic
  tests for task/dependency/state logic introduced by the implementation.

## Constraints

- Do not copy or redistribute Qoder's minified application bundles or
  proprietary backend implementation.
- Treat observations from the local Qoder installation as behavioral evidence,
  not as a stable public protocol contract.
- Preserve existing user-authored workspace changes and Trellis configuration.
- Do not start implementation before the user reviews the final `prd.md`,
  `design.md`, and `implement.md` and approves activation.

## Acceptance Criteria

- [x] AC1. The produced plugin passes the official local plugin validator and
  contains a valid `.codex-plugin/plugin.json` whose name matches its directory.
- [x] AC1a. A user can invoke `$expert-team` explicitly, and documented
  auto-trigger examples route to the same orchestration contract.
- [x] AC2. A documented demo request causes the orchestrator to create a task
  graph with at least two specialist roles and an explicit dependency or
  parallelizable relationship.
- [x] AC3. The same demo records observable state transitions and retains each
  expert's evidence/result for final synthesis.
- [x] AC3a. A normal demo run creates no repository-local runtime files, while
  an opt-in persistent demo produces a valid run ledger without modifying
  Trellis task state.
- [x] AC4. The final synthesis reports completed, failed, blocked, and omitted
  work accurately and does not claim success when required verification fails.
- [x] AC4a. A concurrency-policy test demonstrates that disjoint write scopes
  may run in parallel while overlapping write scopes are sequenced or rejected.
- [x] AC5. Users can add or override specialist definitions without modifying
  the orchestration core.
- [x] AC5a. Documentation distinguishes direct, fast, bugfix, standard, and
  audit workflows and defines read-only safety defaults for operations,
  security, and database work.
- [x] AC5b. A deterministic test verifies exactly 20 unique public-source agent
  IDs, profile paths, required profile sections, and coordinator semantics.
- [x] AC6. The workflow operates without Qoder installed or authenticated.
- [x] AC7. Trellis artifacts remain the source of truth for this development
  task, and plugin runtime state does not overwrite `.trellis/tasks/` data.
- [x] AC7a. The same representative orchestration scenario succeeds both in a
  repository with Trellis initialized and in a fixture without `.trellis/`.
- [x] AC8. Automated tests cover dependency ordering, state transitions,
  failure handling, and sequential fallback; all documented validation
  commands pass.
- [x] AC9. Documentation includes installation, invocation, configuration,
  architecture, Qoder-to-Codex mapping, limitations, and rollback/removal.

## Out of Scope

- Reproducing Qoder's proprietary hosted models, billing gates, UI, backend RPC
  service, or exact internal prompts.
- Depending on undocumented Qoder endpoints in the delivered plugin.
- Building a full graphical Experts Canvas unless later selected explicitly.
