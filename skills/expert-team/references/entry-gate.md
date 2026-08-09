# Expert Team Entry Gate

Every explicit expert-team run must pass this gate before managed state or
project writes are created.

## Required order

1. Call `expert_team_version`. If the active host needs a different package,
   run `mta check-update`, review the exact target, then use
   `mta update --version <exact> --yes` and start a fresh host session.
2. Obtain an attributable user choice between lightweight and managed mode when
   the request does not already specify one. Managed is required for
   cross-session, multi-wave, evidence-heavy, or human-gated work.
3. Restate the exact outcome, constraints, acceptance criteria, and omissions.
4. For managed work, use an existing reviewed `in_progress` Trellis task or ask
   for task creation and planning approval. A `planning` task cannot execute.
5. Build the smallest strict `TaskContract` and `WorkItem[]` graph. Every item
   needs a stable ID, dependency list, mode, required flag, exact ownership for
   writes, and evidence requirement.
6. Only after the task and graph are reviewed, call `expert_team_start` with
   `qualification_receipt: {"approved":true}`. The receipt records that this
   explicit gate passed; never fabricate it for an unreviewed graph.
7. Call `expert_team_run` to enter foreground execution. Use
   `expert_team_status` or `expert_team_resume` for read-only inspection and
   `expert_team_answer` for attributable human gates.
8. End with the selected mode, completed/failed/blocked/omitted work, actual
   checks, verified evidence, and unresolved risk.

## Non-compliance rules

- Do not create a managed run before the active task and graph are reviewed.
- Do not claim delegation when the host executes sequentially in the lead.
- Do not call `status` or `resume` and imply that they started model work.
- Do not bypass permission, cancellation, budget, completion, or destructive
  gates.
- Do not present Executor output as accepted before an independent Auditor
  records clean, aligned evidence.
- If MCP is unbound, run project `mta apply` and open a fresh session; never use
  plugin install cwd as the project.
