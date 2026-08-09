# Release Verification and TUI

## 1. Scope / Trigger

Apply this specification when changing `src/tui/`, update/doctor commands,
package smoke scripts, CI, release evidence, user docs, plugin manifests, or
the final legacy-runtime cutover.

## 2. Signatures

```text
mta                           # TUI only when stdin/stdout are TTY
mta check-update [--json]
mta update [--version <exact>] [--yes] [--json]
mta run answer <run-id> --decision <HumanDecision JSON>
readTuiSnapshot(project, sessionId?, runId?, updateOptions?) -> TuiSnapshot
probeMcpInitialize(timeoutMs?) -> CommandProbe
node scripts/npm-install-smoke.mjs
```

## 3. Contracts

- TUI rendering owns no durable state. Project status comes from
  `readProjectStatus`; run state comes from `BoundRunService`; foreground calls
  `runForeground`. Non-TTY `mta` prints help and never waits for input.
- TUI startup update checks time out and use the 24-hour successful cache.
  Offline status does not make the TUI unusable or mutate project state.
- Doctor executes package MCP initialize, not just a path check. Node, npm,
  Git, project root, and MCP are required; Codex/Claude remain optional host
  capability probes.
- The install smoke packs the real whitelist, installs to an isolated prefix,
  sets its isolated npm cache before the first `npm pack` invocation, proves
  `python`, `python3`, `py`, `cargo`, and `rustc` cannot resolve, then
  checks both bins, npm exec/npx semantics, apply, status, hook, MCP initialize,
  and unapply.
- CI covers Windows x64, Ubuntu x64, macOS Intel, macOS arm64 and Node 22/24.
  Every matrix cell runs the same install smoke.
- A cutover report separates fixture/fake, local real-host, remote CI, and
  stable model evidence. Legacy source deletion is forbidden while any required
  gate is false.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| `mta` has no TTY | Print help and exit successfully. |
| TUI update check is offline or times out | Show unavailable and continue. |
| `run answer` JSON is invalid or lacks attributable provenance | Reject at the shared HumanDecision/repository boundary. |
| MCP initialize response is missing or malformed | Doctor reports unhealthy. |
| Tarball has source `.ts`, runtime `.py`, tests, or an unknown top-level file | Fail smoke before install. `.d.ts` declarations are allowed. |
| Python/Cargo resolves in clean smoke PATH | Fail smoke. |
| A host npm cache path crosses into WSL or another OS boundary | Ignore the host cache and use the smoke temporary directory from the first npm command. |
| Registry returns E404 | Record not-found/no-access; do not infer publish ownership or publish automatically. |
| Any real Claude/Codex managed E2E or remote matrix gate is false | Preserve legacy runtime and report the blocker. |

## 5. Good / Base / Bad Cases

- Good: TUI reads the same accepted evidence as MCP/CLI, while its offline
  update hint fails independently.
- Base: non-TTY automation invokes `mta` and gets deterministic help.
- Bad: mark stable because fake Claude emitted the expected JSON.
- Bad: delete `runtime/` after Codex succeeds while Claude authentication is
  unavailable.

## 6. Tests Required

- TUI shared-state and offline startup tests; CLI non-TTY test.
- `run answer` with verified provenance and invalid-decision rejection.
- Real MCP initialize doctor probe.
- Windows and POSIX tarball smoke with excluded Python/Rust commands.
- CI syntax/matrix review against current official checkout/setup-node major
  releases.
- Cutover report must name each false gate and may not be overridden by a fake
  result.

## 7. Wrong vs Correct

### Wrong

```typescript
const state = tuiStore.load();
if (fakeClaudePassed) rmSync("runtime", { recursive:true });
```

### Correct

```typescript
const state = await BoundRunService.open(project, session).then((service) => service.resume(runId));
if (!Object.values(cutoverReport.cutoverGates).every(Boolean)) preserveLegacyRuntime();
```
