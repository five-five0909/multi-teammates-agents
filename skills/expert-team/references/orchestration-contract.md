# Orchestration Contract

## Task record

Maintain one logical record per task:

| Field | Requirement |
|---|---|
| `id` | Stable and unique within the run. |
| `objective` | One bounded, testable outcome. |
| `role` | Built-in or project-defined expert role. |
| `mode` | `read`, `write`, or `verify`. |
| `required` | Whether failure blocks successful completion. |
| `depends_on` | IDs that must complete first. |
| `ownership` | Exact files or modules for write tasks; empty otherwise. |
| `wave` | Non-negative scheduling wave. Dependencies use lower waves. |
| `status` | Current state. |
| `evidence` | File references, commands, test output, or source links. |
| `result` | Distilled outcome. |
| `failure` | Actionable failure or blocker. |

## Lightweight state transitions

Use only these transitions:

```text
pending -> running | blocked | cancelled
running -> completed | failed | blocked | cancelled
```

Terminal states do not transition. A failed verification creates a new repair
task rather than reopening a completed task. Allow at most two repair-and-
verification rounds for the same failed gate; then report the blocker.

## Managed state transitions

Managed mode uses the bundled runtime contract:

```text
initialized -> managing -> executing_wave -> auditing_wave
auditing_wave -> managing | needs_input | blocked
managing | auditing_wave -> proposed_complete -> completed
any non-completed state -> cancelled
```

An Executor result moves work only to `submitted`; it is not verified progress.
An independent Auditor moves it to `accepted`, `rework`, or `blocked`. Only an
accepted audit with clean integrity and aligned contract adds verified evidence.

## Dependency rules

- Reject missing, self-referential, or cyclic dependencies.
- Schedule a lightweight task only after every dependency is `completed`.
- Schedule a managed WorkItem only after every dependency is `accepted`.
- Mark a task `blocked` when a required dependency ends in another terminal
  state.
- Keep task IDs and dependency edges stable in summaries and persisted ledgers.

## Concurrency rules

- Parallelize ready `read` and `verify` work when independent.
- A `write` task must declare non-empty ownership.
- Two write tasks may share a wave only when every ownership scope is disjoint.
- Treat scopes as overlapping when they are equal or one is a path/module
  ancestor of the other.
- Sequence write work with unknown ownership.
- Reserve cross-cutting integration for the lead unless a dedicated integrator
  has exclusive ownership.

## Dispatch prompt

Include all of the following:

```text
Run goal: <overall outcome>
Task: <id> — <objective>
Role: <role responsibilities>
Dependencies: <upstream findings or none>
Mode: <read|write|verify>
Ownership: <exact scopes or none>
Exclusions: <what this expert must not do>
Evidence required: <specific evidence>
Completion check: <testable check>

Other agents may share the workspace. Preserve unrelated changes and do not
revert work you do not own. Return the Expert Result Contract only.
```

## Automatic-trigger threshold

Implicitly activate only when at least one is true:

- two or more workstreams can execute independently;
- materially different specialties are required;
- independent verification would materially improve confidence;
- the request explicitly asks for delegation, parallelism, or an expert team.

Do not implicitly activate for a simple answer, a mechanical one-file change,
or tightly coupled work where delegation would add more coordination than value.

After activation, select managed mode only when explicitly requested or when
the work is cross-session, multi-wave, evidence-heavy, or human-gated.
