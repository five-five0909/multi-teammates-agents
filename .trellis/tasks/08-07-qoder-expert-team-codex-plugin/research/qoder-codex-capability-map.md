# Qoder Experts to Codex Capability Map

## Scope and provenance

This note records behavior observed from the user's locally installed Qoder
`1.23.0` and compares it with the current Codex manual fetched on 2026-08-07.
It is implementation research, not a claim that Qoder's private protocols are
public or stable.

A separate review of the public MIT-licensed ExpertTeam-Codex repository is in
`expertteam-codex-reference.md`; it supplements this map with workflow-routing
and domain-safety patterns.

## Local Qoder evidence

| Observed behavior | Local evidence | Portable interpretation |
|---|---|---|
| Experts feature gate | `D:/Program Files/Qoder/resources/app/featureFlags.json` contains `supportExpertsMode: true` | Experts is a distinct product mode, not merely a prompt label. |
| Product promise | Dynamic text says Qoder assembles multiple engineering experts that collaborate in parallel | Preserve decomposition, specialization, parallelism, and synthesis. |
| Specialist catalog | Dynamic text defines full-stack engineer, researcher, debug engineer, code reviewer, QA, and UI operator | Seed the plugin with equivalent role templates, but keep roles extensible. |
| Backend-owned catalog | Extension RPC `webview/experts/listBuiltinAgents` delegates to the local Go/Cosy backend | Do not depend on or reproduce this private service; store portable role guidance in the plugin. |
| Task tools | Workbench recognizes `TaskCreate`, `TaskUpdate`, and `TaskList` | Give the lead a task-graph contract with state and dependencies. |
| Lead synchronization | Workbench handles `leader_waiting_experts` and displays “Syncing with experts…” | The lead must wait for required expert results before synthesis. |
| Task presentation | UI strings expose pending, pending confirmation, blocked-by, unassigned, done, view-all, and close-all concepts | Preserve truthful state reporting; a custom canvas is not required for MVP. |
| Custom subagents | Qoder UI describes custom subagents usable by Agent and Experts modes | Support user-owned role overrides without modifying orchestration logic. |
| Session boundary | Qoder does not switch an active Experts conversation directly into another mode | Treat each explicit invocation as one bounded expert-team run. |

## Codex-native mapping

| Required behavior | Codex-native mechanism | Design consequence |
|---|---|---|
| Explicit and automatic entry | `$expert-team` plus implicit skill matching | One skill can cover both entry paths. |
| Parallel specialists | Native subagent spawning | No custom process supervisor is needed. |
| Expert visibility | `/agent` and surfaced subagent threads | Do not reproduce the Qoder Experts Canvas in MVP. |
| Specialization | Bounded dispatch prompts, using built-in `explorer`, `worker`, or default agent types | Plugin remains portable even though `.codex/agents/*.toml` is project/user configuration rather than a documented plugin payload. |
| Waiting and synthesis | Native wait/result collection plus lead-agent instructions | The lead owns conflict resolution and the final verification gate. |
| Reusable packaging | Plugin manifest plus `skills/expert-team/` resources | Start skills-only; add MCP/UI only if a later requirement needs capabilities native Codex lacks. |

## Architectural finding

The smallest useful implementation is a skills-only plugin. The orchestration
skill should define task decomposition, role selection, dependency-aware waves,
dispatch prompts, wait/steer/failure behavior, evidence normalization, and final
synthesis. Role templates and output contracts can live as skill references.

A custom MCP server would duplicate Codex's native subagent lifecycle and add
installation, security, and portability costs without solving an established
MVP gap. A graphical canvas can be considered later if real use demonstrates
that `/agent` plus a concise lead-owned ledger is insufficient.

## Constraints discovered

- Subagents inherit the parent permission mode; actions needing unavailable new
  approval fail back to the parent in non-interactive workflows.
- Parallel read-heavy work is low-conflict; write-heavy expert tasks need clear
  file ownership or sequencing.
- Multi-agent execution consumes more tokens than a comparable single-agent
  run, so automatic triggering must be limited to genuinely separable work.
- The plugin must not contain copied Qoder bundles, prompts, or private RPC code.
