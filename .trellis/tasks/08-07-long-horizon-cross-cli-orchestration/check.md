# Verification Report: Long-Horizon Cross-CLI Expert Team Orchestration

Date: 2026-08-08

## Outcome

**Implementation milestone passes local checks; task remains `in_progress`.**

The repository now contains an executable automatic Manager -> Executor wave ->
independent Auditor supervisor, real Codex/Claude CLI process adapters, bounded
role prompts, workspace integrity enforcement, strict runtime configuration,
deterministic tier qualification, and restart reconciliation. This closes the
earlier implementation gap. Codex now has one passing model-backed managed E2E
run. Claude Code model-backed E2E is blocked by the local organization/account
configuration, and several failure matrix cases still require further tests.

## 2026-08-08 host-managed plugin install recheck

The packaging fix is released as `0.3.2`. A fresh isolated Codex home installed
the public `main` marketplace without a checkout or manual MCP entry. Codex
loaded the inline manifest map, reported `expert-team` as enabled through
`codex mcp get`, and an initialize request returned `expert-team/0.3.2`.
A fresh isolated Claude config installed the same public plugin and reported
`plugin:multi-teammates-agents:expert-team` as `Connected`; the unrelated
project-root `.mcp.json` entry remained separately marked pending approval.
Ubuntu 22.04 WSL, with no `python` alias and only `python3`, also initialized
the bundled launcher and returned `expert-team/0.3.2`.

This proves plugin-managed MCP registration on both package surfaces without
editing the user's Codex or Claude configuration. CC Switch JSON remains only
the documented fallback for hosts that cannot consume bundled plugin MCP.

## 2026-08-08 terminal lifecycle recheck

The repository-local `scripts/expert_team_run.py` now exposes the same durable
lifecycle as the MCP service: `--start` creates a run from strict contract and
work-item JSON, `--foreground`/`--run` drives the supervisor, `--status` renders
the public narrative, `--resume` returns compact continuation state,
`--answer` records a HumanDecision, and `--cancel` preserves evidence while
terminating the run. The regression invokes the real script in a clean
temporary Trellis task and completes start -> status -> resume -> answer ->
cancel without manually submitting role results or audits.

Evidence: `tests/test_cli_lifecycle.py`, `python -m unittest tests.test_cli_lifecycle`
(`1 test`, PASS), and the full suite (`93 tests`, PASS). This closes the local
CLI half of R25; the native Codex/Claude model-backed gate matrix remains open.

## 2026-08-08 mandatory Expert Team entry handshake

The plugin now exposes a read-only `expert_team_prepare` MCP entry gate. It
reports the selected tier, Trellis task status, task-creation consent, host
dispatch mode, blockers, and the next legal action before implementation or a
managed-run mutation. The skill requires `prepare -> qualify -> task graph`
evidence for every explicit invocation. Codex inline mode is reported as
`main-session-sequential`; it cannot be presented as native delegation.

Evidence: `tests/test_service_mcp.py` entry-handshake coverage, local stdio
smoke of `expert_team_prepare` and `expert_team_qualify`, `python -m mypy
runtime scripts tests`, plugin/skill validators, and `python -m unittest
discover tests` (`93 tests`, PASS).

## 2026-08-08 failure and secret-safety recheck

Executor/Auditor permission-required, timeout, cancellation, and generic
episode failures now persist terminal episode events, move unaccepted work to
bounded rework/blocked state, and open a durable permission or repeated-failure
gate instead of fabricating a result for audit. A round budget opens an explicit
`budget` gate before a new Manager episode. Restart tests cover unmatched
Manager, Executor, and Auditor starts and preserve the abandoned marker.
Concurrent cancellation tests also prove that a running Manager or Auditor
does not append a terminal result/audit after the run is cancelled; the next
controller reconciles the unmatched start as abandoned.

The shared redaction boundary covers process streams, command metadata, service
events, role/audit files, compact snapshots, final reports, and diagnostic
traces. `tests/test_service_mcp.py` scans the actual temporary Trellis files
and verifies managed `auto_start` creation; unreadable files and snapshot
failures remain fail-closed integrity evidence.

## Evidence classification

| Level | Meaning | Present |
|---|---|---|
| Unit | Contracts, reducer, configuration, routing, prompts, integrity diff, MCP package contract | Yes |
| Simulated integration | Fake processes and fake-backend autonomous supervisor | Yes |
| Local CLI smoke | Real binary discovery/version process without a model task | Yes: Codex `0.147.0`, Claude Code `2.1.220`; MCP initialize on Windows and Ubuntu 22.04 |
| Model-backed E2E | Real Manager, Executor, Auditor episodes | Codex pass: `e2e-codex-20260807-r3`; Claude blocked by account policy in `e2e-claude-20260807` |

## Acceptance status

| Criterion | Status | Current evidence / missing proof |
|---|---|---|
| AC1 | Pass | Both manifests expose the shared MCP runtime and validate locally. |
| AC2 | Open | Codex real scenario completed with matching two-round work/audit semantics. Claude could not start Manager episodes because Claude Code returned organization/account access disabled; cross-host parity remains unproved. |
| AC3 | Partial | Separate read-only Auditor episodes and fail-closed mutation rejection pass simulated integration; Codex real Auditor acceptance is recorded, but real failed-audit/rework evidence on both hosts is missing. |
| AC4 | Pass (core) | Replay and abandoned Executor retry preserve accepted evidence; not every real-host boundary has been interrupted. |
| AC5 | Pass | Replay/snapshot equality and corrupt-tail diagnostics are tested. |
| AC6 | Partial | Dependency/ownership scheduling and shared adapter contracts pass; Codex real run sequenced dependent work correctly, but cross-host model-backed scheduling is unproved. |
| AC7 | Partial | Ask/blocked/repeated-failure/budget/completion and Manager/Executor/Auditor permission gates are durable; MCP and the repository CLI expose equivalent answer/resume/cancel semantics, but the full real-host gate matrix and both native model UX surfaces remain open. |
| AC8 | Partial | Runner argument tests reject bypass options, Codex real traces show no bypass flags and read-only Auditor sandbox, Claude real trace shows no bypass flag before account-policy failure; actual permission prompts have not been observed on both hosts. |
| AC9 | Pass (deterministic) | Default qualification remains side-effect-free for lightweight and managed previews; explicit `auto_start=true` with a strict contract/task graph creates and returns a valid Trellis run in one MCP call. |
| AC10 | Pass (simulated integration) | The actual supervisor uses bounded compact Manager prompts; tests exclude trajectories and validate dependency-ready parsing. |
| AC11 | Pass | Twenty profiles and coordinator boundaries are validated. |
| AC12 | Partial | Unit, typing, fixture validator, fake runners, probes, and Claude plugin validation pass; Codex model-backed E2E passes; Claude model-backed E2E/resume remains externally blocked. |
| AC13 | Partial | README, Chinese README, managed-mode reference, config example, storage, permission, rollback guidance, and CLI lifecycle commands exist; final cross-host E2E runbook evidence is pending. |
| AC14 | Partial | One supervisor call drives two complete Manager/Executor/Auditor rounds in fake integration and in Codex model-backed E2E; Claude is blocked before Manager completion. |
| AC15 | Partial | Fresh process, normalized streams, timeout, cancellation, cleanup, and real probes pass; Codex model-backed traces prove fresh role episodes; Claude process starts but model access is blocked. |
| AC16 | Pass (deterministic) | Add/edit/delete/type-change, unreadable-file, snapshot-failure, and mutation/restoration-uncertainty tests all fail closed; uncertain restoration is recorded as not attempted/not verified rather than auto-reverting user files. |
| AC17 | Pass (deterministic) | Explicit > project > per-role environment/default precedence and secret-field rejection pass; centralized redaction is now asserted across process streams, command metadata, events, role/audit records, snapshots, reports, and diagnostic traces. |
| AC18 | Partial | Unmatched Manager, Executor, and Auditor starts become durable `episode.abandoned` records; failed/timeout/cancelled role terminals and external cancellation races rework/block or skip submission without accepting evidence. Real host interruption coverage at every boundary remains open. |
| AC19 | Pass (reporting) | This report distinguishes all four proof levels and does not relabel the Claude account-policy failure as E2E success. |

## Implemented foundation

- Typed `HostAdapter` boundary and one fresh shell-free process per role episode.
- Codex JSONL and Claude stream-json runners without permission/sandbox bypass.
- Continuous supervisor with strict route parsing, dependency-ready waves,
  independent audits, bounded repair, explicit gates, and compact prompts.
- Trellis episode events/traces plus abandoned-attempt reconciliation.
- Auditor read-only restrictions and before/after workspace integrity snapshots.
- Strict TOML/environment/override configuration and secret redaction/rejection.
- Side-effect-free lightweight/managed qualification and shared MCP run entry.
- Cross-platform MCP launcher: Node selects the available Python command and
  forwards both plugin-root environment names; no user Codex/Claude config is
  mutated.
- Python 3.10 startup and TOML configuration compatibility through the bundled
  TOML backport, without a user-side pip install.

## Deterministic checks

```text
python -m unittest discover tests
Ran 91 tests — OK

python -m mypy runtime scripts tests
Success: no issues found in 49 source files

python -m compileall runtime scripts tests
PASS

python scripts/validate_contract.py tests/fixtures
6 fixtures — PASS

python scripts/render_claude_agents.py --check
20 Claude agents — PASS

claude plugin validate .
PASS

codex plugin --help
PASS; Codex CLI 0.147.0 has plugin add/list/marketplace/remove but no local validate subcommand

python scripts/expert_team_run.py --probe
Codex CLI 0.147.0 and Claude Code 2.1.220 available — PASS

MCP initialize smoke (Windows)
PASS; the Codex inline entry and Claude `.mcp.json` Node launcher selected the
installed Python interpreter and returned `expert-team` / `0.3.2`

Fresh plugin install smoke (Windows / Ubuntu 22.04 WSL)
PASS; Codex `0.147.0` and Claude Code `2.1.220` registered the bundled MCP from
the public plugin install. Ubuntu had no `python` alias and selected `python3`.

MCP initialize smoke (Ubuntu 22.04 / WSL)
PASS; host had `python3` but no `python`, launcher selected `python3` and the
Python 3.10 runtime initialized with the bundled TOML backport

python scripts/model_e2e.py --host codex --run-id e2e-codex-20260807-r3 --timeout-seconds 300 --approve-completion --yes-cost-bearing
model_backed_e2e PASS; completed; 7 role episodes; traces under .trellis/workspace/fifine/traces/e2e-codex-20260807-r3/

python scripts/model_e2e.py --host claude --run-id e2e-claude-20260807 --timeout-seconds 300 --approve-completion --yes-cost-bearing
model_backed_e2e BLOCKED; Claude Code returned organization/account access disabled before Manager completion

python scripts/model_e2e.py --host codex --run-id guard-check-no-repeat
PASS; exits before launch and requires --yes-cost-bearing
```

## Remaining gates

1. Provide/enable Claude Code model access through an Anthropic API key or org
   setting, then rerun `e2e-claude-20260807` or a new Claude run ID.
2. Complete the real failed-audit/rework scenario on both hosts.
3. Complete the full operational gate, integrity failure, secret leak, and
   every-episode crash/restart matrices.
4. Record cross-host run IDs, host versions, episode/trace references, permission
   posture, audit evidence, and final state.
5. Only then close AC2/AC3/AC6-AC9/AC12/AC13/AC15-AC18 and run
   `trellis-finish-work`.
