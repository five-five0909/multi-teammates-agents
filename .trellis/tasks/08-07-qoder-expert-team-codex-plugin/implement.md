# Implementation Plan: Qoder-Inspired Expert Team Codex Plugin

## Task shape

Keep this as one Trellis task. The manifest, orchestration skill, role catalog,
validation fixtures, and documentation form one installable artifact and share
one acceptance gate. Splitting them into independently started child tasks would
add coordination without producing separately useful deliverables.

## Preconditions

- [x] User reviews and approves `prd.md`, `design.md`, and this plan.
- [x] Run Trellis Phase 1.4 and activate the task with `task.py start`.
- [x] Load `trellis-before-dev` before editing implementation files.
- [x] Read relevant project spec indexes and complete skill/plugin authoring
  instructions before generating the plugin.

## Implementation checklist

### 1. Establish plugin scaffold

- [x] Confirm the normalized plugin name `multi-teammates-agents` matches the
  current repository directory.
- [x] Scaffold or create `.codex-plugin/plugin.json` at the repository root.
- [x] Use a strict semver initial version and valid required metadata.
- [x] Include only the `skills` component; do not declare MCP, apps, hooks, or
  assets unless matching files are actually added.
- [x] Add a suitable license file and concise root README structure.

Rollback point: remove only newly created plugin scaffold files; preserve all
Trellis files and user-authored content.

### 2. Implement the `$expert-team` skill

- [x] Create `skills/expert-team/SKILL.md` with precise positive and negative
  triggers for explicit and implicit invocation.
- [x] Encode the orchestration phases: qualify, decompose, select roles, build
  dependencies, assign ownership, dispatch waves, synchronize, verify, and
  synthesize.
- [x] Require direct native subagent delegation when parallel work materially
  improves speed or quality.
- [x] Encode sequential fallback when subagents are unavailable.
- [x] Require truthful failure and partial-completion reporting.
- [x] Add `agents/openai.yaml` presentation metadata while retaining implicit
  invocation.

Rollback point: remove the new skill directory; plugin manifest remains valid
only if another skill exists, so validate after any rollback.

### 3. Add expert and protocol references

- [x] Add the six-role default catalog with responsibilities, exclusions,
  preferred posture, evidence requirements, and dispatch hints.
- [x] Add lightweight workflow shapes and domain lenses adapted from the public
  ExpertTeam-Codex reference without copying obsolete runtime mechanics.
- [x] Migrate all 20 upstream Agent identities into separate domain-organized
  profiles backed by a unique-ID/path registry and deterministic tests.
- [x] Add task graph, state transition, concurrency, and ownership rules.
- [x] Add the normalized expert result schema and lead synthesis checklist.
- [x] Add project override discovery under `.expert-team/roles/`.
- [x] Add Trellis detection/integration rules that never bypass Trellis phase
  gates or mutate task state implicitly.
- [x] Add the opt-in run-ledger template and persistence decision rules.

Rollback point: reference files can be removed only after removing every link
from `SKILL.md` and passing the contract test.

### 4. Add deterministic contract validation

- [x] Add JSON fixtures for parallel reads, disjoint writes, overlapping
  writes, blocked dependencies, and cycles.
- [x] Implement a standard-library validation script for fixture schema,
  dependency integrity, acyclicity, and write-scope conflicts.
- [x] Add tests for manifest/skill/reference integrity, required roles, trigger
  boundaries, and absence of Qoder runtime endpoints/dependencies.
- [x] Ensure validators are side-effect free and work on Windows paths.

Rollback point: contract script/tests may be removed without changing runtime
behavior, but the task cannot satisfy its acceptance criteria until equivalent
validation exists.

### 5. Document installation and use

- [x] Explain explicit `$expert-team` invocation and implicit routing.
- [x] Document `/agent` inspection, concurrency cost, permissions, and
  sequential fallback.
- [x] Document controlled write ownership and Lead integration responsibility.
- [x] Document role overrides and optional run-ledger persistence.
- [x] Document Trellis-enhanced behavior and non-Trellis operation.
- [x] Include the Qoder-to-Codex capability map and explicit non-goals without
  copying proprietary content.
- [x] Document local validation and later marketplace installation choices.

### 6. Verify full acceptance scope

- [x] Run the plugin validator.
- [x] Run the skill validator.
- [x] Run deterministic contract tests.
- [x] Inspect the final tree for unsupported manifest fields, stale paths,
  TODO placeholders, secrets, Qoder binaries, and private endpoint coupling.
- [x] Exercise or dry-run the behavioral smoke scenarios from `design.md`.
- [x] Map every PRD acceptance criterion to evidence in the check report.
- [x] Run `trellis-check` before reporting implementation complete.

## Planned validation commands

Exact paths are resolved during implementation after scaffold creation.

```powershell
python C:/Users/fifine/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py E:/code_space/agent-space/multi-teammates-agents
python C:/Users/fifine/.codex/skills/.system/skill-creator/scripts/quick_validate.py E:/code_space/agent-space/multi-teammates-agents/skills/expert-team
python -m unittest discover -s tests -p "test_*.py"
python scripts/validate_contract.py tests/fixtures
```

## Risk controls

- Keep Qoder inspection read-only and never modify installed Qoder files.
- Do not include Qoder source bundles, cached user data, tokens, or endpoints in
  the plugin.
- Do not create or edit a personal/team marketplace during this task unless the
  user explicitly selects that distribution destination.
- Preserve `.trellis/`, `.agents/`, `.codex/`, and unrelated user changes.
- Stop and return to planning if official validators reject the proposed
  skills-only structure or if Codex's current plugin schema conflicts with the
  design assumptions.

## Completion gate

Implementation is ready for final review only when all PRD acceptance criteria
have evidence, validators and tests pass, documentation matches actual behavior,
and no required work remains hidden behind a successful summary.
