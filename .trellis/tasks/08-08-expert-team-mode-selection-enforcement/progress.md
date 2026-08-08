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
- W7 docs/spec/version updates are in progress. The release gate now compares
  package, entry-contract, hook-schema, and toolset versions. Codex cachebuster
  metadata is normalized against base release `0.4.1`; a real mismatch returns
  `upgrade_required` plus executable Codex commands and requires a new host
  session.

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
- After pushing `db27926`, marketplace refresh installed
  `0.4.0+codex.20260808151000`; the installed-cache smoke now passes
  initialize/tools-list plus prepare → qualify → start → compliance with a
  trusted temporary workspace. `codex plugin add` printed a Windows backup
  access-denied warning, but `codex plugin list` and the cache path confirm the
  new version is enabled.
- The current conversation's host tool snapshot is still immutable; a fresh
  Codex/Claude thread is required to expose the new tool list and skill.
- The standalone `expert_team_version` MCP diagnostic and read-only
  `scripts/expert_team_upgrade.py --check` are covered by regression tests;
  `--upgrade` refreshes marketplace/install without deleting cache entries.
- After commit `049eba3`, `git push origin main` and the Codex marketplace
  refresh installed `0.4.1+codex.20260808161530`. Installed-cache smoke passed
  initialize (`0.4.1`), `tools/list` (`expert_team_version` present), compatible
  version report, and prepare → qualify → start. The CLI still printed the
  known Windows cache-backup access warning, but `codex plugin list` verified
  the new cache is enabled.
- Run the final Trellis check/spec review, clean generated local gate files,
  and prepare an ownership-scoped commit; unrelated pre-existing dirty files
  remain uncommitted.
