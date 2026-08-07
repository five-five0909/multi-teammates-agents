# Trellis Integration

Use this adapter only when `.trellis/` exists in the target repository.

## Rules

1. Read the repository's `AGENTS.md` and Trellis startup/workflow guidance.
2. Resolve the current task and phase with the repository-provided scripts.
3. Treat the active task's PRD, design, and implementation plan as the source
   requirements for expert decomposition.
4. Follow task-creation consent, planning review, activation, checking, spec
   update, and finish gates exactly as the local workflow defines them.
5. Do not create, start, archive, or otherwise change Trellis task lifecycle
   merely because the skill was invoked.
6. Lightweight mode does not write Trellis runtime state. Managed mode may
   write only through the bundled Trellis adapter and only beneath
   `.trellis/tasks/<approved-task>/runs/<run-id>/`.
7. Keep raw host trajectories under
   `.trellis/workspace/<developer>/traces/<run-id>/`; do not append them to PRD,
   design, implementation, or task metadata files.
8. Managed runtime writes never change `task.json` status, phase, assignee,
   approval, or archive state. Use repository Trellis commands for lifecycle.
9. If Trellis requires inline implementation, keep implementation and checking
   in the main session even though read-only research may still be delegated.

## Ledger behavior

Use host-native threads and the lead's in-memory ledger in lightweight mode.
For a qualified managed run, use the MCP service and its append-only event,
audit, and decision records. The run ledger supplements evidence and resume; it
never replaces Trellis task status or phase gates.

## Conflict rule

When this skill and repository-local Trellis instructions differ, the local
Trellis phase and safety constraints win. Preserve the expert-team result and
verification contracts within those constraints.
