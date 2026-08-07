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

1. Call `expert_team_qualify` before creating state. A `lightweight` result must
   not create a managed-run directory.
2. For `managed`, call `expert_team_start` once with a strict TaskContract and
   WorkItem graph. Use the task's stable ID, not its dated folder name.
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

When native Codex or Claude structured events are available, call
`expert_team_record_host_event` with the host and role. The runtime normalizes
them and writes only the diagnostic projection under the separate Trellis
workspace trace directory; host payload formats never enter the core reducer.

The supervisor launches real CLI episodes with the host's current permission
policy. Never add approval/sandbox bypass flags. If a host binary, permission, or
model is unavailable, preserve the failed episode and gate/block the run; never
substitute acceptance.

## Interaction at each round boundary

Report verified progress, unverified/rejected work, the next proposed wave,
round budget, and pending human decisions. Never present Executor output as
accepted before its audit event succeeds.
