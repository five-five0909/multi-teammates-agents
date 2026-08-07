#!/usr/bin/env python3
"""Render Claude Code plugin agents from the canonical expert registry."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REFERENCES = ROOT / "skills" / "expert-team" / "references"
REGISTRY = REFERENCES / "agent-registry.json"


def render_agent(agent: dict[str, str]) -> str:
    profile = (REFERENCES / agent["profile"]).read_text(encoding="utf-8").strip()
    kind = agent["kind"]
    mode = agent["default_mode"]
    if kind == "coordinator":
        description = f"{agent['domain'].title()} coordination playbook for the primary lead. Never invoke as an Executor or nested team lead."
    else:
        description = f"{agent['domain'].title()} {mode}-mode specialist. Invoke for bounded {agent['id'].replace('-', ' ')} work with explicit evidence."
    fields = ["---", f"name: {agent['id']}", f"description: {description}", "maxTurns: 30"]
    if mode in {"read", "verify"} or kind == "coordinator":
        fields.append("disallowedTools: Write, Edit")
    fields.extend(["---", "", profile, "", "## Managed-run handoff", "", "Return structured evidence to the primary lead. Never certify your own work. In managed mode, an independent Auditor must accept the result before it becomes verified progress.", ""])
    return "\n".join(fields)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail when generated agents differ from disk")
    args = parser.parse_args()
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    output = ROOT / "agents"
    output.mkdir(exist_ok=True)
    expected: dict[Path, str] = {}
    for agent in registry["agents"]:
        expected[output / f"{agent['id']}.md"] = render_agent(agent)
    existing = set(output.glob("*.md"))
    if args.check:
        stale = [path for path, content in expected.items() if not path.is_file() or path.read_text(encoding="utf-8") != content]
        extra = existing - expected.keys()
        if stale or extra:
            print("Claude agent render drift:", *(str(path) for path in [*stale, *sorted(extra)]), sep="\n")
            return 1
        print(f"PASS: {len(expected)} Claude agents match the canonical registry")
        return 0
    for path, content in expected.items():
        path.write_text(content, encoding="utf-8", newline="\n")
    for path in existing - expected.keys():
        path.unlink()
    print(f"Rendered {len(expected)} Claude agents")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
