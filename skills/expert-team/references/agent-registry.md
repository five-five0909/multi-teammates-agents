# Agent Registry

This registry exposes all 20 profiles adapted from ExpertTeam-Codex. Read only
the profiles selected for the current run. The six Qoder compatibility roles in
`expert-catalog.md` remain available as general fallbacks.

`agent-registry.json` is the machine-readable source of truth for IDs, domains,
kinds, modes, native agent types, and profile paths. This document is its
human-readable index.

## Software

| ID | Kind | Default mode | Profile |
|---|---|---|---|
| `software-team-lead` | coordinator | read | [profile](agents/software/software-team-lead.md) |
| `software-product-manager` | specialist | read | [profile](agents/software/software-product-manager.md) |
| `software-architect` | specialist | read | [profile](agents/software/software-architect.md) |
| `software-engineer` | specialist | write | [profile](agents/software/software-engineer.md) |
| `software-qa-engineer` | specialist | verify | [profile](agents/software/software-qa-engineer.md) |

## Product

| ID | Kind | Default mode | Profile |
|---|---|---|---|
| `product-director` | coordinator | read | [profile](agents/product/product-director.md) |
| `requirement-analyst` | specialist | read | [profile](agents/product/requirement-analyst.md) |
| `user-researcher` | specialist | read | [profile](agents/product/user-researcher.md) |
| `competitive-analyst` | specialist | read | [profile](agents/product/competitive-analyst.md) |
| `data-analyst` | specialist | read | [profile](agents/product/data-analyst.md) |
| `roadmap-planner` | specialist | read | [profile](agents/product/roadmap-planner.md) |

## Design

| ID | Kind | Default mode | Profile |
|---|---|---|---|
| `design-engine-team-lead` | coordinator | read | [profile](agents/design/design-engine-team-lead.md) |
| `discovery-analyst` | specialist | read | [profile](agents/design/discovery-analyst.md) |
| `design-system-expert` | specialist | read | [profile](agents/design/design-system-expert.md) |
| `prototype-builder` | specialist | write | [profile](agents/design/prototype-builder.md) |
| `critique-reviewer` | specialist | verify | [profile](agents/design/critique-reviewer.md) |
| `export-specialist` | specialist | write | [profile](agents/design/export-specialist.md) |

## Platform

| ID | Kind | Default mode | Profile |
|---|---|---|---|
| `infrastructure-operations-expert` | specialist | read | [profile](agents/platform/infrastructure-operations-expert.md) |
| `security-expert` | specialist | read | [profile](agents/platform/security-expert.md) |
| `database-optimization-expert` | specialist | read | [profile](agents/platform/database-optimization-expert.md) |

## Selection rules

- Apply coordinator profiles in the primary lead; do not spawn them as nested
  team leads.
- Dispatch specialists with their profile responsibility, exclusions, evidence,
  ownership, and result contract.
- A write profile still requires exact disjoint ownership. Platform profiles
  remain read-only until the user clearly authorizes a bounded mutation.
- Project overrides under `.expert-team/roles/` win by case-insensitive ID.
