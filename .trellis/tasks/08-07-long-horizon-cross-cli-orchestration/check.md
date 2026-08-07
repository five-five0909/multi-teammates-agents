# Verification Report: Long-Horizon Cross-CLI Expert Team Orchestration

Date: 2026-08-07

## Outcome

**Implementation milestone passes local checks; task remains `in_progress`.**

The repository now contains an executable automatic Manager -> Executor wave ->
independent Auditor supervisor, real Codex/Claude CLI process adapters, bounded
role prompts, workspace integrity enforcement, strict runtime configuration,
deterministic tier qualification, and restart reconciliation. This closes the
earlier implementation gap, but model-backed cross-host E2E and several failure
matrix cases still require explicit cost-bearing authorization and further tests.

## Evidence classification

| Level | Meaning | Present |
|---|---|---|
| Unit | Contracts, reducer, configuration, routing, prompts, integrity diff | Yes |
| Simulated integration | Fake processes and fake-backend autonomous supervisor | Yes |
| Local CLI smoke | Real binary discovery/version process without a model task | Yes: Codex `0.146.0`, Claude Code `2.1.220` |
| Model-backed E2E | Real Manager, Executor, Auditor episodes | No; intentionally not run without cost authorization |

## Acceptance status

| Criterion | Status | Current evidence / missing proof |
|---|---|---|
| AC1 | Pass | Both manifests expose the shared MCP runtime and validate locally. |
| AC2 | Open | Equivalent real role scenarios have not run on both billed hosts. |
| AC3 | Partial | Separate read-only Auditor episodes and fail-closed mutation rejection pass simulated integration; real-host evidence is missing. |
| AC4 | Pass (core) | Replay and abandoned Executor retry preserve accepted evidence; not every real-host boundary has been interrupted. |
| AC5 | Pass | Replay/snapshot equality and corrupt-tail diagnostics are tested. |
| AC6 | Partial | Dependency/ownership scheduling and shared adapter contracts pass; cross-host model-backed scheduling is unproved. |
| AC7 | Partial | Ask/blocked/repeated-failure/completion policy and Manager permission gates are durable; the full gate matrix and both native UX surfaces remain open. |
| AC8 | Partial | Runner argument tests reject bypass options and both binaries probe successfully; an actual permission prompt has not been observed on both hosts. |
| AC9 | Partial | Qualification is deterministic and side-effect-free, and explicit managed start persists a run; auto-qualified creation is not one atomic operation. |
| AC10 | Pass (simulated integration) | The actual supervisor uses bounded compact Manager prompts; tests exclude trajectories and validate dependency-ready parsing. |
| AC11 | Pass | Twenty profiles and coordinator boundaries are validated. |
| AC12 | Partial | Unit, typing, package validators, fake runners, and probes pass; model-backed E2E/resume remains open. |
| AC13 | Partial | README, managed-mode reference, config example, storage, permission, and rollback guidance exist; final E2E runbook evidence is pending. |
| AC14 | Pass (simulated integration) | One supervisor call drives two complete Manager/Executor/Auditor rounds and opens completion. |
| AC15 | Partial | Fresh process, normalized streams, timeout, cancellation, cleanup, and real probes pass below model level. |
| AC16 | Partial | Add/edit/delete/type-change and incomplete hash snapshots reject acceptance; unreadable/restore-failure cases remain open. |
| AC17 | Partial | Explicit > project > per-role environment/default precedence and secret-field rejection pass; complete artifact leak scanning remains open. |
| AC18 | Partial | Unmatched Executor start becomes durable `episode.abandoned` and retries without accepting it; every episode boundary is not yet covered. |
| AC19 | Pass (reporting) | This report distinguishes all four proof levels and leaves real-host claims open. |

## Implemented foundation

- Typed `HostAdapter` boundary and one fresh shell-free process per role episode.
- Codex JSONL and Claude stream-json runners without permission/sandbox bypass.
- Continuous supervisor with strict route parsing, dependency-ready waves,
  independent audits, bounded repair, explicit gates, and compact prompts.
- Trellis episode events/traces plus abandoned-attempt reconciliation.
- Auditor read-only restrictions and before/after workspace integrity snapshots.
- Strict TOML/environment/override configuration and secret redaction/rejection.
- Side-effect-free lightweight/managed qualification and shared MCP run entry.

## Deterministic checks

```text
python -m unittest discover -s tests -p "test_*.py"
Ran 74 tests — OK

python -m mypy runtime scripts tests
Success: no issues found in 38 source files

python -m compileall -q runtime scripts tests
PASS

python scripts/validate_contract.py tests/fixtures
6 fixtures — PASS

python scripts/render_claude_agents.py --check
20 Claude agents — PASS

Codex plugin validator / expert-team skill validator / claude plugin validate --strict
PASS / PASS / PASS

python scripts/expert_team_run.py --probe
Codex CLI 0.146.0 and Claude Code 2.1.220 available — PASS
```

## Remaining gates

1. Obtain explicit authorization before running billable model-backed Codex and
   Claude scenarios.
2. Complete the full operational gate, integrity failure, secret leak, and
   every-episode crash/restart matrices.
3. Record cross-host run IDs, host versions, episode/trace references, permission
   posture, audit evidence, and final state.
4. Only then close AC2/AC3/AC6-AC9/AC12/AC13/AC15-AC18 and run
   `trellis-finish-work`.
