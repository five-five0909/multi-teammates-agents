# Expert Team CLI Narrative Console

## Goal

Add a terminal-first narrative console for managed Expert Team runs. When a user
invokes the plugin workflow from Codex CLI, the foreground output should make the
expert-team process visible: which agents were selected, what each role is doing,
where agents disagree, what the Manager decided, what the Auditor verified, and
where Trellis persisted the state.

This replaces the idea of a web dashboard for the next milestone. The first
version should be a simple command-line experience that fits Codex CLI and
Claude Code usage without introducing a browser UI, service port, or second
orchestration authority.

## Background

- The parent task `long-horizon-cross-cli-orchestration` already implements the
  LongHorizon-style Manager -> Executor -> Auditor loop with Trellis-backed
  state, traces, audits, human gates, and resume.
- The parent task intentionally excluded a graphical dashboard from the first
  milestone.
- The user now wants the plugin output itself to show an expert-team debate and
  progress view when invoked from the terminal.
- The console must show public, auditable summaries rather than private model
  chain-of-thought.

## Requirements

- R1. Provide a CLI narrative output layer for managed runs, optimized for
  foreground terminal use.
- R2. Show the run goal, run ID, current state, round number, pending gate, and
  Trellis storage references.
- R3. For each Manager round, show selected work items, selected agent profiles,
  dependencies, and the Manager's public decision message.
- R4. For each Executor episode, show role/profile, work item, status, duration,
  and public result summary.
- R5. For each Auditor episode, show audit status, integrity result, contract
  alignment, evidence count, and required rework when present.
- R6. Show controlled "debate" as public role summaries and decision rationale;
  do not expose private chain-of-thought or raw model reasoning.
- R7. Show every Trellis synchronization point at a useful level: episode event,
  result persisted, audit persisted, gate opened, state completed/cancelled.
- R8. Keep the first version read-mostly for visibility. It may render progress
  while `expert_team_run` advances a run, but it must not add a parallel state
  mutation path outside `ExpertTeamService`.
- R9. Enable narrative output by default for interactive terminal runs. Provide
  `--quiet` and `--json` modes for automation so prose never breaks scripted
  usage.
- R10. Work with existing Trellis run records, including old runs that lack new
  narrative-specific metadata.

## Acceptance Criteria

- [x] AC1. Starting a Codex managed run from the CLI prints a readable
  round-by-round narrative without requiring a web dashboard.
- [x] AC2. The narrative includes Manager, Executor, and Auditor public
  summaries for a two-round run.
- [x] AC3. Every Executor result shown in the console is followed by a matching
  Auditor section or an explicit audit-unavailable/fail-closed status.
- [x] AC4. Console output shows Trellis run ID, state, verified progress count,
  pending gate, and trace/final-report references.
- [x] AC5. The output never prints raw chain-of-thought, raw full trajectories,
  secrets, or unredacted command metadata.
- [x] AC6. Quiet/JSON mode preserves automation compatibility.
- [x] AC7. A fixture or fake-backend test proves the console renders completed,
  blocked/rework, and pending human-gate states.
- [x] AC8. Codex CLI smoke verification proves the command line experience works
  on the existing passing Codex managed scenario.

## Out of Scope

- Web dashboard, MCP Apps UI, remote dashboard, or browser-based monitoring.
- New orchestration state machine separate from `ManagedRunSupervisor` and
  `ExpertTeamService`.
- Displaying private model reasoning or raw full traces in the normal console.
- Reworking Claude account access; Claude remains dependent on local credentials
  and organization policy.

## Product Decision

Interactive managed runs enable the narrative by default. Automation callers
must opt into `--quiet` or `--json`; this keeps the requested foreground agent
visibility while preserving a stable machine-readable path.
