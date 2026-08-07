# Workflow Routing

Choose the lightest workflow that can meet the acceptance criteria. An expert
team is a coordination pattern, not a minimum agent count.

## Invocation hints

An explicit invocation may include a domain hint:

```text
$expert-team [software|product|design|ops|security|database] <request>
```

Treat the hint as routing context, not as permission to exceed the user's scope
or skip project instructions. Without a hint, infer the domain from the request.
Match the final response language to the user's language unless project rules
require otherwise.

## Workflow shapes

| Shape | Use when | Minimum useful graph |
|---|---|---|
| `direct` | One specialist can complete a bounded task | One specialist task; add verification only when risk warrants it. |
| `fast` | A small, well-understood change has limited blast radius | Engineer, then QA or focused verification. |
| `bugfix` | A reproducible defect needs diagnosis and repair | Debug engineer, repair engineer, then regression verification. |
| `standard` | Requirements, architecture, implementation, and validation materially depend on each other | Research/product framing, design, implementation, review, and QA as justified. |
| `audit` | The requested outcome is findings rather than implementation | Independent evidence collection followed by reviewer synthesis. |

Do not manufacture a multi-agent graph for work that fits `direct`. Prefer
`fast` over `standard` when the task is small and its boundaries are known.

## Domain lenses

The lens adjusts evidence and gates; it does not replace the expert catalog.

### Software

Establish affected modules and tests. Require consistency across changed call
sites, focused regression checks, and an explicit pass/fail verification result.

### Product

Establish users, problem, constraints, success metric, and non-goals before
proposing scope. Hand implementation-ready acceptance criteria to software or
design work.

### Design

Establish user flow, states, accessibility, responsive behavior, and design
system constraints. Verify expected paths and error, empty, and loading states.

### Operations

Establish environment and current facts before proposing action. Classify
urgency, run prechecks, define rollback and observation windows, and validate
afterward. Default to read-only analysis for production systems unless the user
has clearly authorized mutation.

### Security

Confirm authorization and assessment scope. Build findings from reproducible
evidence, state severity and impact, and avoid destructive testing or probing
third-party systems. Route code repairs to software and infrastructure repairs
to operations.

### Database

Establish engine/version, data scale, workload, and query or migration evidence.
Consider execution plans, locks, rollback, backups, and observation. Default to
read-only analysis for live data unless mutation is clearly authorized. Route
application/ORM changes to software and instance operations to operations.

## Repair limit

Plan no more than two repair-and-verification rounds for the same failed gate.
After the second failed round, report the blocker, retained evidence, and the
decision needed to continue. A materially new cause may create a new bounded
task, but must not disguise an endless retry loop.

