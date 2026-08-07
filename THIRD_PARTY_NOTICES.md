# Third-Party Notices

The cross-domain agent taxonomy and workflow ideas in this plugin were adapted
from [ExpertTeam-Codex](https://github.com/ReJeCtAll/ExpertTeam-Codex), reviewed
at commit `59c573b523af6d7755861e7637c2fa5f7ce1ddae`.

ExpertTeam-Codex is distributed under the MIT License and identifies its
copyright holder as “Codex Expert Teams Contributors”.

The profiles in this repository are reorganized and rewritten for the current
Codex plugin, skill, native-subagent, ownership, and safety contracts. The
upstream direct installer and legacy agent/team commands are not included.

The managed orchestration lifecycle was informed by the MIT-licensed
[LongHorizon-Harness](https://github.com/AMAP-ML/LongHorizon-Harness), inspected
at commit `b1b804519c1ffe1b00e60c19290157c82e3e5c83`.

This repository adapts its portable Manager / Executor / Auditor separation,
independently verified progress, bounded rounds, resumable state, human gating,
fresh episode boundary, bounded CLI process lifecycle, structured role prompts,
and Auditor workspace-integrity concepts. The implementations under
`runtime/adapters/`, `runtime/prompts.py`, `runtime/supervisor.py`, and
`runtime/audit_guard.py` are rewritten for the local HostAdapter and Trellis
contracts rather than copied wholesale.

It does not copy the upstream dashboard, computer-use layer, remote environment,
or permission/sandbox bypass defaults. In particular, this project never adds
`--dangerously-bypass-approvals-and-sandbox` or
`--dangerously-skip-permissions` to role invocations.
