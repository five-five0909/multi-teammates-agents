# Implementation progress

## 2026-08-08 — implementation started

- User approved the PRD/design/implement artifacts; `task.py start` moved this
  child task to `in_progress`.
- Expert Team qualification was recorded as `managed` with
  `main-session-sequential`; the current host tool table still lacks
  `expert_team_prepare`, so this session is explicitly audited as a stale
  sequential fallback rather than claiming a prepare call ran.
- W1–W3 implemented: policy-floor routing, atomic entry-gate records,
  attributable mode selection, strict graph qualification, workspace-bound
  receipts, idempotent start, human decision provenance, MCP select/qualify /
  compliance tools, and CLI no-action protection.
- W4 implemented as a host-neutral hook script plus the repository Codex hook
  configuration. Plugin manifests intentionally do not declare the currently
  unsupported `hooks` field; the response reports `advisory`/`partial` when a
  host cannot provide a trusted hook boundary.
- The gate now exposes explicit two-option selection metadata, binds verified
  user selection to the prepare source event, validates canonical mode and
  qualification receipts, records `run_started`, and permits only Trellis
  planning/read-only commands before qualification.
- W7 docs/spec/version updates are in progress. Codex and Claude base version
  is `0.4.0`; Codex cachebuster is `0.4.0+codex.20260808151000`, refreshed
  through the plugin-creator helper.

## Verification evidence so far

- `python -m unittest discover -s tests -q` — 101 tests passed.
- `mypy runtime scripts tests` — no issues.
- `python -m compileall -q hooks runtime scripts` — passed.
- `python scripts/validate_contract.py tests/fixtures` — all fixtures passed.
- `python scripts/render_claude_agents.py --check` — 20 generated agents match.
- `git diff --check` — passed.

## Outstanding

- Installed-cache smoke must run in a fresh host session because this session's
  MCP snapshot predates `expert_team_prepare`.
- The checkout MCP smoke (prepare → qualify → start → compliance) passes in a
  temporary trusted workspace; the installed cache remains stale and is not
  claimed as updated.
- Run the final Trellis check/spec review, clean generated local gate files,
  and prepare an ownership-scoped commit; unrelated pre-existing dirty files
  remain uncommitted.
