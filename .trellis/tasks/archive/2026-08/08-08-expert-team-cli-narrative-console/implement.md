# Implementation Plan: Expert Team CLI Narrative Console

## Phase 1 - Planning

- [x] Create Trellis child task under `long-horizon-cross-cli-orchestration`.
- [x] Capture requirements in `prd.md`.
- [x] Add technical design in `design.md`.
- [x] Add implementation plan in this file.
- [x] Resolve the default-output product decision from the user's explicit
  command-line visibility requirement: narrative is on by default, with
  `--quiet`/`--json` opt-outs.
- [x] Review and approve planning artifacts before implementation; proceed from
  the user's explicit instruction to start execution.

## Phase 2 - Implementation

- [x] Inspect existing `scripts/expert_team_run.py`, `runtime/service.py`,
  `runtime/supervisor.py`, and Trellis run-store APIs.
- [x] Add a small renderer module or script-local renderer with no new
  dependencies.
- [x] Render run header, rounds, work items, audits, gates, and Trellis sync
  references from existing typed data.
- [x] Integrate interactive narrative output into the managed run entry point.
- [x] Add `--quiet` and `--json` behavior without changing existing core state
  transitions.
- [x] Ensure raw chain-of-thought, full trajectories, and secrets are not printed.

## Phase 3 - Validation

- [x] Unit-test rendering with completed, blocked/rework, and pending-gate
  fixtures.
- [x] Run existing runtime and supervisor tests.
- [x] Run `python scripts/expert_team_run.py --probe`.
- [x] Smoke-test the console against `e2e-codex-20260807-r3` without rerunning
  a model-backed episode.
- [x] Update `.trellis/spec/plugin/expert-team-contract.md` for the CLI contract
  changes.

## Rollback

Remove the renderer integration and keep `expert_team_run.py` returning the
existing compact behavior. Trellis run data remains unchanged.
