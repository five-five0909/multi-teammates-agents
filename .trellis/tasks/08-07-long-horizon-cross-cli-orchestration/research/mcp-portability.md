# MCP portability research — 2026-08-08

## Facts reproduced locally

- Windows host: Codex CLI `0.147.0`, Claude Code `2.1.220`.
- Ubuntu 22.04 WSL: `python` is absent; `python3` is `/usr/bin/python3` at
  version `3.10.12`.
- The previous `.mcp.json` invoked `python -c ...`; on Ubuntu that command
  failed before MCP initialization because the executable name was missing.
- Python 3.10 does not provide the Python 3.11 `tomllib` module. The previous
  unconditional import therefore failed even when `python3` was invoked.
- With the new Node bridge, the same `initialize` request returns server
  `expert-team`, version `0.3.1`, on both Windows and Ubuntu. The full 78-test
  suite passes on both interpreters.

## Host packaging facts

- OpenAI plugin packaging requires `.codex-plugin/plugin.json` and allows
  `mcpServers` to point at a root `.mcp.json`.
  See <https://developers.openai.com/plugins/build/plugins>.
- Claude Code discovers `.mcp.json` at the plugin root and starts enabled plugin
  MCP servers automatically. It supplies `${CLAUDE_PLUGIN_ROOT}` to plugin
  processes. See <https://code.claude.com/docs/en/mcp> and
  <https://code.claude.com/docs/en/plugins-reference>.
- Plugin installation is host-managed. It must not be implemented by editing a
  user's `~/.codex/config.toml`, `~/.claude.json`, or other personal files.
  Codex may therefore show a bundled server in `codex mcp list` without adding a
  global `mcp_servers` table.

## Decisions

1. Keep one shared `.mcp.json` and use a Node stdio bridge. Node is already a
   runtime prerequisite of the supported Codex/Claude CLI distributions; the
   bridge selects `python`/`py -3` on Windows and `python3`/`python` on POSIX.
2. Keep the Python service dependency-free by vendoring Tomli 2.4.1 for
   Python 3.10. Python 3.11+ continues to use `tomllib` from the standard
   library. License and source attribution are in `THIRD_PARTY_NOTICES.md`.
3. Bump both plugin manifests and the MCP server version to `0.3.1` so plugin
   caches cannot silently keep the old launcher.

## Deliberately not done

- No installer edits user Codex/Claude configuration.
- No shell fallback, privileged package installation, or automatic `pip`/`apt`
  mutation.
- No duplicate manual MCP server entry is added to either host.
