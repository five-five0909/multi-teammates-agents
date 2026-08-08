# Initial audit: mode selection and command adherence

Date: 2026-08-08

## Scope and method

This note consolidates four evidence sources before implementation:

1. current checkout code/tests/specs;
2. Trellis workflow and task scripts;
3. installed Codex/Claude plugin caches and MCP handshakes;
4. past session dialogue recovered through `trellis mem`.

Three read-only Expert Team work items independently audited runtime protocol, Trellis gates, and host/cache behavior. No subagent changed files.

## Reproduced failure chain

Session: `codex 019fe17c-cd61-7742-80c4-ac3454760688`.

The simulation request explicitly invoked Expert Team and asked for implementation plus Trellis, backend/SSE/worker/recovery/failure/no-action/repeat/spec/commit/session checks. The AI then:

1. supplied `explicit="lightweight"` itself;
2. received `next_action="request_task_consent"`;
3. called qualify immediately with lightweight and display-only string work items;
4. stated “你已经明确同意创建新 Trellis 任务” although no intervening user answer existed;
5. created a new task whose PRD still contained `TBD` and began source inspection.

This proves the failure is reachable in normal model behavior and is not a hypothetical adversarial case.

## Runtime trust-boundary findings

### Caller can force lightweight

- `runtime/server/mcp_stdio.py:29-30` exposes `explicit` as an ordinary enum.
- `runtime/routing.py:26-27` returns it before evaluating durable audit, human gates, evidence or waves.
- `tests/test_runtime_foundations.py:104-108` deliberately asserts that explicit lightweight overrides `durable_audit=True`.
- `request`, `intent`, `host_mode`, flags and `task_id` are also caller supplied; there is no trusted original-prompt envelope.

### Prepare is advisory only

- `runtime/service.py:143-159` returns prepare state/next_action without receipt, nonce or persistence.
- `runtime/server/mcp_stdio.py:51-67` directly exposes prepare, qualify and start as unrelated handlers.
- `runtime/server/mcp_stdio.py:69-120` does not consume a prepare ID or host mode.
- `runtime/service.py:161-173` starts a run after only task/contract/graph checks.
- Direct start is also used by `scripts/expert_team_run.py:69-83` and `scripts/model_e2e.py:71-83`.

No runtime consumer validates `next_action`. Therefore consent, planning activation and host-mode instructions can all be skipped.

### Task and human identity can be borrowed or forged

- `runtime/service.py:28-45` resolves any unique task name/id/directory and checks only `status=in_progress`; it does not bind the request to the active session task or reviewed planning artifacts.
- The current parent task is `in_progress` while this child is `planning`, so an unrelated/parent active task could be supplied to start a child-scope contract.
- `runtime/core/contracts.py:233-253` validates `HumanDecision.actor` only as a non-empty string.
- `runtime/core/reducer.py:235-249` accepts an approve decision without verifying its source.
- `tests/test_service_mcp.py:50-53` constructs `actor="user"` directly to complete a run.

### Managed/inline semantics are incomplete

- `runtime/service.py:114-151` reports `main-session-sequential` for inline and marks managed runtime eligible only for subagent mode.
- qualify does not accept host mode and can independently auto-start managed.
- Current persistence does not record prepare, chosen tier, choice source or host capability in `RunSnapshot`/resume.

Design conclusion: tier, execution mode and assurance capability must be separate fields. Managed governance may remain sequential when independent audit is not required; if acceptance requires an independent Auditor and the host is inline-only, the workflow must report a capability blocker rather than downgrade or overclaim.

## Trellis findings

Trellis supplies the correct conceptual sequence:

```text
task creation consent -> planning -> artifact review -> task.py start
-> implementation -> full check -> spec decision -> commit decision -> finish
```

Relevant evidence:

- task creation consent and “creation is not implementation approval”: `.trellis/workflow.md:152-180`, `.trellis/workflow.md:293`;
- complex planning artifacts and review before start: `.trellis/workflow.md:182-210`, `.trellis/workflow.md:438-448`;
- inline execution flow: `.trellis/workflow.md:232-241`;
- check/spec/commit/finish gates: `.trellis/workflow.md:527-642`.

However, many Trellis gates remain prompt-level rather than script-enforced:

- `task.py start` changes planning to in_progress without validating PRD/design/implement or user review (`.trellis/scripts/task.py:70-136`);
- seed-only `implement.jsonl` / `check.jsonl` can validate as zero real entries (`.trellis/scripts/common/task_context.py:115-161`);
- archive can complete/move a task without check/spec/commit evidence (`.trellis/scripts/common/task_store.py:376-463`);
- parent/child fields are organization, not a dependency graph (`.trellis/scripts/common/task_store.py:557-603`);
- workflow docs say missing session identity blocks start, while the script has a degraded success path (`.trellis/workflow.md:76,448`; `.trellis/scripts/task.py:95-119`).

Design conclusion: borrow Trellis phase names and source-of-truth hierarchy, but add explicit decision/evidence receipts. Do not treat a successful Trellis command as complete compliance proof.

## Installed plugin and workspace findings

### Session snapshot/cache drift

- Disk Codex install is `0.3.3+codex.20260808134157`; direct installed-cache `tools/list` contains `expert_team_prepare`.
- The active conversation still exposed a stale tool/skill snapshot: prepare was absent while the advertised skill locator targeted an old/empty `0.3.3` path.
- `README.md:115-117` already states existing conversations do not hot-load newly installed skills/MCP tools.
- OpenAI's current plugin documentation likewise says bundled skills become available in new chats/CLI sessions after installation: [Plugins documentation](https://learn.chatgpt.com/docs/plugins).

### Claude cache divergence

- Installed Claude cache remained at commit `3905723`, manifest `0.3.3`, with no prepare tool or entry-gate skill.
- Repository Claude manifest was still `0.3.3`; only Codex had a build cachebuster.
- `tests/test_plugin_contract.py:23-49` checks only base-version equality, so semantic stale cache can still pass the manifest validator.
- The current Claude installation was also disabled at project scope and tied to a removed temporary project; it is not valid cross-host evidence.

### P0: installed MCP resolves the wrong project

- `.mcp.json:9` fixes MCP `cwd` to the plugin root.
- `scripts/expert_team_mcp_launcher.js:47-52` starts Python with that root as cwd.
- `runtime/server/mcp_stdio.py:176-177` uses `Path.cwd()` as `ExpertTeamService.repo_root`.
- Installed-cache prepare therefore searched the plugin package's own `.trellis`, reported Trellis present, but found zero matches for the user's active task.

Until workspace identity is passed and verified per request/session, installed managed mode cannot reliably operate on the user's project.

### Duplicate and no-action behavior

- `runtime/adapters/trellis/store.py:107-116` uses `exist_ok=False`; a repeated same run ID leaks a raw FileExistsError.
- A different run ID creates a duplicate run for the same logical invocation.
- `scripts/expert_team_run.py:104-108` defaults to foreground execution when no lifecycle action is supplied instead of no-action/help.

## Host capability evidence

### Codex

Current runtime evidence shows `request_user_input` is mode-dependent, so a plugin cannot assume a radio control is always available.

Official Codex hook documentation says plugin hooks can observe/block Bash, `apply_patch`, MCP and most local function tools, while specialized/hosted paths may bypass the hook path. It explicitly frames hooks as useful guardrails rather than a complete enforcement boundary: [Codex hooks](https://learn.chatgpt.com/docs/hooks).

Implication: use hooks to stop common illegal mutations, report the enforcement level, and keep server receipts as the authoritative managed-run gate. Do not claim sandbox-grade enforcement.

### Claude Code

Claude Code documents `UserPromptSubmit`, `PreToolUse`, and MCP `Elicitation`/`ElicitationResult`; form elicitation normally displays an interactive dialog and returns the response to the MCP server: [Claude Code hooks](https://code.claude.com/docs/en/hooks).

Implication: Claude can provide a stronger directly attributable selection path when elicitation is available. Cross-host baseline must still support a no-interaction/needs-input state because Codex CLI does not document equivalent MCP elicitation support.

## Required negative test matrix

| Case | Required result |
| --- | --- |
| AI supplies lightweight + hard managed facts | managed floor; no downgrade |
| AI marks implementation as analysis | intent conflict; no mutation |
| prepare missing in stale session | stale_session; refresh/new session |
| prepare returns consent required, AI calls start | reject; no task/run write |
| string work item list | schema error; not a task graph |
| parent active, child planning | task binding error |
| AI submits actor=user | unverified; cannot approve |
| mode dialog cancelled/no response | no-action; zero writes |
| native single-select unavailable | needs_input; no implicit default |
| managed requires independent audit, host inline | capability_blocked; no overclaim |
| repeat prepare/select/qualify/start | idempotent same result/run |
| conflicting repeated selection | needs_input; append conflict evidence |
| same logical invocation, new run ID | reject duplicate |
| installed server package cwd | use verified user workspace |
| Codex new vs old session | new loads toolset; old reports stale |
| Claude same-version stale cache | base version bump required |
| hook disabled/untrusted | partial/advisory enforcement disclosed |
| cancel/crash/resume | terminal preserved; only unaccepted work retried |

## Existing passing foundations

The audit did not discard working pieces:

- cancellation/abandoned episode recovery already has focused supervisor coverage;
- task start rejects a planning task when the correct task ID is supplied;
- run store, reducer, audit acceptance and crash recovery foundations are present;
- 62 focused plugin/service/CLI/core/supervisor tests passed during the read-only host audit.

These do not prove entry compliance, user attribution, correct installed workspace, cache freshness or mode UX.

## Recommended implementation order

1. bind MCP requests to the verified user workspace;
2. replace unsafe tier override with ModeAssessment policy floor;
3. add trusted decision provenance and prepare/select/qualify receipt chain;
4. guard direct start/human approval and add idempotency;
5. add plugin hooks/native selection adapters with explicit enforcement level;
6. add installed-cache/new-session/cross-host semantic tests;
7. update Trellis spec, README diagrams, versions and release flow.
