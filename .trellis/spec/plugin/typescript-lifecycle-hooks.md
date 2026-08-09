# TypeScript Lifecycle, Hooks, and MCP

## 1. Scope / Trigger

Apply this specification when changing `src/lifecycle/`, `src/hooks/`,
`src/templates/`, `src/mcp/`, lifecycle CLI commands, or project takeover
templates. These layers authorize project writes, so a host event or process
working directory is never sufficient proof by itself.

## 2. Signatures

```text
mta task create|start|current|finish|archive
mta hook dispatch --host <codex|claude>
mta legacy status|detach [--yes]
mta mcp serve --project <canonical-root> [--session <id>]
mta run start|status|resume|cancel <run-id>

dispatchHook(TaskRepository, HookEnvelope) -> Promise<HookDecision>
gateToolUse(TaskRepository, sessionId, ToolIntent, evidence) -> Promise<GateDecision>
BoundRunService.open(project, sessionId?) -> Promise<BoundRunService>
readControlStatus(project, sessionId?) -> Promise<ControlStatus>
```

## 3. Contracts

- A session pointer binds schema version 1, a safe session ID, canonical Git
  root, Trellis task path, host, and timestamp. Every read revalidates the root
  and task path.
- Hook workspace roots are canonicalized with filesystem `realpath` before
  comparison. macOS `/var` versus `/private/var` and Windows short versus long
  path aliases must resolve to the same trusted project without weakening the
  workspace boundary.
- Managed writes require all three proofs: a trusted pre-action Hook, an active
  `in_progress` task, and a valid drift-free apply receipt. Post-action events
  cannot create that proof.
- Codex and Claude native Hook JSON is normalized before policy evaluation.
  Host-specific output rendering is the only place that differs: Claude may
  return `ask` from `PreToolUse`; Codex must deny because its current
  `PreToolUse` contract does not support `ask`.
- Codex apply templates set `additionalContextLimit` only on events that can
  emit model-visible `additionalContext`: SessionStart, UserPromptSubmit,
  PreToolUse, PostToolUse, and SubagentStart. Events such as PreCompact,
  PostCompact, SubagentStop, Stop, PermissionRequest, and SessionEnd must omit
  the field so Codex starts without ignored-configuration warnings.
- Apply templates merge MTA Hook/MCP fields and marker blocks onto the original
  files. The receipt records original bytes and applied hashes. Unapply restores
  only unchanged owned files.
- Claude command Hooks and project MCP launch the package entry point through
  the current absolute Node executable and `bin/mta.js`. They never rely on an
  npm `.cmd` shim, which direct-spawn configurations cannot execute on Windows.
- Status reports installed, trusted, and enforced separately. Executed Hook
  evidence proves trust; only an enforced `PreToolUse` event proves write
  enforcement.
- CLI status extends the lightweight ownership status with the same real
  Node/npm/Git/host/MCP probes as doctor and an explicit Trellis binding
  projection. PreToolUse and TUI continue using the lightweight local status so
  policy evaluation never launches diagnostic subprocesses.
- PreCompact and PostCompact atomically persist only session ID, task ID/status,
  task path, trigger, and timestamp. Transcript paths, compact summaries, raw
  messages, and secrets never enter the recovery record; SessionStart injects
  the bounded record and SessionEnd removes it.
- PostToolUse records only bounded tool name, tool-use ID, response presence,
  and optional duration; raw tool input/output never enters lifecycle evidence.
  SubagentStart/Stop records the official agent ID/type and permission/stop
  metadata without transcript paths or final messages. SubagentStart injects
  the active Trellis binding, while managed role, work item, ownership, and
  audit identity remain authoritative in the Episode contract.
- A Stop event for an active task returns `decision: "block"` once. When the
  host reports `stop_hook_active=true`, MTA returns `continue:false` with a
  human-input reason instead of creating a continuation loop. Stop never starts
  a model Episode itself.
- MCP receives an explicit project root from the applied configuration and
  resolves an explicit or unique `.mta/sessions` binding. An unbound MCP may
  initialize and list tools but cannot access run state.
- All 15 legacy `expert_team_*` MCP names remain discoverable during migration.
  `status` and `resume` read the TypeScript event store and never start a model.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Placeholder PRD/design/implement | Reject task start. |
| Pointer root or task path escapes the project | Reject as invalid binding. |
| Hook root does not exist or canonicalizes outside the bound project | Reject as a workspace mismatch. |
| Untrusted Hook, missing task, invalid receipt, or receipt drift | Deny managed write. |
| Destructive, permission, cancellation, or completion intent | Return a human gate; never auto-approve. |
| Codex human gate from `PreToolUse` | Render `deny` with the reason because Codex does not support `ask` there. |
| Active-task Stop with `stop_hook_active=false` | Return `decision: "block"` and one bounded verification prompt. |
| Active-task Stop with `stop_hook_active=true` | Return `continue:false`; surface the human gate and do not continue again. |
| PreCompact/PostCompact payload contains transcript or model summary | Ignore those fields and persist only the bounded recovery schema. |
| PostToolUse or subagent payload omits its official identity fields | Reject the malformed normalized event; never persist raw response or transcript data as a fallback. |
| Shared config changed after apply | Refuse apply/unapply and preserve current bytes. |
| Legacy detach partial write failure | Restore every earlier shared config and omit the receipt. |
| MCP has zero or multiple active bindings | Return `workspace_unbound`; never fall back to cwd. |
| Status/resume query | Read and replay state only; do not construct a HostAdapter. |

## 5. Good / Base / Bad Cases

- Good: a trusted Codex `PreToolUse` event, active task, and unchanged receipt
  permit a managed write and record bounded decision evidence.
- Base: MCP initialize and tools/list succeed without a project binding.
- Bad: treating project Hook installation as proof that the user trusted it.
- Bad: using `process.cwd()` as the project for an installed plugin MCP.
- Bad: appending another MTA Hook on every idempotent apply.

## 6. Tests Required

- Task lifecycle tests cover placeholders, state transitions, path escape,
  cross-workspace pointers, archive, and per-session release.
- Hook tests cover all lifecycle events, host rendering, redaction, receipt
  enforcement, destructive gates, installed/trusted/enforced status, bounded
  Stop continuation, compact context persistence/cleanup, bounded tool outcome
  metadata, subagent identity binding without transcript leakage, and equivalent
  macOS/Windows path aliases at the canonical workspace boundary.
- Apply tests cover JSON merging, the complete Codex additional-context event
  capability matrix, marker insertion, host switching, exact
  restoration, drift, concurrent changes, rollback, absolute MCP binding, and
  direct execution of the installed Claude Hook and project MCP commands.
- Legacy tests inject partial failure and assert byte-for-byte rollback.
- MCP tests assert all tool names, explicit/unique binding, shared status and
  resume projections, and unbound failure.
- Windows and POSIX Node 22/24 run typecheck, lint, tests, pack inspection, and an
  isolated no-Python/no-Cargo install smoke.

## 7. Wrong vs Correct

### Wrong

```typescript
const service = await BoundRunService.open(process.cwd());
return { installed: true, enforced: true };
```

### Correct

```typescript
const service = await BoundRunService.open(explicitProjectRoot, sessionId);
const status = await readProjectStatus(explicitProjectRoot);
if (!status.ownershipValid) return denyManagedWrite();
```
