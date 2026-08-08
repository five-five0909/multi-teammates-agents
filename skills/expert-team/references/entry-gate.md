# Expert Team Entry Gate

The entry gate is mandatory for every explicit `$expert-team` or
`/multi-teammates-agents:expert-team` invocation. It makes plugin participation
observable before any project mutation or managed-run mutation occurs.

## Required order

1. Resolve the current Trellis task and host execution mode. For Codex inline,
   use `host_mode=inline`; for a host that can dispatch native subagents, use
   `host_mode=subagent`.
2. Call `expert_team_prepare` with the original request, intent, task ID (when
   one is active), evidence flags, and host mode. This call is read-only.
3. Follow the returned `next_action`:
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
4. Call `expert_team_qualify` even when the selected tier is lightweight. A
   lightweight qualification is side-effect-free and proves which tier was
   selected; it must not be silently skipped.
5. Before implementation, record a task graph with stable IDs, dependencies,
   mode, required flag, ownership, evidence, and completion checks. In inline
   mode this graph lives in the lead's session summary; in managed mode it is
   persisted by the runtime.
6. End with an Expert Result Contract synthesis. Include the prepare result,
   qualification result, execution mode, completed/failed/blocked/omitted
   tasks, checks, and unresolved risks.

## Non-compliance rules

- Do not edit code, create a managed run, or claim an expert-team run before
  the prepare result is available.
- Do not claim delegation when `host_mode=inline` returned
  `main-session-sequential`.
- Do not call lower-level managed lifecycle methods as a substitute for
  `expert_team_qualify` in the normal path.
- If the MCP server is unavailable, state `sequential-fallback` and preserve
  the same graph and result contract; never silently drop the workflow.
- If a newly added tool is absent from the host tool list, treat the session as
  stale: do not claim the new entry gate ran; ask for a plugin refresh/new
  thread or use the explicit sequential fallback with the omission recorded.
