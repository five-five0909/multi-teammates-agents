# Optional Run Ledger Template

Create `.expert-team/runs/<run-id>.md` only for long-running or cross-session
work, or when the user explicitly requests persistence. Use a filesystem-safe,
descriptive run ID. Do not create `.expert-team/` for ordinary runs.

```markdown
# Expert Team Run: <run-id>

## Goal

<Requested outcome and acceptance criteria>

## Execution

- Mode: parallel | sequential-fallback
- Started: <ISO-8601 timestamp when useful>
- Trellis task: <path or none>

## Tasks

| ID | Role | Mode | Required | Dependencies | Ownership | Status |
|---|---|---|---|---|---|---|
| T1 | researcher | read | yes | - | - | completed |

## Evidence and results

### T1 — <objective>

- Result: <summary>
- Evidence: <references>
- Checks: <commands/results>
- Failure: <reason or none>

## Final synthesis

- Outcome: success | partial | blocked | failed
- Changes: <paths or none>
- Verification: <evidence>
- Incomplete work: <items or none>
- Risks: <items or none>
```

Update the ledger at wave boundaries, not for every token or tool call. Never
store secrets, raw chat transcripts, or large logs.

