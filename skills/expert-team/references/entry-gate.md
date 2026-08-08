# Expert Team Entry Gate

The entry gate is mandatory for every explicit `$expert-team` or
`/multi-teammates-agents:expert-team` invocation. It makes plugin participation
observable before any project mutation or managed-run mutation occurs.

## Required order

1. Resolve the current Trellis task and host execution mode, then call
   `expert_team_version` with host package/protocol/toolset metadata. If the
   report says `upgrade_required`, run the printed upgrade commands (or
   `python scripts/expert_team_upgrade.py --upgrade`) and open a new host
   session before continuing. For Codex inline,
   use `host_mode=inline`; for a host that can dispatch native subagents, use
   `host_mode=subagent`.
2. Call `expert_team_prepare` with the original request, intent, task ID (when
   one is active), evidence flags, and host mode. This call is read-only.
3. If `decision_state=selection_required`, render the two `mode_options`
   returned by `prepare` as one host-native single-select. Call
   `expert_team_select_mode` only after a real host/user event whose
   `source_event_id` is the one bound by `prepare`; a caller-provided
   `actor=user` without that event is not attribution. If the policy is locked,
   do not present a fake downgrade. A host without a selection control must
   stop at `needs_input`.
4. Follow the returned `next_action`:
   - `request_task_consent`: ask for Trellis task-creation consent and stop
     before implementation;
   - `activate_trellis_task`: finish and review planning artifacts, then start
     the task through the repository Trellis command;
   - `qualify_auto_start`: call `expert_team_qualify` with a strict
     `TaskContract` and `WorkItem` graph and `auto_start=true`;
   - `build_graph_then_execute_in_main`: keep implementation/checking in the
     main session and explicitly report the sequential fallback;
   - `build_graph_then_dispatch`: dispatch only dependency-ready tasks with
     exact ownership and the result contract.
5. Call `expert_team_qualify` even when the selected tier is lightweight. Pass
   the invocation ID plus strict `TaskContract` and `WorkItem[]`; the server
   re-evaluates graph waves and issues a workspace-bound qualification receipt.
   A lightweight qualification remains side-effect-free and must not be
   silently skipped.
6. Before implementation, record a task graph with stable IDs, dependencies,
   mode, required flag, ownership, evidence, and completion checks. In inline
   mode this graph lives in the lead's session summary; in managed mode it is
   persisted by the runtime.
7. End with an Expert Result Contract synthesis. Include the prepare result,
   qualification result, execution mode, completed/failed/blocked/omitted
   tasks, checks, and unresolved risks.

## Non-compliance rules

- Do not edit code, create a managed run, or claim an expert-team run before
  the prepare result is available.
- Do not call `expert_team_qualify` without an invocation ID, strict graph, and
  (when required) a selected mode; the server must return `needs_input` or a
  contract error instead of guessing.
- Do not call `expert_team_start` without the qualification receipt. Receipts
  are bound to the canonical workspace, task metadata, contract, and graph;
  changing any of those facts requires a new qualification.
- Do not claim delegation when `host_mode=inline` returned
  `main-session-sequential`.
- Do not call lower-level managed lifecycle methods as a substitute for
  `expert_team_qualify` in the normal path.
- If the MCP server is unavailable, state `sequential-fallback` and preserve
  the same graph and result contract; never silently drop the workflow.
- If a newly added tool is absent from the host tool list, treat the session as
  stale: do not claim the new entry gate ran; ask for a plugin refresh/new
  thread or use the explicit sequential fallback with the omission recorded.
- A `stale_session` response is a hard stop. Preserve its version report and
  upgrade commands; never bypass it by omitting host metadata or selecting a
  lower execution tier.
