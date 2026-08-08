# Expert Team Version Gate

## 1. Scope / Trigger

The version gate runs before `expert_team_prepare` creates an entry record. It
protects the cross-host boundary when the plugin, hook, or MCP tool list was
updated but the Codex/Claude host still has an older session or cache.

## 2. Signatures

- MCP: `expert_team_version(host_package_version?, host_entry_contract_version?, host_hook_schema_version?, host_toolset_fingerprint?)`.
- Service: `ExpertTeamService.version(...) -> VersionReport`.
- CLI: `python scripts/expert_team_upgrade.py [--upgrade]`.
- Entry: `ExpertTeamService.prepare(..., host_*_version/fingerprint?)` must reject
  a supplied incompatible report before writing a gate.

## 3. Contracts

The expected release is exported by `runtime.versioning`:

| Field | Current value | Rule |
| --- | --- | --- |
| `package_version` | `0.4.1` | Host `+codex.<cachebuster>` metadata is ignored for compatibility. |
| `entry_contract_version` | `2` | Exact integer match. |
| `hook_schema_version` | `1` | Exact integer match. |
| `toolset_fingerprint` | SHA-256 of `TOOLSET_VERSIONS` | Exact match; adding a tool changes it. |

The report contains `status`, `compatible`, `upgrade_required`, `expected`,
`host`, `checks`, `mismatches`, `upgrade_commands`, and `next_action`. No raw
user prompt is included. The recommended commands are:

```powershell
codex plugin marketplace upgrade multi-teammates-agents
codex plugin add multi-teammates-agents@multi-teammates-agents
```

After installation the host must be closed and reopened; an existing host
thread does not hot-load an MCP tool list.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| No host version fields supplied | `expert_team_version.status=host_version_not_provided`; prepare remains backward-compatible. |
| All supplied fields match | `compatible=true`; prepare continues. |
| Package base version differs or is malformed | `ContractError` beginning `stale_session`, with `upgrade_required=true`. |
| Entry or hook schema differs | Same actionable `stale_session` response. |
| Toolset fingerprint differs | Same response; host must refresh the tool list. |
| Upgrade command warns/fails | CLI prints each return code, verifies the installed base version when possible, and never deletes cache entries; caller retries after fixing the CLI if verification is false. |

## 5. Good/Base/Bad Cases

- Good: host reports `0.4.1+codex.20260809100000`, `2`, `1`, and the current
  fingerprint; the build metadata is accepted and prepare proceeds.
- Base: host omits metadata; `expert_team_version` asks the host to report it,
  while prepare keeps the existing trusted-workspace behavior.
- Bad: host reports `0.4.0` or an old toolset; prepare fails before gate storage
  and tells the user to upgrade and restart the host.

## 6. Tests Required

- Unit: normalize a Codex cachebuster to its base version and reject malformed or
  older versions.
- Service: assert compatible cachebuster, report fields, and actionable stale
  error text including both upgrade commands.
- MCP: assert `expert_team_version` is available without a workspace and appears
  in `tools/list`.
- Contract: assert manifest base versions match `runtime.versioning.PACKAGE_VERSION`.
- CLI: assert `--check` is deterministic and does not invoke or delete caches.

## 7. Wrong vs Correct

### Wrong

```text
if host_package_version != PACKAGE_VERSION:
    raise "version mismatch"
```

This rejects valid Codex cache metadata and gives no recovery path.

### Correct

```text
report = compare_versions(host_metadata)
if not report.compatible:
    raise stale_session_message(report)
```

The same structured comparison powers the diagnostic MCP tool, prepare gate,
and upgrade instructions, so a stale host cannot silently enter a run.
