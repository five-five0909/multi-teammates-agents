---
name: expert-team
description: Coordinate a lead and specialist subagents on Codex CLI or Claude Code using lightweight native execution or durable Trellis-backed managed execution with independent audit, resume, and human gates. Use when the user invokes $expert-team or /multi-teammates-agents:expert-team, asks for an expert team or parallel agents, or requests broad multi-workstream, cross-session, evidence-heavy, implementation, investigation, review, migration, or research work. Do not auto-trigger for simple questions, single-file mechanical edits, or tightly coupled work that one agent can complete more efficiently.
---

# Expert Team

Run one bounded expert-team workflow on Codex CLI or Claude Code. Keep the lead
focused on requirements, coordination, synthesis, and the final acceptance
proposal. Delegate only work that is concrete enough to verify independently.

The entry gate in [entry-gate.md](references/entry-gate.md) is mandatory. It
requires an attributable mode choice, a reviewed active Trellis task for
managed work, and a strict graph before any managed state is created.

## 1. Establish the run contract

1. Resolve the current Trellis task and call `expert_team_version`. If a newer
   incompatible package is required, run `mta check-update`, review the exact
   target, then run `mta update --version <exact> --yes` and open a new host
   session before retrying.
2. Restate the requested outcome, constraints, completion criteria, and whether
   the user selected lightweight or managed execution. Never infer a downgrade
   from managed when durable audit or cross-session recovery is required.
3. Read [workflow-routing.md](references/workflow-routing.md). Select a domain
   lens and the lightest valid workflow shape. Do not form a fake team when one
   specialist is sufficient.
4. Read [agent-registry.md](references/agent-registry.md) and its
   `agent-registry.json`, select the smallest
   applicable set, then read each selected profile under `references/agents/`.
   Coordinator profiles are lead playbooks: apply them in the current lead and
   never dispatch a nested orchestrator.
5. Detect `.trellis/`. If present, read
   [trellis-integration.md](references/trellis-integration.md) before changing
   task state or project files.
6. Load project role overrides from `.expert-team/roles/` when that directory
   exists. Then read [expert-catalog.md](references/expert-catalog.md) and merge
   matching overrides by role name.
7. Select one execution tier:
   - Use `lightweight` for bounded work that fits one session and does not need
     durable audit or human gates.
   - Use `managed` when explicitly requested or for cross-session, multi-wave,
     evidence-heavy, or human-gated work. Read
     [managed-mode.md](references/managed-mode.md) before invoking MCP tools.
   - Read [run-ledger-template.md](references/run-ledger-template.md) only for
     legacy lightweight persistence when managed mode is unavailable.

For managed mode, first activate the reviewed Trellis task, build the strict
`TaskContract` / `WorkItem[]`, and call `expert_team_start` with
`qualification_receipt: {"approved":true}`. This receipt means the current
task/graph passed the explicit review gate; never supply it for a planning task
or an unreviewed graph. Then call `expert_team_run`; use
`expert_team_status`/`expert_team_resume` for read-only inspection and
`expert_team_answer` for a pending human gate. If the project MCP was not applied with an explicit
canonical root, stop with `workspace_unbound`, run `mta apply`, and open a fresh session. Hook
coverage is reported as `enforced`, `partial`, or `advisory`; never claim a
host path was blocked when it bypasses hooks.

## 2. Build the task graph

Read [orchestration-contract.md](references/orchestration-contract.md). Create
the smallest task graph that covers the outcome. Every task must have:

- a stable ID and one testable objective;
- one role, mode (`read`, `write`, or `verify`), and required/optional flag;
- explicit dependencies;
- exact file or module ownership for write work;
- required evidence and a completion check.

Do not delegate the same question to several agents unless independent
perspectives are the point. Do not create a subagent just to relay context.

## 3. Apply delegation guardrails

Read [delegation-guardrails.md](references/delegation-guardrails.md) before
dispatching. Re-evaluate whether delegation still buys context reduction,
parallelism, or independent verification at every major wave. Use the
guardrails to distinguish direct work from bounded probe work, and keep the
lead responsible for decisions, integration, and final verification. The
guardrails add discipline to the existing role registry; they do not collapse
`explorer`, `worker`, and `default` into one generic role.

## 4. Dispatch dependency-aware waves

Use host-native Codex or Claude Code subagents when available.

- Dispatch ready read-only tasks in parallel.
- Dispatch write tasks in parallel only when ownership is explicit and
  disjoint. Tell every writer that other agents share the workspace and that it
  must not revert unrelated changes.
- Sequence overlapping, unknown, cross-cutting, or integration-sensitive
  writes.
- Use the narrowest applicable native agent type. Prefer `explorer` for
  read-heavy discovery, `worker` for owned implementation, and `default` for
  review, QA, UI, or mixed specialist work.
- Respect the host concurrency cap. Keep excess tasks pending rather than
  silently dropping them.
- If native subagents are unavailable or disabled, execute the same graph
  sequentially and state that fallback mode is active.

Give each agent only its task-local context, upstream findings, exclusions,
ownership, and result contract. Never leak an expected answer into an
independent review.

## 5. Synchronize and recover

Wait for every required task in the current wave. Use
[result-contract.md](references/result-contract.md) to normalize results.

- Mark incomplete output as failed or blocked, not completed.
- Retry only after narrowing the failure or providing missing context.
- Stop after two repair-and-verification rounds for the same failed gate.
- Preserve useful partial evidence.
- Block dependent tasks when a required dependency fails.
- Resolve conflicting conclusions with evidence or record an explicit lead
  decision and its risk.
- Create a new repair task after failed verification; do not rewrite a
  completed task's history.

## 6. Verify and synthesize

Run the planned verification after integration. In lightweight mode the lead
owns the final claim. In managed mode the lead may propose completion only after
independent audits accept every required item and the human completion gate is
resolved.
Report:

1. outcome and execution mode;
2. entry-gate and qualification evidence;
3. completed expert tasks and their evidence;
4. changed files and checks run;
5. failed, blocked, cancelled, or omitted work;
6. unresolved risks and recommended follow-ups.

Never claim success when a required task or required verification failed.
