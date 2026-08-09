# Multi Teammates Agents

Multi Teammates Agents (MTA) is a project-scoped AI harness for Codex CLI and
Claude Code. It combines Trellis task lifecycle controls with a durable
Manager → Executor → Auditor runtime, independent audit, resumable JSONL state,
and human gates.

The npm product is currently `0.5.0-alpha.0`. Alpha means the TypeScript
contracts, control plane, fake-host runtime, and local packaging gates are in
place; it is not a claim that the stable, model-driven acceptance matrix has
passed.

## Requirements

- Node.js 22 or 24
- Git
- Codex CLI and/or Claude Code, authenticated by the host itself

The npm runtime does not require Python, Rust, Cargo, or install lifecycle
scripts.

## Install

```bash
npm install --global --ignore-scripts multi-teammates-agents@0.5.0-alpha.0
mta --version
multi-teammates-agents --version
```

The public registry did not yet return this package during the recorded alpha
verification. Until a separately authorized publish occurs, build a local
tarball with `npm pack` and install that exact `.tgz` path instead of claiming
the registry command already succeeds.

One-time use is also supported:

```bash
npx --yes --package multi-teammates-agents@0.5.0-alpha.0 -- mta --help
```

## Project takeover

Run commands inside a Git project. Mutating commands are previews until
`--yes` is present.

```bash
mta apply --codex --claude
mta apply --codex --claude --yes
mta status --json
mta doctor --json
mta unapply
mta unapply --yes
```

`apply` merges MTA-owned hook, MCP, and instruction fields and writes
`.mta/apply-receipt.json`. It rechecks every planned hash before commit and
rolls back a partial transaction. `unapply` restores only unchanged content
proved by that receipt; user drift is preserved and reported.

If an exact legacy Expert Team hook or MCP entry is present, apply fails closed.
Use `mta legacy status` and review `mta legacy detach`; only
`mta legacy detach --yes` removes those entry points. Existing Trellis tasks,
old runs, and evidence are never migrated or deleted by detach.

## Trellis tasks

```bash
mta task create "Implement feature" --slug implement-feature
mta task start implement-feature --session <session-id> --host codex
mta task current --session <session-id>
mta task finish --session <session-id>
mta task archive implement-feature --session <session-id>
```

Planning cannot execute. Complex tasks need reviewed `prd.md`, `design.md`, and
`implement.md` before `start` changes them to `in_progress`.

## Managed runs

New runs live under the active task's `mta-runs/` directory. Legacy `runs/`
directories remain untouched.

```bash
mta run start <run-id> --session <session-id> \
  --contract '<TaskContract JSON>' --workItems '<WorkItem[] JSON>'
mta run foreground <run-id> --session <session-id> --host codex
mta run status <run-id> --session <session-id> --json
mta run resume <run-id> --session <session-id> --json
mta run answer <run-id> --session <session-id> --decision '<HumanDecision JSON>'
mta run cancel <run-id> --session <session-id>
```

`foreground` is the only CLI operation that starts model Episodes. Manager and
Auditor use read-only host modes; Executor may use the host's normal writable
mode. MTA never adds approval, sandbox, or hook-trust bypass arguments.
`status` and `resume` only replay durable state.

Use `--config` for explicit per-role host/model/budget configuration:

```bash
mta run foreground run-1 --session session-1 --config '{
  "max_concurrency": 2,
  "human_completion_gate": true,
  "roles": {
    "manager":  {"host":"codex"},
    "executor": {"host":"claude"},
    "auditor":  {"host":"codex"}
  }
}'
```

## MCP and hooks

`mta apply` installs a project-bound MCP entry that runs:

```bash
mta mcp serve --project <absolute-project-root>
```

The server keeps the 15 `expert_team_*` tool names during migration. The main
managed path is `expert_team_start` → `expert_team_run` →
`expert_team_status`/`expert_team_resume` → `expert_team_answer` when gated.
CLI, MCP, and the TUI use the same task binding and runtime repository.

Codex and Claude hook payloads enter one dispatcher:

```bash
mta hook dispatch --host codex
mta hook dispatch --host claude
```

Installed hooks are not automatically trusted. `mta status` reports installed,
trusted, and enforced separately; managed writes require a trusted pre-action
hook, an active task, and an unchanged apply receipt.

## TUI and updates

Run `mta` in a terminal to open the control TUI. It can inspect project/run
state, explicitly start foreground execution, run doctor, and check updates.
Its startup update check is bounded and caches successful results for 24 hours;
offline failure never blocks use. Other commands do not access the network
except:

```bash
mta check-update
mta update --version <exact-version>
mta update --version <exact-version> --yes
```

Update installs an exact npm version with `--ignore-scripts`. If installation
fails, MTA attempts to restore the currently running exact version and reports
update and rollback failures separately.

## Development and verification

```bash
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test
npm run pack:check
npm run smoke:install
```

The install smoke builds a real tarball, installs it to an isolated prefix,
removes Python and Cargo from PATH, and verifies both bins, npx, apply, hook,
MCP initialize, status, and unapply. CI covers Windows x64, Ubuntu x64, macOS
Intel, and macOS arm64 on Node 22 and 24.

## Safety and release status

- Executor output is unverified until a separate Auditor accepts it with clean
  workspace integrity and aligned evidence.
- Permission, cancellation, blocked, budget, ask, and completion decisions are
  human gates.
- Raw host traces are bounded, redacted, and stored separately from accepted
  evidence.
- Stable release requires real Codex and Claude managed E2E plus the complete
  platform/install matrix. Fake-host evidence is never presented as model E2E.

License: MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for design
influences and dependency notices.
