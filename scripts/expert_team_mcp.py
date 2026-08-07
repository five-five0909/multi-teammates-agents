#!/usr/bin/env python3
"""Launch the bundled Expert Team MCP server from the current project."""

from __future__ import annotations

from pathlib import Path
import sys


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from runtime.server.mcp_stdio import serve  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(serve())
