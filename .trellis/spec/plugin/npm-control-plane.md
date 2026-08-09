# npm Control Plane

## 1. Scope / Trigger

Apply this specification when changing the npm manifest, `bin/mta.js`, `src/cli`, `src/control`, `src/platform`, `.mta/apply-receipt.json`, or project apply/unapply behavior. The TypeScript npm product starts at `0.5.0-alpha.0`; the Python `0.4.1` runtime remains a migration oracle until the parent cutover gate is satisfied.

## 2. Signatures

```text
mta [--help|--version]
mta status [--project <path>] [--json]
mta doctor [--project <path>] [--json]
mta apply [--project <path>] [--codex] [--claude] [--yes] [--json]
mta unapply [--project <path>] [--yes] [--json]

planApply(startPath, hosts) -> ApplyPlan
commitApply(plan) -> ApplyReceipt
unapplyProject(startPath, commit) -> UnapplyResult
resolveCommand(command) -> { executable, prefixArgs }
```

Without `--yes`, apply and unapply are previews. Both npm bin names, `mta` and `multi-teammates-agents`, resolve to the same entry.

## 3. Contracts

- Runtime: ESM-only Node.js `>=22`; production code has no Python, Rust, Cargo, postinstall, or shell requirement.
- During migration, the existing `scripts/*.js` bridges remain CommonJS behind `scripts/package.json`; remove that scoped compatibility marker together with the old bridges at cutover.
- `ApplyPlan.schemaVersion=1` binds a UUID transaction, package version, canonical Git root, normalized hosts and changes.
- Every change binds `relativePath`, action, before/after SHA-256, exact content, and the original base64 value when restoration is allowed.
- `ApplyReceipt.schemaVersion=1` binds the committed transaction, root, hosts, timestamp, and owned-file after hashes.
- `.mta/runtime.json` is fully owned only when the receipt proves ownership. Unknown pre-existing files are conflicts, not overwrite candidates.
- The npm package carries the canonical `skills/expert-team/` and generated `agents/` assets plus both plugin manifests. Project apply copies the same skill tree to `.agents/skills/expert-team/` for Codex and `.claude/skills/expert-team/` for Claude, and copies generated Claude profiles to `.claude/agents/`; every copied file participates in the same receipt transaction and drift checks.
- `status.integrations.<host>.installed` requires both that host's hook/settings entry and its receipt-owned `expert-team/SKILL.md`; a pre-asset receipt must not be reported as a complete host installation.
- The package version and Node engine range are read from `package.json`; code must not duplicate them as constants.
- Windows PATH resolution prefers executable/shim suffixes explicitly. Supported npm `.cmd` shims are converted to a direct executable or `node + JS entry`; subprocesses keep `shell:false`.
- The npm tarball whitelist is controlled by `package.json.files`; only executable output, public schemas, canonical skill/agent assets, plugin metadata, and release documents enter it. `temp/`, source tests, caches and Python runtime files must not enter the artifact.
- npm `bin` targets use canonical package-relative paths such as `bin/mta.js` without a leading `./`; npm 11 publish normalization must not rewrite the manifest or emit an auto-correction warning.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Start path has no Git ancestor | Reject with `no Git project found`; do not write. |
| Apply target is filesystem root or user HOME | Reject before planning. |
| Target changed after plan | Reject with `changed after planning`; preserve current bytes. |
| Owned file hash differs from receipt | Reject apply/unapply and report drift; preserve user changes. |
| Owned path escapes canonical project root | Reject the receipt/plan. |
| Legacy Python Expert Team hook/MCP entry exists | Reject apply and require explicit future `legacy detach --yes`; never delete implicitly. |
| Transaction fails after any write | Restore earlier bytes or remove newly created owned files; do not write a success receipt. |
| Receipt is absent or invalid | Unapply refuses to guess ownership. |
| Windows command is an unsupported `.cmd`/`.bat` shim | Report unavailable; never fall back to `shell:true`. |
| Node/npm/Git probe fails | `doctor.healthy=false`; Codex/Claude absence is reported but is not a core toolchain failure. |
| Root ESM mode reinterprets an old `scripts/*.js` bridge | Keep the migration-only `scripts/package.json` CommonJS boundary until that bridge is removed. |

## 5. Good / Base / Bad Cases

- Good: dry-run freezes hashes, commit rechecks them, writes an adjacent temporary file, renames it, and writes the receipt last.
- Good: a second identical apply is `unchanged`; changing host selection is an owned update.
- Good: npm tarball, Codex project skill, Claude project skill, and Claude agents all derive from the same packaged skill registry; unapply removes or restores them through the receipt.
- Base: status reads a project with no receipt and returns `applied=false` without creating `.mta`.
- Bad: unapply sees a changed runtime file and deletes it because the path appears in an old receipt.
- Bad: doctor launches `npm.cmd` with `shell:true` or treats PATH presence as proof without executing `--version`.

## 6. Tests Required

- CLI tests assert help/version, both bin aliases, JSON errors and nested Unicode project paths.
- Root tests assert Git discovery, HOME/filesystem-root rejection and space/Unicode paths.
- Transaction tests assert dry-run zero writes, idempotency, owned updates, pre-commit drift rejection, injected rollback and receipt-last behavior.
- Unapply tests assert preview, successful removal/restoration, missing receipt refusal and drift preservation.
- Legacy tests assert Python hook/MCP conflicts remain untouched.
- Windows tests assert `.cmd` shim resolution produces `shell:false` executable/prefix arguments and real doctor probes succeed.
- Packaging tests assert build/typecheck/lint/test, tarball whitelist, canonical skill/agent and dual-manifest assets, isolated install, both bin aliases, dual-host project discovery paths, and execution with Python/Cargo absent from PATH.
- CI runs Windows x64, Ubuntu x64, macOS x64 and macOS arm64 on Node 22 and 24.

## 7. Wrong vs Correct

### Wrong

```typescript
spawn("npm", ["--version"], { shell: true });
rmSync(target, { force: true }); // path happened to be in a stale receipt
```

### Correct

```typescript
const resolved = await resolveCommand("npm");
spawn(resolved.executable, [...resolved.prefixArgs, "--version"], { shell: false });

if (sha256(current) !== receiptFile.appliedHash) {
  throw new ApplyConflictError("owned file drifted; preserving user changes");
}
```
