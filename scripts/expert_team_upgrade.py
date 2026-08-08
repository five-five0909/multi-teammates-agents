"""Check or safely upgrade the installed Expert Team plugin.

The upgrade path never removes cache entries.  It refreshes the marketplace,
installs the selected plugin, and reminds the caller to start a new host
session because Codex/Claude do not hot-reload MCP tool lists.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.versioning import ENTRY_CONTRACT_VERSION, HOOK_SCHEMA_VERSION, PACKAGE_VERSION, UPGRADE_COMMANDS, toolset_fingerprint


def _manifest_versions() -> dict[str, Any]:
    values: dict[str, Any] = {"package_version": PACKAGE_VERSION}
    for name in (".codex-plugin/plugin.json", ".claude-plugin/plugin.json"):
        path = ROOT / name
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(manifest, dict):
            values[name] = manifest.get("version")
    return values


def _run(command: list[str]) -> int:
    if shutil.which(command[0]) is None:
        print(f"未找到命令：{' '.join(command)}", file=sys.stderr)
        return 127
    print(f"> {' '.join(command)}")
    return subprocess.run(command, check=False).returncode


def _codex_version_visible() -> bool:
    """Verify the installed CLI reports the new base release after a warning."""

    if shutil.which("codex") is None:
        return False
    completed = subprocess.run(["codex", "plugin", "list"], check=False, capture_output=True, text=True)
    return PACKAGE_VERSION in f"{completed.stdout}\n{completed.stderr}"


def check() -> int:
    print(
        json.dumps(
            {
                "status": "upgrade_available_after_release_match",
                "expected": {
                    **_manifest_versions(),
                    "entry_contract_version": ENTRY_CONTRACT_VERSION,
                    "hook_schema_version": HOOK_SCHEMA_VERSION,
                    "toolset_fingerprint": toolset_fingerprint(),
                },
                "upgrade_commands": list(UPGRADE_COMMANDS),
                "next_action": "run --upgrade, then restart the Codex/Claude session",
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def upgrade() -> int:
    results = [_run(command.split()) for command in UPGRADE_COMMANDS]
    # A successful marketplace refresh plus install is enough to continue; the
    # plugin CLI may return a non-zero code for a harmless Windows cache backup
    # warning, so leave the concrete result visible instead of deleting data.
    verified = all(code == 0 for code in results) or _codex_version_visible()
    print(
        json.dumps(
            {
                "package_version": PACKAGE_VERSION,
                "commands": list(UPGRADE_COMMANDS),
                "return_codes": results,
                "installed_version_verified": verified,
                "next_action": "close and reopen Codex/Claude, then call expert_team_version and retry",
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if verified else 2


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="print the expected release and upgrade commands")
    mode.add_argument("--upgrade", action="store_true", help="refresh marketplace and install the plugin")
    arguments = parser.parse_args()
    return upgrade() if arguments.upgrade else check()


if __name__ == "__main__":
    raise SystemExit(main())
