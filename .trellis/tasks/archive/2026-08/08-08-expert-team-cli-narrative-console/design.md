# Technical Design: Expert Team CLI Narrative Console

## Decision Summary

Build a small terminal rendering layer on top of the existing managed runtime.
It should observe state transitions already produced by `ExpertTeamService` and
`ManagedRunSupervisor`, then print compact public summaries. It must not become
a second reducer, dashboard server, or state mutation API.

## Boundaries

- Source of truth: Trellis run files written through `TrellisRunStore`.
- Orchestration owner: `ManagedRunSupervisor`.
- State mutation owner: `ExpertTeamService`.
- New responsibility: convert validated snapshots, events, role results, audits,
  and trace references into human-readable terminal output.

## Data Flow

```text
plugin command / scripts/expert_team_run.py
          |
          v
ManagedRunSupervisor -> ExpertTeamService -> TrellisRunStore
          |
          v
Narrative console renderer
          |
          v
stdout: round, role, audit, gate, sync summaries
```

The renderer should consume typed snapshots/events or service methods where
available. It should not parse raw host JSONL except for trace links already
persisted by the runtime.

## Output Contract

Interactive output should be stable enough for users to scan, but not treated as
the authoritative machine API. Automation should use JSON mode.

Minimum sections:

- Run header: task, run ID, state, rounds, pending gate.
- Round timeline: Manager decision, execution wave, audit wave, next state.
- Agents: profile, role, work item, status.
- Audit: status, integrity, alignment, evidence count, rework.
- Trellis sync: state file, trace dir, final report when present.

## Privacy and Safety

- Print public summaries only.
- Do not print private chain-of-thought, raw reasoning events, full stdout
  trajectories, secrets, or raw command metadata.
- Preserve existing redaction behavior from process adapters.
- If a role output is malformed, print a clear fail-closed summary rather than
  trying to reinterpret it.

## Compatibility

- Existing run records must still render.
- Missing optional files should produce "not recorded" sections, not crashes.
- `--quiet` should keep current automation-friendly behavior.
- `--json` should emit a compact structured summary and suppress prose.

## LongHorizon-Harness Alignment

This feature adapts LongHorizon-Harness' observability goal, not its dashboard
architecture. The local implementation stays terminal-first and Trellis-backed.
No remote environment, GUI dashboard, or permission-bypass behavior is imported.
