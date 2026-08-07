# ExpertTeam-Codex Reference Review

## Provenance

- Repository: <https://github.com/ReJeCtAll/ExpertTeam-Codex>
- Reviewed commit: `59c573b523af6d7755861e7637c2fa5f7ce1ddae`
- Reported version: `1.6.0`
- License: MIT
- Inspection method: read-only shallow clone outside the project workspace.

This is a complementary public reference to the local Qoder behavioral
inspection. It is not treated as the current Codex plugin schema authority.

## Portable patterns adopted

- Route requests by domain while retaining one clear lead.
- Distinguish direct/single-specialist, fast, bugfix, standard, and audit-shaped
  work so small requests do not receive a heavyweight team.
- Bound repair and verification loops to two rounds for the same failed gate.
- Require global consistency and explicit pass/fail evidence at quality gates.
- Apply domain-specific safety baselines for operations, security, and database
  work, including authorization, read-only defaults, rollback, and observation.
- Make cross-domain handoffs explicit: application changes go to software;
  infrastructure changes go to operations; live-data concerns stay bounded.
- Match the response language to the user's language where project rules allow.
- Keep delivery reports optional rather than persisting every run.

## Patterns intentionally not copied

- Direct installation into `~/.codex`; this project uses the current
  `.codex-plugin/plugin.json` package boundary.
- Markdown agent and command compatibility files that do not match the current
  portable plugin payload chosen for this project.
- Assumed team-runtime commands or a custom supervisor; current Codex native
  subagents provide lifecycle and inspection.
- Large fixed teams for every request. The local plugin uses the smallest task
  graph justified by risk and dependencies.
- Text, prompts, or templates verbatim. Only architectural behavior was adapted.

## Resulting design change

The plugin retains the six Qoder-observed default roles and adds a separate
workflow-routing reference. Domain lenses modify evidence and safety gates
without multiplying the default role catalog or coupling orchestration to one
software-delivery SOP.

## Full agent migration inventory

All 20 upstream identities are now represented as separate portable profiles:

- Software (5): team lead, product manager, architect, engineer, QA engineer.
- Product (6): director, requirement analyst, user researcher, competitive
  analyst, data analyst, roadmap planner.
- Design (6): team lead, discovery analyst, design-system expert, prototype
  builder, critique reviewer, export specialist.
- Platform (3): infrastructure operations, security, database optimization.

The three domain leads are preserved as coordinator playbooks for the primary
lead rather than nested subagent orchestrators. A JSON registry records all IDs,
domains, modes, native agent types, and paths; tests enforce exact completeness.
