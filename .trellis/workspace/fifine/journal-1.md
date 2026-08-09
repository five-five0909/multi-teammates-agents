# Journal - fifine (Part 1)

> AI development session journal
> Started: 2026-08-07

---


## 2026-08-07 — cross-CLI orchestration milestone

- Initialized Git on `main` and committed executable Expert Team orchestration as
  `e6ddfba`.
- Local evidence: 74 unit/simulated tests, mypy over 38 files, both plugin
  validators, agent drift validation, and no-model Codex/Claude probes pass.
- Kept the Trellis task active: model-backed cross-host E2E and the remaining
  permission/gate/integrity/crash matrices still require evidence.


## Session 1: Implement Expert Team CLI narrative console

**Date**: 2026-08-08
**Task**: Implement Expert Team CLI narrative console
**Branch**: `main`

### Summary

Added terminal-first public narrative rendering for managed Expert Team runs. Integrated the same projection into the MCP expert_team_run text response and local runner, with quiet/json compatibility, manager metadata, audit/rework visibility, Trellis references, privacy redaction, tests, and plugin contract documentation. Full tests, mypy, contract fixtures, Claude agent rendering, host probes, and Codex existing-run smoke passed.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `880fb1b` | (see git log) |
| `09a99c9` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: Expert Team 版本门禁与升级路径

**Date**: 2026-08-09
**Task**: `.trellis/tasks/08-08-expert-team-mode-selection-enforcement`
**Branch**: `main`

### Summary

补充统一版本报告：发布版本、入口协议、Hook 协议和 MCP 工具集指纹由同一
`runtime.versioning` 比较。Codex `+codex.<cachebuster>` 构建元数据按 base
版本兼容；真实不匹配在 prepare 前 fail closed，并返回 `upgrade_required`、
两条 Codex 升级命令和“关闭并重开会话”的下一步。新增
`expert_team_version` MCP 诊断和只读/升级 CLI。

### Testing

- [OK] 105 个单测、mypy（56 文件）、compileall、契约 fixture、Claude agent
  渲染、skill/plugin validator、Claude strict validate、task validate 和
  `git diff --check`。
- [OK] 推送 `049eba3` 后安装缓存为
  `0.4.1+codex.20260808161530`；initialize/tools-list/version/prepare/qualify/start
  冒烟通过。Windows 备份旧缓存警告已记录，未删除任何缓存。

### Status

[IN PROGRESS] 发布号升至 `0.4.1`，代码已推送并完成安装缓存冒烟。当前 Codex
会话工具快照仍不可热加载，必须新开会话后再验证宿主实际调用；既有未归属脏文件
不纳入本轮提交。

## Session 6: 强制 Expert Team 模式入口与收据门禁

**Date**: 2026-08-08
**Task**: `.trellis/tasks/08-08-expert-team-mode-selection-enforcement`
**Branch**: `main`

### Summary

用户批准 PRD/design/implement 后启动 Trellis 子任务。实现统一 mode policy、
session/invocation EntryGateRecord、可归因单选、strict graph qualification、
workspace-bound receipt、幂等 start、DecisionProvenance、MCP compliance projection、
CLI no-action 和 Codex hook guard。Codex/Claude base version 同步到 0.4.0，Codex
cachebuster 通过 plugin-creator helper 刷新。当前会话的工具快照仍缺
`expert_team_prepare`，因此将其记录为 stale/sequential fallback，没有声称入口已运行。

### Testing

- [OK] `python -m unittest discover -s tests -q`（101 tests）
- [OK] `mypy runtime scripts tests`
- [OK] `python -m compileall -q hooks runtime scripts tests`
- [OK] `python scripts/validate_contract.py tests/fixtures`
- [OK] `python scripts/render_claude_agents.py --check`
- [OK] skill/plugin validator 与 `git diff --check`

### Status

[IN PROGRESS] checkout 与安装缓存均已完成 initialize/tools-list、prepare → qualify
→ start → compliance smoke；`codex plugin list` 已显示
`0.4.0+codex.20260808151000`。`codex plugin add` 有一次 Windows 旧缓存备份拒绝访问
警告，但新缓存已启用。当前宿主工具快照仍需重开 Codex/Claude 会话才会热加载；
最后一轮 Trellis check/spec review 已完成，任务保持 in_progress 等待用户验收。


## Session 3: 跨平台插件 MCP 自动注册修复

**Date**: 2026-08-08
**Task**: Long-Horizon Cross-CLI Expert Team Orchestration — MCP portability
**Branch**: `main`

### Summary

复现并修复 Windows/Ubuntu 安装后的 MCP 启动差异：`.mcp.json` 改为 Node
跨平台启动桥，由它选择 Windows 的 `python`/`py -3` 或 POSIX 的
`python3`/`python`；运行时内置 Tomli 兼容层，支持 Ubuntu 22.04 默认 Python
3.10。插件版本和 MCP server 版本提升到 `0.3.1`，并明确安装不会写用户级
Codex/Claude 配置。

### Testing

- [OK] Windows 78 个单测、mypy 47 个源文件、Codex/Claude/plugin/skill 校验。
- [OK] Ubuntu 22.04 WSL 78 个单测；仅有 `python3` 时 MCP initialize 返回
  `expert-team` / `0.3.1`。
- [OK] Trellis research、plugin contract、README 中英文和第三方许可记录已同步。

### Git Commit

- `6557318` — `fix: make bundled MCP launcher cross-platform` (pushed to `origin/main`)

### Status

[OK] **修复完成；父任务仍保持 in_progress，跨宿主模型 E2E 余项未关闭**


## Session 2: 移植 Expert Team 子代理委派纪律

**Date**: 2026-08-08
**Task**: 移植 Expert Team 子代理委派纪律
**Branch**: `main`

### Summary

按用户要求仅修改项目：新增 delegation guardrails，接入 Expert Team 技能，保留 explorer/worker/default 角色与 Trellis 合同；同步中英文 README 与插件规范。未修改或备份用户级 ~/.codex 配置。插件校验、技能校验、20 个 Claude Agent 检查、合约 fixtures、78 个单测和 mypy 全部通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `35203a7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: 强制融合 Expert Team 入口握手

**Date**: 2026-08-08
**Task**: 强制融合 Expert Team 入口握手
**Branch**: `main`

### Summary

新增只读 expert_team_prepare MCP 入口门禁，强制 prepare→qualify→任务图→执行→验证顺序；明确 Codex inline 的 main-session-sequential fallback；同步中英文文档、skill、Trellis 集成规范和回归测试。93 个单测、mypy、compileall、契约 fixture、插件/skill validator 全部通过。父任务仍因跨宿主模型 E2E 和故障矩阵保持 in_progress。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `22f7c66` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: 补充长任务执行顺序、状态跟随与子代理协作文档

**Date**: 2026-08-08
**Task**: 补充长任务执行顺序、状态跟随与子代理协作文档
**Branch**: `main`

### Summary

在 README.md 和 README_zh.md 加入 Mermaid 长任务执行顺序图、事件重放与 state.json 状态跟随说明、verified_progress/abandoned episode 语义，以及 Lead/Researcher/Executor/Auditor/Human gate 的协作边界。通过 93 项单测、mypy、compileall、契约 fixture、Claude agent 渲染、插件校验和 diff 检查；未修改已有运行时代码或 spec。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f768798` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: 刷新插件缓存并验证 Expert Team 强制入口

**Date**: 2026-08-08
**Task**: 刷新插件缓存并验证 Expert Team 强制入口
**Branch**: `main`

### Summary

按 plugin-creator 更新流程为 Codex manifest 加入 0.3.3+codex.20260808134157 cachebuster，放宽测试契约为基础版本一致；推送后从非默认 multi-teammates-agents marketplace 重装。真实缓存目录已加载 entry-gate skill，MCP tools/list 出现 expert_team_prepare，prepare 返回 main-session-sequential/build_graph_then_execute_in_main，qualify 正常；93 单测、mypy、compileall、契约 fixture、Claude agent 渲染、checkout/cache 插件校验均通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e30b296` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: 完成 npm TypeScript 重构验证与远程矩阵

**Date**: 2026-08-09
**Task**: 完成 npm TypeScript 重构验证与远程矩阵
**Branch**: `main`

### Summary

补齐双宿主安装资产、Hook/Subagent 有界证据、CancellationResult 公共契约与 Windows 直接启动；收敛活动 TypeScript 规范；通过 Windows/WSL Node 22/24、本地 tarball、Python 迁移基线及 GitHub 四平台 8 单元矩阵。保留 Claude 未登录和未授权 npm publish 两个外部门禁。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7b93008` | (see git log) |
| `e493bc5` | (see git log) |
| `1d225bd` | (see git log) |
| `be75466` | (see git log) |
| `3b5794d` | (see git log) |
| `09080ae` | (see git log) |
| `d634e50` | (see git log) |
| `eeae7ef` | (see git log) |
| `71cb57d` | (see git log) |
| `170dd9a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 7: Publish npm-only TUI control plane alpha.1

**Date**: 2026-08-09
**Task**: Publish npm-only TUI control plane alpha.1
**Branch**: `main`

### Summary

Removed Git marketplace/plugin MCP surface, added shared five-page TUI, frozen apply/unapply/update/migration plans, exact alpha-channel updates and rollback, published 0.5.0-alpha.1, and migrated Windows plus Ubuntu2204.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `50fe2fd` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
