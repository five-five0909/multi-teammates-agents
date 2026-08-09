# npm control-plane baseline

Recorded on 2026-08-09 before the TypeScript migration began.

## Local sources

| Source | Commit | License | Used for |
|---|---|---|---|
| `temp/fastctx` | `86dac0c99efae7859ed2be468f68c16e58f5e16a` | Apache-2.0 | Design research for project takeover, update diagnostics, npm distribution and control-center behavior; no Rust implementation copied. |
| `temp/Trellis` | `60554aed8837fec805c1b14641694377131e646b` | AGPL-3.0-only | Interoperability research for `.trellis/tasks/`, CLI layout and atomic-write behavior; no AGPL implementation copied. |
| `temp/LongHorizon-Harness` | `254bc04ecebe844557a179319ac066083b0f5be0` | MIT | Later runtime research for Manager/Executor/Auditor boundaries; not consumed by this control-plane child. |

The TypeScript atomic writer was independently implemented from the approved invariant “same-directory temporary file, flush, rename, best-effort temporary cleanup”. It is not copied from Trellis source.

## Current project baseline

- Existing product release: Python/plugin `0.4.1` with 17 `expert_team_*` MCP tools in `runtime/server/mcp_stdio.py`.
- Existing schema directories: `schemas/v1` runtime contracts and `schemas/v2` entry/version contracts.
- Existing Python implementation remains available as a migration oracle; this child does not overwrite or delete it.
- Pre-existing uncommitted Python changes in `runtime/core/reducer.py`, `runtime/supervisor.py`, and `tests/test_supervisor.py` are preserved outside this child’s ownership.

## Registry and toolchain facts

- `npm view multi-teammates-agents` returned registry 404 on 2026-08-09; the public name appeared unoccupied. Publication must repeat this check.
- Local runtime: Node `24.18.0`, npm `11.16.0`.
- Registry-current tools inspected before installation: TypeScript `7.0.2`, ESLint `10.8.1`, `@eslint/js` `10.0.1`, `typescript-eslint` `8.66.0`, `@types/node` `26.2.0`.
- `typescript-eslint 8.66.0` declares TypeScript `<6.1.0`; therefore the compatible latest TypeScript `6.0.3` is pinned instead of forcing unsupported TypeScript 7.
- Production code currently uses only Node standard-library modules.

## Cross-platform runner evidence

The GitHub-maintained `actions/runner-images` table inspected on 2026-08-09 maps `macos-15-intel` to x64 and `macos-15` to arm64. The CI matrix uses those explicit labels plus `ubuntu-latest` and `windows-latest`, each on Node 22 and 24.

GitHub's releases API reported `actions/checkout v7.0.1` and `actions/setup-node v7.0.0`; the workflow follows their current `@v7` major channels rather than the obsolete v4 examples.

## Local verification evidence

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm test`: 13 tests pass.
- `npm run pack:check`: pass; tarball whitelist contains no `.py`, `temp/`, tests or caches.
- `mta doctor --json`: healthy on Windows; Node, npm, Git, Codex `0.147.0`, and Claude Code `2.1.220` were actually executed.
- Isolated tarball install: package entry and both npm bin aliases returned `0.5.0-alpha.0` with Python and Cargo absent from PATH.
- Full Python regression initially exposed that root ESM mode reclassified legacy `scripts/*.js` bridges. A scoped `scripts/package.json` keeps those old bridges CommonJS during migration; they are not shipped in the new npm tarball.
- WSL/POSIX verification used temporary `node@24.18.0` without changing the installed WSL Node 12: typecheck, lint and build passed; 12 portable tests passed and the one Windows-shim test skipped by platform contract.
