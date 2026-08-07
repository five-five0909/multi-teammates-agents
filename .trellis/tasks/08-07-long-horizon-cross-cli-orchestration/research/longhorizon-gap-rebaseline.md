# LongHorizon-Harness gap rebaseline

Date: 2026-08-07

Upstream repository: `AMAP-ML/LongHorizon-Harness`

Reviewed baseline: `b1b804519c1ffe1b00e60c19290157c82e3e5c83`

## Finding

The local implementation is a durable orchestration state kernel, not yet a
complete task host. Its service records caller-supplied transitions, Executor
results, and Auditor decisions. Its Codex and Claude adapters normalize supplied
events but do not invoke either host. Existing end-to-end tests exercise the
service API directly and therefore do not prove autonomous orchestration or real
host parity.

## Upstream behavior to adapt

| Upstream source | Behavior | Local disposition |
|---|---|---|
| `src/lh_harness/manager.py` | Bounded continuous Manager -> Executor -> Auditor loop, route parsing, repair feedback, human gates, final report | Adapt control-flow semantics into a plugin-safe supervisor; retain dependency-aware waves. |
| `src/lh_harness/role_prompts.py` and `prompt_texts.py` | Role-specific bounded prompts and trusted-context selection | Adapt concepts and parsers; integrate canonical Expert Team roles and Trellis evidence references. |
| `src/lh_harness/adapters/base.py` and `cli_agent.py` | `run_episode` contract, unique prompt per episode, timeout, trajectory streaming | Port the interface and lifecycle concepts after file-level license review. |
| `src/lh_harness/adapters/codex.py` | Actual `codex exec --json` invocation | Reimplement without `--dangerously-bypass-approvals-and-sandbox`. |
| `src/lh_harness/adapters/claude_code.py` | Actual Claude stream-json invocation and auditor workspace guard | Reimplement without `--dangerously-skip-permissions`; preserve mutation detection and fail-closed behavior. |
| `src/lh_harness/adapters/claude_permissions.py` | Workspace snapshot/diff for Auditor mutation detection | Candidate for selective port with Windows/path/size tests and attribution. |
| `src/lh_harness/auditor_agent.py` | Strict audit report validation and mutation-aware rejection | Adapt to `AuditDecision` and evidence provenance contracts. |
| `src/lh_harness/config.py` | Per-role backend/model/timeout configuration and fallback | Adapt into versioned project config with plugin-safe precedence and secret policy. |
| `src/lh_harness/dashboard/*` | Live dashboard and human approval UI | Do not port in this milestone; expose equivalent lifecycle through MCP/skill/CLI interaction. |
| `src/lh_harness/environment/*` and computer-use plugins | Remote/GUI execution | Out of scope unless separately approved. |

## Proof levels

Verification must label evidence as one of:

1. unit: isolated contracts/reducers/parsers;
2. simulated integration: fake streams/processes;
3. local CLI smoke: real binary/process without a billable task episode;
4. model-backed E2E: real Manager/Executor/Auditor episodes and evidence audit.

Only level 4 can close cross-host autonomous execution criteria. Level 3 may
close process invocation, discovery, timeout, and cleanup criteria where no model
reasoning is involved.

## Reuse rules

- Record upstream commit and source path for every copied or substantially
  derived implementation.
- Retain MIT attribution in `THIRD_PARTY_NOTICES.md` and relevant source headers.
- Never copy upstream permission-bypass defaults.
- Prefer adapting small, reviewed algorithms and contracts over copying the
  complete harness or dashboard.

## Implemented reuse ledger

All entries below adapt MIT-licensed concepts from pinned commit
`b1b804519c1ffe1b00e60c19290157c82e3e5c83`; local code was rewritten for this
plugin and is covered by `THIRD_PARTY_NOTICES.md`.

| Upstream path | Local adaptation | Verification | Deliberately excluded |
|---|---|---|---|
| `manager.py` | `runtime/supervisor.py` continuous bounded Manager/Executor/Auditor loop | `tests/test_supervisor.py` two-round, repair, integrity, restart tests | Dashboard control and remote environment |
| `role_prompts.py`, `prompt_texts.py` | `runtime/prompts.py` compact prompts and strict parsers | `tests/test_runtime_foundations.py` budget and identity assertions | Raw trajectory replay and unrelated history |
| `adapters/base.py`, `cli_agent.py` | `runtime/adapters/base.py`, `process.py` typed episodes and shell-free process lifecycle | `tests/test_episode_runners.py` streaming, malformed output, timeout, cancellation, redaction | Shell invocation and unsafe permission defaults |
| `adapters/codex.py` | `runtime/adapters/codex/runner.py` fresh `codex exec --json` episodes | fake executable contract tests plus local binary probe | Approval/sandbox bypass switches |
| `adapters/claude_code.py` | `runtime/adapters/claude/runner.py` fresh stream-json episodes and Auditor tool restrictions | fake executable contract tests plus local binary probe | Permission bypass switches |
| `adapters/claude_permissions.py`, `auditor_agent.py` | `runtime/audit_guard.py` and strict `AuditDecision` integration | mutation/type/hash-limit and supervisor fail-closed tests | Automatic uncertain restoration |
| `config.py` | `runtime/config.py` strict TOML/env/override precedence with per-role bindings | configuration precedence and secret-rejection tests | Persisted credentials |

The upstream dashboard, computer-use plugins, remote execution environment, and
all unsafe bypass defaults remain intentionally unported.
