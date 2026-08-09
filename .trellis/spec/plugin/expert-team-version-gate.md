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
  both bin aliases, plugin manifests, and user documentation must match it.
- Registry input must contain a valid exact semantic `version`; dist-tags,
  ranges, malformed prereleases, and arbitrary commands are rejected.
- Explicit `check-update` and `update` may access npm. TUI startup uses a
  bounded check and a successful-result cache with a 24-hour TTL. Other
  non-interactive commands do not access the network.
- Update uses `npm install --global --ignore-scripts` with one exact
  `package@version`. A failed target install attempts the currently running
  exact version and reports update and rollback outcomes separately.
- Updating does not mutate or delete host cache directories. The user opens a
  fresh Codex/Claude session to load a new MCP tool list.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Cache younger than 24 hours | TUI may use it without network. |
| Cache expired, corrupt, or from another package | Ignore and perform a bounded check. |
| Offline, timeout, non-2xx, or malformed registry JSON | Report unavailable; TUI remains usable. |
| Update without `--yes` | Return an exact preview and make no install call. |
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
  registry response.
- Preview, no-op, success, rollback success, and rollback failure with an
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
