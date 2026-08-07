# Architecture Baseline Research

Research date: 2026-08-07

## LongHorizon-Harness

- Source: <https://github.com/AMAP-ML/LongHorizon-Harness>
- Inspected commit: `b1b804519c1ffe1b00e60c19290157c82e3e5c83`
- License: MIT.
- Inspected areas: Chinese/English README, Manager loop, role prompts, state
  types, configuration, Codex and Claude adapters, auditor guard, event/log
  normalization, dashboard gates, and persistence.

Portable behaviors selected for adaptation:

- Manager / Executor / Auditor separation.
- Fresh role contexts and compact Manager resume context.
- Independently audited progress as the only verified state.
- Append-only rounds/events plus atomic state and per-round evidence.
- Bounded rounds/timeouts and end-of-round human gates.
- Backend adapters that normalize role trajectories.

Behaviors deliberately not copied:

- Upstream approval/sandbox bypass flags. The harness assumes external
  isolation; a distributable plugin must inherit host/user permissions.
- A separate `.lh-harness/` project lifecycle. Trellis is the selected durable
  task authority for this project.
- GUI/computer-use/dashboard scope in the first milestone.
- A strictly single-Executor round, because Expert Team already supports safe
  dependency-aware execution waves.

## Codex plugin baseline

Official sources:

- <https://developers.openai.com/plugins/concepts/plugins>
- <https://developers.openai.com/plugins/build/plugins>
- <https://developers.openai.com/plugins/build/skills>

Confirmed facts:

- `.codex-plugin/plugin.json` is the required plugin entry point.
- Plugins may package skills, `.mcp.json`, and lifecycle hooks.
- Component paths are plugin-root-relative; only `plugin.json` belongs in the
  `.codex-plugin/` directory.
- Bundled MCP tools retain user-configurable approval policy.
- Plugin hooks require review/trust and receive `PLUGIN_ROOT`/`PLUGIN_DATA`.
- Skills are appropriate for workflow guidance; MCP is appropriate when typed,
  stateful capabilities must be exposed.

Design inference: a skills + local MCP shape is the smallest Codex package that
can enforce the requested resumable task-hosting contract.

## Claude Code plugin baseline

Official sources:

- <https://code.claude.com/docs/en/plugins>
- <https://code.claude.com/docs/en/plugins-reference>
- <https://code.claude.com/docs/en/sub-agents>
- <https://code.claude.com/docs/en/plugin-marketplaces>

Confirmed facts:

- Claude plugins can contain skills, agents, hooks, MCP servers, executables,
  settings, LSP servers, and monitors.
- `.claude-plugin/plugin.json` supplies identity; plugin components stay at the
  plugin root and plugin skills/agents are namespaced.
- Installed plugins are copied into a cache, so runtime paths must stay inside
  the plugin and use `${CLAUDE_PLUGIN_ROOT}` where required.
- Subagents have isolated contexts, can run foreground/background, and surface
  permission prompts through the main session.
- Plugin agents can be addressed by scoped names; `claude plugin validate`
  validates local plugin structure.

Design inference: Claude-native `agents/` should present specialist profiles,
while the shared MCP service owns cross-session state and acceptance rules.

## Existing project baseline

- Current plugin specification is skills-first and explicitly forbids a second
  supervisor without separately approved requirements.
- This new task supplies those requirements but does not supersede the spec
  until planning is approved and the spec is deliberately updated.
- The current twenty-profile registry should remain the canonical role source;
  Claude agent definitions should be generated or validated against it rather
  than manually forked.
