"""Version and host-compatibility checks for the Expert Team entry boundary.

The MCP server and its host hooks are released together.  A package version
alone is not enough to detect a stale host, so the entry contract, hook schema,
and MCP toolset fingerprint are checked as one small, serialisable report.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re
from typing import Any


PACKAGE_VERSION = "0.4.1"
ENTRY_CONTRACT_VERSION = 2
HOOK_SCHEMA_VERSION = 1
TOOLSET_VERSIONS: dict[str, int] = {
    "prepare": 2,
    "select_mode": 1,
    "qualify": 2,
    "compliance": 1,
    "version": 1,
}

UPGRADE_COMMANDS: tuple[str, ...] = (
    "codex plugin marketplace upgrade multi-teammates-agents",
    "codex plugin add multi-teammates-agents@multi-teammates-agents",
)

_SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$")


def base_version(value: str | None) -> str | None:
    """Return a release version without a host cachebuster.

    Codex appends ``+codex.<timestamp>`` to a plugin manifest.  That build
    metadata identifies the cache entry, but it must not make an otherwise
    compatible release fail the handshake.
    """

    if not isinstance(value, str):
        return None
    candidate = value.strip()
    match = _SEMVER.fullmatch(candidate)
    if not match:
        return None
    return ".".join(match.groups())


def toolset_fingerprint() -> str:
    encoded = json.dumps(TOOLSET_VERSIONS, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class VersionReport:
    """Immutable comparison result safe to expose through MCP."""

    host_package_version: str | None = None
    host_entry_contract_version: int | None = None
    host_hook_schema_version: int | None = None
    host_toolset_fingerprint: str | None = None

    @property
    def expected_package_version(self) -> str:
        return PACKAGE_VERSION

    @property
    def expected_toolset_fingerprint(self) -> str:
        return toolset_fingerprint()

    @property
    def checks(self) -> dict[str, bool | None]:
        package_check: bool | None
        if self.host_package_version is None:
            package_check = None
        else:
            package_check = base_version(self.host_package_version) == PACKAGE_VERSION
        return {
            "package": package_check,
            "entry_contract": None
            if self.host_entry_contract_version is None
            else self.host_entry_contract_version == ENTRY_CONTRACT_VERSION,
            "hook_schema": None
            if self.host_hook_schema_version is None
            else self.host_hook_schema_version == HOOK_SCHEMA_VERSION,
            "toolset": None
            if self.host_toolset_fingerprint is None
            else self.host_toolset_fingerprint == self.expected_toolset_fingerprint,
        }

    @property
    def mismatches(self) -> tuple[str, ...]:
        checks = self.checks
        return tuple(name for name, value in checks.items() if value is False)

    @property
    def has_host_data(self) -> bool:
        return any(
            value is not None
            for value in (
                self.host_package_version,
                self.host_entry_contract_version,
                self.host_hook_schema_version,
                self.host_toolset_fingerprint,
            )
        )

    @property
    def compatible(self) -> bool:
        return not self.mismatches

    @property
    def status(self) -> str:
        if self.mismatches:
            return "upgrade_required"
        if not self.has_host_data:
            return "host_version_not_provided"
        return "compatible"

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "status": self.status,
            "compatible": self.compatible,
            "upgrade_required": bool(self.mismatches),
            "expected": {
                "package_version": PACKAGE_VERSION,
                "entry_contract_version": ENTRY_CONTRACT_VERSION,
                "hook_schema_version": HOOK_SCHEMA_VERSION,
                "toolset_fingerprint": self.expected_toolset_fingerprint,
            },
            "host": {
                "package_version": self.host_package_version,
                "base_package_version": base_version(self.host_package_version),
                "entry_contract_version": self.host_entry_contract_version,
                "hook_schema_version": self.host_hook_schema_version,
                "toolset_fingerprint": self.host_toolset_fingerprint,
            },
            "checks": self.checks,
            "mismatches": list(self.mismatches),
            "upgrade_commands": list(UPGRADE_COMMANDS),
            "next_action": "upgrade_plugin_then_restart_host_session" if self.mismatches else "continue_or_send_host_versions",
        }


def compare_versions(
    *,
    host_package_version: str | None = None,
    host_entry_contract_version: int | None = None,
    host_hook_schema_version: int | None = None,
    host_toolset_fingerprint: str | None = None,
) -> VersionReport:
    return VersionReport(
        host_package_version=host_package_version,
        host_entry_contract_version=host_entry_contract_version,
        host_hook_schema_version=host_hook_schema_version,
        host_toolset_fingerprint=host_toolset_fingerprint,
    )

def stale_session_message(report: VersionReport) -> str:
    """Create an actionable error for hosts that cannot consume this release."""

    payload = report.to_dict()
    commands = " ; ".join(report.to_dict()["upgrade_commands"])
    return (
        "stale_session: host and MCP versions are incompatible; "
        f"upgrade_required=true; mismatches={','.join(report.mismatches)}; "
        f"expected_package={PACKAGE_VERSION}; host_package={report.host_package_version or 'unknown'}; "
        f"upgrade_commands={commands}; "
        "after upgrading, close and reopen the Codex/Claude session before retrying; "
        f"version_report={json.dumps(payload, ensure_ascii=False, sort_keys=True)}"
    )
