# Managed mode

Read this reference only when a request explicitly selects managed mode or is
cross-session, multi-wave, evidence-heavy, or human-gated.

## Preconditions

- The project contains `.trellis/tasks/` and an approved/in-progress Trellis
  task for the requested outcome.
- The bundled `expert-team` MCP server is available.
- Host permissions remain unchanged. Never request or inject bypass flags.

If a precondition is unavailable, explain it and fall back to lightweight mode
only when doing so will not lose an explicit durability or audit requirement.

## Lifecycle

1. Call `expert_team_qualify` before creating state. A default `lightweight`
   or `managed` result is side-effect-free and does not create a run. Clients
   that need a one-call managed handoff may instead set `auto_start=true` and
   supply the active task ID, run ID, strict TaskContract, and WorkItem graph;
   the response then returns the newly persisted run identity/state.
2. For the normal two-step `managed` flow, call `expert_team_start` once with
   a strict TaskContract and WorkItem graph. Use the task's stable ID, not its
   dated folder name.
3. Call `expert_team_run`. The bundled supervisor invokes a fresh Manager,
   schedules dependency-ready Executor episodes, records their output as
   unverified, launches separate read-only Auditor episodes, applies the
   workspace integrity guard, and continues automatically.
4. When the supervisor returns a pending gate, show the exact compact state to
   the user. Record the attributable answer with `expert_team_answer`, then call
   `expert_team_run` again when the decision continues work.
5. Completion still requires every required item accepted by an independent
   Auditor and an approved completion gate.

`expert_team_next`, `expert_team_submit_result`, and `expert_team_submit_audit`
remain low-level recovery/integration tools. Do not manually drive them during a
normal supervised run or describe a manually driven sequence as host E2E proof.

Use `expert_team_status` for the full validated snapshot and
`expert_team_resume` for compact cross-session context. Use
`expert_team_cancel` to stop safely without deleting evidence.

The repository-local `scripts/expert_team_run.py` exposes the same lifecycle
for a terminal-only workflow: `--start` creates a run from
`--contract-file`/`--work-items-file`, `--foreground` (or `--run`) drives the
supervisor, `--status` renders the public summary, `--resume` prints compact
state, `--answer decision.json` records a human decision, and `--cancel`
preserves evidence while stopping the run. Omitting an action keeps the legacy
foreground behavior. The CLI and MCP surfaces call the same service contracts;
they do not maintain separate state machines.

When native Codex or Claude structured events are available, call
`expert_team_record_host_event` with the host and role. The runtime normalizes
them and writes only the diagnostic projection under the separate Trellis
workspace trace directory; host payload formats never enter the core reducer.

The supervisor launches real CLI episodes with the host's current permission
policy. Never add approval/sandbox bypass flags. If a host binary, permission, or
model is unavailable, preserve the failed episode, move the affected work item
to bounded rework/blocked state, and gate/block the run; never substitute
acceptance. Executor and Auditor permission failures open a `permission` gate
through the same answer/resume flow as Manager permission failures.

## Interaction at each round boundary

Report verified progress, unverified/rejected work, the next proposed wave,
round budget, and pending human decisions. Never present Executor output as
accepted before its audit event succeeds. The local CLI renders these public
summaries by default; use `--quiet` for the legacy JSON snapshot or `--json`
for automation. The narrative never includes raw host stdout, private model
reasoning, secrets, or unredacted command metadata.
