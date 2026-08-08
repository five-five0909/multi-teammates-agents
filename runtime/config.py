"""Strict, secret-safe configuration for managed Expert Team runs."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any, Mapping

try:
    import tomllib
except ModuleNotFoundError:  # Python 3.10: use the bundled TOML 1.0 parser.
    try:
        from ._vendor import tomli as tomllib  # type: ignore[no-redef]
    except ModuleNotFoundError:  # pragma: no cover - exercised by the Python 3.10 smoke check.
        try:
            import tomli as tomllib  # type: ignore[no-redef]
        except ModuleNotFoundError:
            tomllib = None  # type: ignore[assignment]

from .core.contracts import ContractError


ROLES = ("manager", "executor", "auditor")
HOSTS = {"codex", "claude"}
_SECRET_MARKERS = ("api_key", "token", "password", "secret")


@dataclass(frozen=True)
class RoleConfig:
    host: str
    model: str | None
    timeout_seconds: int
    context_chars: int
    output_chars: int


@dataclass(frozen=True)
class RuntimeConfig:
    workspace: Path
    max_rounds: int
    retry_limit: int
    max_concurrency: int
    human_completion_gate: bool
    roles: Mapping[str, RoleConfig]

    def role(self, name: str) -> RoleConfig:
        try:
            return self.roles[name]
        except KeyError as error:
            raise ContractError(f"unknown runtime role: {name}") from error


def load_runtime_config(
    repo_root: Path,
    overrides: Mapping[str, object] | None = None,
    environ: Mapping[str, str] | None = None,
) -> RuntimeConfig:
    root = repo_root.resolve()
    env = dict(os.environ if environ is None else environ)
    defaults: dict[str, Any] = {
        "host": env.get("EXPERT_TEAM_HOST", "codex"),
        "model": env.get("EXPERT_TEAM_MODEL") or None,
        "workspace": env.get("EXPERT_TEAM_WORKSPACE", str(root)),
        "max_rounds": _env_int(env, "EXPERT_TEAM_MAX_ROUNDS", 20),
        "retry_limit": _env_int(env, "EXPERT_TEAM_RETRY_LIMIT", 2),
        "max_concurrency": _env_int(env, "EXPERT_TEAM_MAX_CONCURRENCY", 4),
        "human_completion_gate": True,
        "timeouts": {"manager": 600, "executor": 1800, "auditor": 600},
        "context": {"manager": 48_000, "executor": 32_000, "auditor": 40_000},
        "output": {"manager": 64_000, "executor": 200_000, "auditor": 100_000},
        "roles": _environment_roles(env),
    }
    config_path = root / ".expert-team" / "config.toml"
    project: Mapping[str, Any] = {}
    if config_path.exists():
        if tomllib is None:
            raise ContractError(
                "a TOML parser is required when .expert-team/config.toml is present"
            )
        try:
            loaded = tomllib.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, tomllib.TOMLDecodeError) as error:
            raise ContractError(f"invalid .expert-team/config.toml: {error}") from error
        _reject_secrets(loaded)
        _strict_keys(loaded, {"run"}, "config")
        run = loaded.get("run", {})
        if not isinstance(run, Mapping):
            raise ContractError("config.run must be a table")
        project = run
    merged = _merge_run(defaults, project)
    merged = _merge_run(merged, overrides or {})
    host = _host(merged.get("host"), "run.host")
    model = _optional_text(merged.get("model"), "run.model")
    workspace_value = _text(merged.get("workspace"), "run.workspace")
    workspace = Path(workspace_value)
    if not workspace.is_absolute():
        workspace = root / workspace
    workspace = workspace.resolve()
    if not workspace.is_dir():
        raise ContractError("configured workspace must be an existing directory")
    timeouts = _role_numbers(merged.get("timeouts"), "run.timeouts")
    contexts = _role_numbers(merged.get("context"), "run.context")
    outputs = _role_numbers(merged.get("output"), "run.output")
    raw_roles = merged.get("roles", {})
    if not isinstance(raw_roles, Mapping):
        raise ContractError("run.roles must be a table")
    _strict_keys(raw_roles, set(ROLES), "run.roles")
    roles: dict[str, RoleConfig] = {}
    for role in ROLES:
        raw = raw_roles.get(role, {})
        if not isinstance(raw, Mapping):
            raise ContractError(f"run.roles.{role} must be a table")
        _strict_keys(raw, {"host", "model", "timeout_seconds", "context_chars", "output_chars"}, f"run.roles.{role}")
        roles[role] = RoleConfig(
            _host(raw.get("host", host), f"run.roles.{role}.host"),
            _optional_text(raw.get("model", model), f"run.roles.{role}.model"),
            _positive_int(raw.get("timeout_seconds", timeouts[role]), f"run.roles.{role}.timeout_seconds"),
            _positive_int(raw.get("context_chars", contexts[role]), f"run.roles.{role}.context_chars"),
            _positive_int(raw.get("output_chars", outputs[role]), f"run.roles.{role}.output_chars"),
        )
    return RuntimeConfig(
        workspace,
        _positive_int(merged.get("max_rounds"), "run.max_rounds"),
        _positive_int(merged.get("retry_limit"), "run.retry_limit"),
        _positive_int(merged.get("max_concurrency"), "run.max_concurrency"),
        _boolean(merged.get("human_completion_gate"), "run.human_completion_gate"),
        roles,
    )


def _merge_run(base: Mapping[str, Any], override: Mapping[str, object]) -> dict[str, Any]:
    _reject_secrets(override)
    allowed = {
        "host", "model", "workspace", "max_rounds", "retry_limit",
        "max_concurrency", "human_completion_gate", "timeouts", "context",
        "output", "roles",
    }
    _strict_keys(override, allowed, "run")
    merged = dict(base)
    for key, value in override.items():
        if key in {"timeouts", "context", "output", "roles"}:
            if not isinstance(value, Mapping):
                raise ContractError(f"run.{key} must be a table")
            nested = dict(merged.get(key, {}))
            if key == "roles":
                for role, role_value in value.items():
                    if not isinstance(role_value, Mapping):
                        raise ContractError(f"run.roles.{role} must be a table")
                    role_merged = dict(nested.get(role, {}))
                    role_merged.update(role_value)
                    nested[role] = role_merged
            else:
                nested.update(value)
            merged[key] = nested
        else:
            merged[key] = value
    return merged


def _reject_secrets(value: Mapping[str, object], prefix: str = "config") -> None:
    for key, item in value.items():
        normalized = str(key).casefold()
        if any(marker in normalized for marker in _SECRET_MARKERS):
            raise ContractError(f"{prefix}.{key} must not persist secrets")
        if isinstance(item, Mapping):
            _reject_secrets(item, f"{prefix}.{key}")


def _strict_keys(value: Mapping[str, object], allowed: set[str], label: str) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise ContractError(f"{label} unknown fields: {', '.join(sorted(unknown))}")


def _role_numbers(value: object, label: str) -> dict[str, int]:
    if not isinstance(value, Mapping):
        raise ContractError(f"{label} must be a table")
    _strict_keys(value, set(ROLES), label)
    return {role: _positive_int(value.get(role), f"{label}.{role}") for role in ROLES}


def _positive_int(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ContractError(f"{label} must be a positive integer")
    return value


def _boolean(value: object, label: str) -> bool:
    if not isinstance(value, bool):
        raise ContractError(f"{label} must be boolean")
    return value


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{label} must be a non-empty string")
    return value


def _optional_text(value: object, label: str) -> str | None:
    if value is None:
        return None
    return _text(value, label)


def _host(value: object, label: str) -> str:
    host = _text(value, label)
    if host not in HOSTS:
        raise ContractError(f"{label} must be codex or claude")
    return host


def _env_int(environ: Mapping[str, str], name: str, default: int) -> int:
    raw = environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as error:
        raise ContractError(f"{name} must be an integer") from error


def _environment_roles(environ: Mapping[str, str]) -> dict[str, dict[str, object]]:
    roles: dict[str, dict[str, object]] = {}
    suffixes = {
        "HOST": ("host", str),
        "MODEL": ("model", str),
        "TIMEOUT_SECONDS": ("timeout_seconds", int),
        "CONTEXT_CHARS": ("context_chars", int),
        "OUTPUT_CHARS": ("output_chars", int),
    }
    for role in ROLES:
        values: dict[str, object] = {}
        prefix = f"EXPERT_TEAM_{role.upper()}_"
        for suffix, (field, converter) in suffixes.items():
            raw = environ.get(prefix + suffix)
            if raw is None:
                continue
            try:
                values[field] = converter(raw)
            except ValueError as error:
                raise ContractError(f"{prefix}{suffix} must be an integer") from error
        if values:
            roles[role] = values
    return roles
