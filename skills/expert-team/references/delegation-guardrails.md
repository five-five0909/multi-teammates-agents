# Delegation guardrails

These rules govern when and how the lead uses native subagents. They supplement
the role registry and task-graph contract; they do not replace the existing
`explorer`, `worker`, or `default` role semantics.

## Dispatch only when it buys leverage

Re-evaluate delegation at every major wave, not only at the beginning of a
request. Dispatch when a subagent will reduce lead-context pollution, enable
independent parallel work, or provide an independent verification perspective.

Handle the work directly when it is a known small file, a small amount of code,
a single fact, the exact code the lead is about to modify, or a foundational
architecture/design/handoff document whose details are needed to establish the
lead's own context.

Dispatch read-heavy work when it covers a large file, multiple files or
directories, independent exploration or review, a long-running task's current
state, or a peripheral command that would produce a large amount of output.
Do not create a subagent only to relay context or answer a simple, tightly
coupled question. Ready independent read tasks may run in parallel; write tasks
still require explicit, disjoint ownership.

## Make every episode self-contained

Each dispatch prompt must state the bounded objective, inspected scope, useful
inputs, exclusions, role/mode, ownership (if it can write), and the exact result
and evidence format expected. Include the active Trellis task path when one is
available so the subagent can find the same durable context.

Exploration, retrieval, and verification episodes are read-only by default. A
subagent must not recursively spawn another subagent, choose the final design,
or claim final acceptance. When the host supports it, prefer
`fork_turns="none"` so a one-shot probe does not inherit the lead's full,
possibly stale transcript.

## Return evidence, not packaging

The result should be compact and directly usable by the lead. Include exact
`file:line` anchors, symbol names, and short necessary excerpts. Separate facts
observed in the workspace from inferences or unresolved caveats. If coverage is
incomplete, say what was not checked instead of filling the gap with a guess.

The lead samples the cited locations, resolves conflicting evidence, integrates
owned writes, and runs the final checks. A subagent result is a lead input, not
a substitute for the lead's decision or acceptance gate.
