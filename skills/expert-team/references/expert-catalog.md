# Expert Catalog

Use the smallest set of roles that covers the task. A role is a responsibility
boundary, not a reason to spawn an agent.

The six roles below are the Qoder-observed core compatibility roles. The full
20-profile cross-domain catalog adapted from ExpertTeam-Codex is indexed in
[agent-registry.md](agent-registry.md). Prefer a specific registered profile
when its responsibility matches; fall back to these general roles otherwise.

## Researcher

- Purpose: locate code, dependencies, documentation, and environmental facts.
- Default mode: read.
- Prefer: `explorer`.
- Exclude: implementation unless explicitly reassigned.
- Evidence: paths, symbols, sources, and concise dependency maps.

## Debug Engineer

- Purpose: reproduce failures, trace execution, and identify root causes.
- Default mode: read.
- Prefer: `explorer` or `default`.
- Exclude: speculative fixes before the failure mode is established.
- Evidence: reproduction steps, observed versus expected behavior, and causal
  chain.

## Full-Stack Engineer

- Purpose: implement bounded frontend, backend, cross-stack, or general code
  changes.
- Default mode: write.
- Prefer: `worker`.
- Require: exact ownership and a validation command.
- Exclude: unrelated refactors and integration outside assigned ownership.

## Code Reviewer

- Purpose: find correctness, security, regression, maintainability, and test
  risks in completed changes.
- Default mode: read.
- Prefer: `default`.
- Exclude: style-only findings without concrete impact.
- Evidence: severity, path/symbol, failure scenario, and recommended action.

## QA

- Purpose: run builds and tests, validate acceptance criteria, and collect
  reproducible evidence.
- Default mode: verify.
- Prefer: `default`.
- Exclude: changing product code unless assigned a separate repair task.
- Evidence: exact commands, exit status, relevant output, and coverage gaps.

## UI Operator

- Purpose: reproduce and validate browser or UI behavior with visual,
  accessibility, console, and network evidence when tools permit.
- Default mode: verify.
- Prefer: `default`.
- Exclude: source edits unless assigned a separate write task.
- Evidence: steps, screenshots or observations, console/network findings, and
  environment details.

## Project role overrides

Before dispatch, inspect `.expert-team/roles/*.md` when present. A role file uses
this compact format:

```markdown
---
name: security-reviewer
description: Review authentication and authorization boundaries.
default_mode: read
preferred_agent_type: default
---

Project-specific responsibilities, exclusions, and evidence requirements.
```

Match `name` case-insensitively. A matching project role replaces the default
role for the run; a new name extends the catalog. Reject an override that omits
its name, description, default mode, or body. Never create override files
automatically.
