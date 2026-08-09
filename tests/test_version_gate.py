from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from runtime.core.contracts import ContractError
from runtime.server.mcp_stdio import MCPServer
from runtime.service import ExpertTeamService
from runtime.versioning import (
    ENTRY_CONTRACT_VERSION,
    HOOK_SCHEMA_VERSION,
    PACKAGE_VERSION,
    base_version,
    compare_versions,
    toolset_fingerprint,
)


ROOT = Path(__file__).resolve().parents[1]


class VersionGateTests(unittest.TestCase):
    def test_codex_cachebuster_is_compatible(self) -> None:
        self.assertEqual(PACKAGE_VERSION, base_version(f"{PACKAGE_VERSION}+codex.20260809100000"))
        report = compare_versions(
            host_package_version=f"{PACKAGE_VERSION}+codex.20260809100000",
            host_entry_contract_version=ENTRY_CONTRACT_VERSION,
            host_hook_schema_version=HOOK_SCHEMA_VERSION,
            host_toolset_fingerprint=toolset_fingerprint(),
        )
        self.assertTrue(report.compatible)
        self.assertEqual("compatible", report.status)
        self.assertEqual((), report.mismatches)

    def test_old_host_gets_actionable_upgrade_message(self) -> None:
        report = compare_versions(host_package_version="0.4.0")
        self.assertFalse(report.compatible)
        self.assertEqual("upgrade_required", report.status)
        self.assertEqual(["mta update --yes", "mta migrate --yes"], report.to_dict()["upgrade_commands"])
        with tempfile.TemporaryDirectory() as temporary:
            service = ExpertTeamService(Path(temporary))
            with self.assertRaisesRegex(ContractError, r"stale_session:.*upgrade_required=true.*restart"):
                service.prepare("version check", host_package_version="0.4.0")

    def test_mcp_version_tool_does_not_require_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            server = MCPServer(ExpertTeamService(Path(temporary), workspace_trusted=False))
            response = server.dispatch(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": "expert_team_version",
                        "arguments": {
                            "host_package_version": f"{PACKAGE_VERSION}+codex.test",
                            "host_entry_contract_version": ENTRY_CONTRACT_VERSION,
                            "host_hook_schema_version": HOOK_SCHEMA_VERSION,
                            "host_toolset_fingerprint": toolset_fingerprint(),
                        },
                    },
                }
            )
            assert response is not None
            content = response["result"]["structuredContent"]
            self.assertTrue(content["compatible"])
            self.assertEqual("compatible", content["status"])

if __name__ == "__main__":
    unittest.main()
