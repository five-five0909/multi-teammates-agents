# Expert Team Version and npm Update Gate

## 1. Scope / Trigger

Apply this specification to package version reporting, npm registry checks,
TUI update hints, and self-update. A host session can retain an old MCP tool
list after installation, so an update never implies that the current session
hot-reloaded it.

## 2. Signatures

```text
expert_team_version() -> { package_version, runtime, schema_version }
mta check-update [--json]
mta update [--version <exact>] [--yes] [--json]
checkForUpdate({ useCache, timeoutMs, cachePath? }) -> UpdateCheck
updatePackage({ targetVersion?, commit }) -> UpdateResult
```

## 3. Contracts

- `package.json` / `src/version.ts` is the package version source. MCP version,
  both bin aliases, npm metadata, and user documentation must match it.
- The registry route uses the first prerelease identifier from the running exact
  version (`alpha`, `beta`, `rc`, and equivalent valid tags); stable versions
  use `latest`. `UpdateCheck.distTag`, the TUI, and the 24-hour cache expose and
  bind that channel. Registry input must contain a valid exact semantic
  `version`; ranges, malformed prereleases, and arbitrary commands are rejected.
- Explicit `check-update` and `update` may access npm. TUI startup uses a
  bounded check and a successful-result cache with a 24-hour TTL. Other
  non-interactive commands do not access the network.
- The registry timeout remains referenced until the request settles. Calling
  `unref()` on that timer can let Node 22 end the event loop with the update
  Promise still pending instead of delivering the required abort result.
- Update uses the official npm registry, a frozen absolute isolated-cache path,
  and one exact
  `package@version` with `npm install --global --ignore-scripts`. Self-update is
  allowed only when the current package is the canonical global npm install;
  npx and unknown sources receive the exact manual command without mutation.
- After install, the global `bin/mta.js --version` health check must report the
  target version. Failure attempts the currently running exact version and
  reports update and rollback outcomes separately.
- Updating does not guess-delete host cache directories. The user re-applies
  project integration when needed and opens a fresh Codex/Claude session.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Cache younger than 24 hours | TUI may use it without network. |
| Cache was written for another dist-tag | Ignore and perform a bounded check. |
| Cache expired, corrupt, or from another package | Ignore and perform a bounded check. |
| Offline, timeout, non-2xx, or malformed registry JSON | Report unavailable; TUI remains usable. |
| Registry fetch never settles on Node 22 or 24 | The referenced timer aborts it and the command resolves with an error; it must not exit with a pending Promise. |
| Update without `--yes` | Return an exact preview and make no install call. |
| Current source is npx or unknown | Show the exact command and refuse self-update. |
| Target equals current | Return no-op; do not reinstall. |
| Target install fails, rollback succeeds | Return update failure plus `rollbackSucceeded=true`. |
| Target and rollback both fail | Return both errors and a nonzero CLI result. |

## 5. Good / Base / Bad Cases

- Good: preview `0.6.0`, confirm, install exact `0.6.0` with scripts disabled,
  then open a new host session.
- Base: registry reports the current version and update is a no-op.
- Bad: run `npm install -g package@latest` or concatenate an unchecked version
  into a shell command.

## 6. Tests Required

- Semver stable/prerelease ordering and malformed exact versions.
- Fresh/valid/expired/corrupt cache, offline, timeout, non-2xx, and malformed
  registry response, including the stalled-fetch abort on Node 22 and 24.
- Installation-source detection, preview, no-op, success, rollback success, and rollback failure with an
  injected installer; tests never modify the developer's global npm prefix.
- MCP version and both bin aliases report the package version.

## 7. Wrong vs Correct

### Wrong

```typescript
spawn(`npm install -g ${name}@${userVersion}`, { shell:true });
```

### Correct

```typescript
spawn(resolved.executable, [...resolved.prefixArgs, "install", "--global",
  "--ignore-scripts", `${PACKAGE_NAME}@${exactVersion}`], { shell:false });
```
