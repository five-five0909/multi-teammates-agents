# Multi Teammates Agents

`multi-teammates-agents` is a Codex CLI and Claude Code plugin for coordinating
specialist agents. It supports lightweight native delegation and durable,
Trellis-backed managed runs with independent audit, resume, bounded retries,
and human completion gates.

The plugin does not copy Qoder code or require Qoder services. Codex and Claude
Code keep ownership of agent execution, permissions, concurrency, and native
inspection; the bundled local MCP server owns portable run state and evidence
acceptance.

## Capabilities

- Explicit `$expert-team` on Codex or
  `/multi-teammates-agents:expert-team` on Claude Code, plus conservative
  implicit activation.
- Dependency-aware task graphs and truthful state reporting.
- Six default roles: researcher, debug engineer, full-stack engineer, code
  reviewer, QA, and UI operator.
- Twenty separately defined ExpertTeam-Codex profiles across software, product,
  design, infrastructure, security, and database work.
- Lightweight `direct`, `fast`, `bugfix`, `standard`, and `audit` workflow
  routing with software, product, design, operations, security, and database
  lenses.
- Parallel read-only work and controlled disjoint write ownership.
- Sequential fallback when native subagents are unavailable.
- Optional project role overrides under `.expert-team/roles/`.
- Lightweight mode without Trellis runtime records.
- Managed mode with Trellis persistence, interruption recovery, leases,
  independent audit, compact resume context, and human gates.
- One normalized event contract for Codex and Claude host streams.

## Plugin structure

The repository root is the plugin root. Codex uses
`.codex-plugin/plugin.json`; Claude Code uses `.claude-plugin/plugin.json`.
Both load `skills/expert-team/`, the root `.mcp.json`, the shared Python
runtime, and the same canonical role registry. Claude also auto-discovers the
twenty generated definitions under `agents/`.

No external account, hosted service, or graphical canvas is required.

## Use

Invoke the skill explicitly:

```text
$expert-team Investigate the performance regression, implement the fix, review
it for correctness, and verify the benchmark.
```

Add an optional routing hint when the domain should be explicit:

```text
$expert-team security Audit the authentication boundary and report evidence.
$expert-team ops Diagnose the deployment regression and propose a rollback-safe plan.
```

On Claude Code, invoke the namespaced skill:

```text
/multi-teammates-agents:expert-team Audit this migration with independent QA.
```

Codex may also activate the skill when a request has multiple independent
workstreams or materially different specialist perspectives. It should not
auto-trigger for simple questions or small mechanical edits.

Use `/agent` in Codex CLI or Claude Code's agent/context surfaces to inspect
native work. Subagents retain host permission behavior and consume additional
tokens. The plugin never injects permission- or sandbox-bypass flags.

## Execution modes

`lightweight` is the default for bounded work that fits one session. It uses
native agents and creates no managed-run directory.

`managed` is selected explicitly or for cross-session, multi-wave,
evidence-heavy, or human-gated work. It requires an existing approved Trellis
task and uses this lifecycle:

```text
Manager -> Executor wave -> independent Auditor wave -> merge/rework/gate
```

The bundled supervisor now owns this loop. `expert_team_run` launches a fresh
Codex or Claude CLI process for each role episode, streams normalized events,
enforces timeouts/cancellation, and pauses at durable human gates. The lower-level
`next`/`submit_result`/`submit_audit` tools are recovery/integration primitives,
not the normal interaction path.

Executor output is unverified until a different Auditor accepts real evidence.
Completion additionally requires all required items accepted and the human
completion gate approved.

## Safe parallel writes

Research, diagnosis, review, and QA are read-only by default. Implementation
agents may write concurrently only when the lead assigns explicit, disjoint
files or modules. Overlapping and cross-cutting changes are sequenced, and the
lead owns integration and final verification.

The workflow chooses the lightest useful shape and does not invent a team for a
single-specialist task. A repeated failed gate is limited to two repair and
verification rounds before it is reported as blocked.

## Project-specific roles

Add Markdown definitions under `.expert-team/roles/` to override or extend the
default catalog. See
`skills/expert-team/references/expert-catalog.md` for the format. The plugin
never creates these files automatically.

## Bundled agent catalog

The complete catalog is indexed in
`skills/expert-team/references/agent-registry.md`. Every specialist has a
separate profile containing purpose, responsibilities, exclusions, evidence,
and handoff rules. Software, product, and design coordinator profiles are
applied by the current lead rather than spawned as nested team leads.

## Managed persistence

Managed state is stored under:

```text
.trellis/tasks/<task>/runs/<run-id>/
```

It includes an immutable initial state, atomic current snapshot, append-only
events, audits, work-item attempts, human decisions, and a final report slot.
Bulky host trajectories are separated under
`.trellis/workspace/<developer>/traces/<run-id>/`. Event replay is authoritative
and repairs a stale snapshot after an interrupted write.

Managed defaults can be customized by copying
`examples/expert-team-config.toml` to `.expert-team/config.toml`. Configuration
supports global and per-role host/model/timeouts/context budgets. Authentication
continues to come from Codex/Claude's active environment; persisted configuration
rejects keys, tokens, passwords, and secrets.

Probe both installed host runtimes without starting a model episode:

```powershell
python scripts/expert_team_run.py --probe
```

## Trellis

The managed runtime writes only inside an approved task's `runs/` directory and
never changes Trellis task status, phase, approval, or archive state. Without
Trellis, lightweight mode remains available.

## Validate

```powershell
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
python "$codexHome/skills/.system/plugin-creator/scripts/validate_plugin.py" .
python "$codexHome/skills/.system/skill-creator/scripts/quick_validate.py" skills/expert-team
python -m unittest discover -s tests -p "test_*.py"
python scripts/validate_contract.py tests/fixtures
python scripts/render_claude_agents.py --check
python -m mypy runtime scripts tests
claude plugin validate . --strict
```

## Installation and distribution

Validate the repository first. Then add it to a personal or team marketplace
using the Codex plugin workflow appropriate to the intended audience. This
repository intentionally does not modify a marketplace automatically.

To remove the plugin, uninstall or remove the plugin source. Optional
`.expert-team/runs/` files are user-owned audit artifacts and are not deleted
automatically.

## Qoder-to-Codex mapping

| Qoder Experts behavior | Codex implementation |
|---|---|
| Lead plus specialist experts | Lead Codex thread plus native subagents |
| Parallel expert work | Native Codex subagent concurrency |
| Expert task list and status | Lead task ledger plus `/agent` |
| Built-in experts | Bundled portable role catalog |
| Custom subagents | Project role overrides |
| Expert synchronization | Native wait/result collection |
| Experts Canvas | Out of scope; native threads remain inspectable |

The managed lifecycle is being developed from portable concepts in the MIT-licensed
[LongHorizon-Harness](https://github.com/AMAP-ML/LongHorizon-Harness): separated
Manager/Executor/Auditor roles, independently verified progress, bounded rounds,
resume, and human gates. The current implementation includes durable state, MCP
control, real CLI episode runners, the continuous supervisor, and protected
Auditor execution. Deterministic fake-process/fake-backend integration passes;
model-backed cross-host E2E validation is still tracked by the active Trellis
task and must not be treated as complete.
Upstream privileged launcher defaults and bypass flags are deliberately not used.

The routing and safety guidance also incorporates portable lessons from the
MIT-licensed [ExpertTeam-Codex](https://github.com/ReJeCtAll/ExpertTeam-Codex)
project. Its domain routing and bounded quality loops were adapted to current
Codex-native subagents; its direct `~/.codex` installer, older agent/command
formats, and team-runtime assumptions were not copied.

## License

MIT. See `LICENSE`.
