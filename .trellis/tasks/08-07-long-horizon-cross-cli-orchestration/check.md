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
| AC7 | Partial | Ask/blocked/repeated-failure/completion policy and Manager permission gates are durable; the full gate matrix and both native UX surfaces remain open. |
| AC8 | Partial | Runner argument tests reject bypass options, Codex real traces show no bypass flags and read-only Auditor sandbox, Claude real trace shows no bypass flag before account-policy failure; actual permission prompts have not been observed on both hosts. |
| AC9 | Partial | Qualification is deterministic and side-effect-free, and explicit managed start persists a run; auto-qualified creation is not one atomic operation. |
| AC10 | Pass (simulated integration) | The actual supervisor uses bounded compact Manager prompts; tests exclude trajectories and validate dependency-ready parsing. |
| AC11 | Pass | Twenty profiles and coordinator boundaries are validated. |
| AC12 | Partial | Unit, typing, fixture validator, fake runners, probes, and Claude plugin validation pass; Codex model-backed E2E passes; Claude model-backed E2E/resume remains externally blocked. |
| AC13 | Partial | README, managed-mode reference, config example, storage, permission, and rollback guidance exist; final E2E runbook evidence is pending. |
| AC14 | Partial | One supervisor call drives two complete Manager/Executor/Auditor rounds in fake integration and in Codex model-backed E2E; Claude is blocked before Manager completion. |
| AC15 | Partial | Fresh process, normalized streams, timeout, cancellation, cleanup, and real probes pass; Codex model-backed traces prove fresh role episodes; Claude process starts but model access is blocked. |
| AC16 | Partial | Add/edit/delete/type-change and incomplete hash snapshots reject acceptance; unreadable/restore-failure cases remain open. |
| AC17 | Partial | Explicit > project > per-role environment/default precedence and secret-field rejection pass; complete artifact leak scanning remains open. |
| AC18 | Partial | Unmatched Executor start becomes durable `episode.abandoned` and retries without accepting it; every episode boundary is not yet covered. |
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
Ran 78 tests — OK

python -m mypy runtime scripts tests
Success: no issues found in 42 source files

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
PASS; `.mcp.json` Node launcher selected the installed Python interpreter and
returned `expert-team` / `0.3.1`

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
