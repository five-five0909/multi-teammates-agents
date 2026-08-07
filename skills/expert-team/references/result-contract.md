# Expert Result Contract

Require each subagent to return this compact structure:

```markdown
Status: completed | failed | blocked | cancelled
Summary: <one concise outcome>
Evidence:
- <path, command result, source, or observation>
Changed files:
- <path or none>
Checks:
- <command and result, or not run with reason>
Risks:
- <remaining risk or none>
Follow-ups:
- <next action or none>
```

## Lightweight lead normalization rules

- Accept `completed` only when the task's completion check and evidence are
  present.
- Treat missing or ambiguous status as `failed` until clarified.
- Keep partial evidence from failed or blocked work.
- Verify changed files against assigned ownership before integration.
- Do not paste large raw logs into the main thread; retain the command and the
  smallest output fragment that proves the result.
- Separate facts from recommendations.

## Managed acceptance rules

- Submit the Executor output as `RoleResult`; this remains unverified.
- Assign a different identity as Auditor and require inspection of actual
  artifacts or evidence.
- Accept only an `AuditDecision` with `status: accepted`, `integrity: clean`,
  and `contract_alignment: aligned`.
- Never rewrite a rejected audit. Record rework as a new attempt.
- After the retry limit, retain evidence and report `blocked`.

## Final synthesis contract

The lead reports:

```markdown
Outcome: success | partial | blocked | failed
Execution: parallel | sequential-fallback

Completed:
- <task, role, result, evidence>

Changes and checks:
- <files and validation>

Incomplete:
- <failed, blocked, cancelled, or omitted task and impact>

Risks and follow-ups:
- <remaining item or none>
```

`success` is invalid when any required lightweight task is not `completed`, or
when any required managed WorkItem is not independently `accepted`.
