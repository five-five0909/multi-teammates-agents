# TypeScript Host Adapters and Foreground Execution

## 1. Scope / Trigger

Apply this specification when changing `src/runtime/host/`,
`src/runtime/foreground.ts`, `ManagedRunSupervisor` role permissions, or the
CLI/MCP foreground entry. These layers start real Codex and Claude processes;
they must preserve host permission controls and durable run state.

## 2. Signatures

```text
ProcessRunner.run(ProcessRunRequest, signal?) -> Promise<ProcessRunResult>
HostAdapter.runEpisode(EpisodeRequest, signal?) -> Promise<EpisodeResult>
HostAdapter.cancel(episodeId) -> Promise<{ found, terminated }>
decodeForegroundConfig(input, workspace, defaults?) -> RuntimeConfig
runForeground(BoundRunService, runId, config?, options?) -> Promise<SupervisorOutcome>
mta run foreground <run-id> [--host codex|claude] [--model <name>] [--config <json>]
expert_team_run({ task_id, run_id, config? }) -> SupervisorOutcome
```

## 3. Contracts

- Resolve `codex` and `claude` through `resolveCommand`; npm `.cmd` shims may
  become a direct `node script.js` invocation. Every production spawn uses
  `shell:false`, bounded stdout/stderr, prompt stdin, and an explicit cwd.
- Codex uses `exec --json --sandbox read-only|workspace-write`; Claude uses
  `--print --output-format stream-json --verbose --permission-mode
  plan|acceptEdits`. Never add bypass, auto-approval, hook-trust bypass, or
  danger-full-access arguments.
- Manager and Auditor are read-only. Only Executor may select the writable host
  mode, and Auditor requests with `readOnly=false` fail before spawn.
- One Episode means one fresh process. stdout JSONL enters through
  `normalizeHostOutput`; other layers consume only `EpisodeResult` and
  validated `BackendEvent` objects.
- Timeout, AbortSignal, and `cancel()` share one episode registry. POSIX uses a
  detached process group; Windows terminates by PID tree. A cleanup timeout is
  an explicit `cleanup_error`, never an implicit success.
- `status` and `resume` only replay the store. Only CLI `run foreground` and MCP
  `expert_team_run` construct adapters and start the Supervisor.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Command missing or unsupported Windows batch shim | Fail before Episode spawn with the resolution error. |
| Unknown foreground config field or invalid role binding | Reject at the strict Zod boundary. |
| Explicit host permission error | Return `permission_required`; do not infer it from ordinary assistant prose. |
| Timeout wins termination race | Kill the process tree, await close, return `timeout`. |
| AbortSignal or explicit cancel wins | Kill the process tree, await close, return `cancelled`. |
| Tree is still alive after forced termination | Record `cleanup_error` and `terminated:false`. |
| Host exits nonzero without permission evidence | Return `error` with bounded stderr or structured result text. |
| Host emits more than the visible output budget | Keep bounded raw data and truncate visible output deterministically. |

## 5. Good / Base / Bad Cases

- Good: Codex Manager plans read-only, Claude Executor works in
  `acceptEdits`, and a fresh Codex Auditor verifies read-only.
- Base: a default foreground config binds all roles to Codex while preserving
  explicit host-controlled permissions.
- Bad: parsing colored terminal prose to guess completion or permission state.
- Bad: putting the prompt in argv, using `shell:true`, or adding a bypass flag
  to make unattended tests pass.

## 6. Tests Required

- Fake executable tests must cover split JSONL chunks, non-JSON noise,
  permission records, ordinary permission-like prose, nonzero exit, bounded
  output, timeout, AbortSignal, explicit cancel, parallel Episodes, and child
  process-tree cleanup.
- Foreground integration must use real child processes for Manager, Executor,
  and independent Auditor, then assert accepted audit evidence in `mta-runs`.
- CLI and MCP must prove one foreground route while status/resume remain
  adapter-free.
- Run Windows and POSIX Node 24 checks. Windows shim coverage may skip only on
  non-Windows. A real read-only smoke must report authentication failures as
  unavailable, not passed.

## 7. Wrong vs Correct

### Wrong

```typescript
spawn("codex exec --dangerously-bypass-approvals-and-sandbox", { shell:true });
```

### Correct

```typescript
spawn(resolved.executable, [...resolved.prefixArgs, "exec", "--json",
  "--sandbox", request.readOnly ? "read-only" : "workspace-write", "-"], {
  cwd:request.workspace,
  shell:false,
});
```
