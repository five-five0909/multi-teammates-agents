# Trellis 生命周期与统一 Hook

## Goal

用纯 TypeScript 完成项目级 Trellis 任务生命周期、风险门禁和 Codex/Claude 统一 Hook dispatcher，并把它们接入 `mta apply/status/unapply` 与 CLI。新入口不依赖 Python，不读取或删除旧 managed run；任何未证明信任、所有权或任务激活状态的写入都 fail closed。

## Requirements

### R1. TypeScript Trellis 生命周期

- 原生定位 `.trellis/tasks/`，实现 `task create|start|current|finish|archive`，不调用 `.trellis/scripts/*.py`。
- 保持 `planning → in_progress → completed/archive`；复杂任务启动前必须具备非占位 PRD、design、implement。
- session pointer 绑定规范化 Git 根、session identity 和活动任务；旧/跨工作区 pointer 不得授权写入。
- task ID、归档路径和所有文件操作必须防路径逃逸；旧 `runs/` 永不迁移或删除。

### R2. 风险门禁

- 统一分类 `read_only / low_risk / managed / human_gate`。
- planning 任务不能实施；managed 写入必须绑定活动 `in_progress` 任务和有效接管回执。
- 破坏性操作、权限提升、预算、取消和完成确认只返回人工门禁，不自动批准。
- Hook 无法确认事件、工作区、信任或所有权时拒绝高风险写入，不能以 PostToolUse 反馈冒充事前阻断。

### R3. 统一 Hook dispatcher

- 一个 TypeScript dispatcher 处理 SessionStart、UserPromptSubmit、PreToolUse、PermissionRequest、PostToolUse、SubagentStart/Stop、Pre/PostCompact、Stop、SessionEnd。
- Codex/Claude 原始输入先归一化为共享 schema；宿主差异只存在于入口映射和输出渲染层。
- SessionStart 注入紧凑活动状态；PreToolUse 是写入门禁；PermissionRequest 只能拒绝或交还宿主；Stop 只做有界续跑建议；SessionEnd 释放本 session 租约并记录中断。
- 公开输出不包含完整轨迹、命令敏感数据、密钥或思维链。

### R4. apply/status/unapply 与 legacy

- 模板为单一来源，apply 生成两个宿主的运行入口、Hook 配置/marker 和 ownership receipt。
- 共享文件使用字段/marker 所有权；unapply 只撤销回执证明仍未漂移的对象。
- status 区分 `installed`、`trusted`、`enforced`；未信任或宿主不支持时报告 partial/FAIL。
- `legacy status` 只读检测旧 Python hook/MCP；`legacy detach --yes` 只停用冲突入口，保留旧任务、run、证据和用户自定义配置。

### R5. MCP 与运行入口

- 提供纯 TypeScript `mta mcp serve` stdio initialize/tools 边界，并保留现有 `expert_team_*` 工具名。
- MCP 工作区绑定来自 Hook/session 写入的规范化项目根，不以插件安装目录或进程 cwd 猜测。
- `run status/resume` 只读；只有 `run foreground` 能调用 Supervisor/未来真实 HostAdapter。
- 本子任务可使用 fake adapter 验证 MCP/CLI 状态一致；真实 Codex/Claude Episode 留到下一子任务。

## Acceptance Criteria

- [ ] AC1. task CLI 完成 create/start/current/finish/archive，拒绝占位复杂任务、路径逃逸、跨工作区 pointer 和 planning 实施。
- [ ] AC2. 风险分类和 PreToolUse 覆盖只读、低风险、managed、破坏性、权限、取消和完成门禁。
- [ ] AC3. 全部 Hook 事件走同一 decoder/dispatcher；Codex/Claude 等价输入得到相同领域决定。
- [ ] AC4. SessionStart/compact/Stop/SessionEnd 只产生有界可恢复状态，租约释放且无敏感数据泄漏。
- [ ] AC5. apply 安装模板和回执，重复 apply 幂等；漂移、并发修改、未信任 Hook 和旧入口冲突有自动化证据。
- [ ] AC6. unapply/legacy detach 只操作证明拥有的入口，保留用户配置、旧任务、`runs/` 和证据。
- [ ] AC7. TypeScript MCP initialize/tool list/status 与 CLI 读取同一 workspace/run，查询和 resume 不启动 Episode。
- [ ] AC8. Windows 与 POSIX Node 24 通过 typecheck、lint、Node/Python 回归、pack 和无 Python runtime smoke。

## Out of Scope

- 真实 Codex/Claude 模型进程、进程树清理和模型驱动 E2E。
- TUI 完整交互体验、联网更新和最终旧 Python 删除。
- 迁移旧 `runs/` 或自动信任项目 Hook。
