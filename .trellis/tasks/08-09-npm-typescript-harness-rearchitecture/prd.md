# npm + TypeScript Harness 全量重构

## Goal

把现有“Python 运行时 + Codex/Claude 插件仓库”重构为可通过 npm 安装、由项目级 `mta apply` 接管的纯 TypeScript AI Harness。最终用户可在 Windows、Ubuntu 和 macOS x64/arm64 上使用同一个 JavaScript 包，通过 `mta` 管理项目生命周期、双宿主接入和长任务执行。

完整批准方案来源：`C:\Users\fifine\.codex\attachments\aa2904d0-d98e-4bc6-ac71-64c2398216ff\pasted-text-1.txt`。

## Background

- 当前仓库以 Python 实现运行时、MCP、Supervisor、持久化和宿主适配器，并同时维护 Codex/Claude 插件面。
- `temp/Trellis`、`temp/LongHorizon-Harness`、`temp/fastctx` 是本地只读研究源。
- FastCtx 只提供控制面、安装事务、所有权回执和诊断思想；LongHorizon 提供 Manager → Executor → Auditor 闭环；`.trellis/tasks/` 继续是生命周期权威。
- 当前旧任务、旧 `runs/` 和证据必须保留。新运行写入 `mta-runs/`，不导入旧状态。
- Trellis 为 AGPL，FastCtx 为 Apache；不复制其受限实现。项目保持 MIT，并维护来源台账。

## Requirements

### R1. npm 产品形态

- npm 包名为 `multi-teammates-agents`，同时暴露 `mta` 与 `multi-teammates-agents` 命令。
- ESM-only TypeScript，Node.js `>=22`，正式运行不依赖 Python、Rust 或 Cargo。
- 采用单包结构；发布物只包含运行所需的 `dist/`、模板、schema、文档和许可证材料。
- 不使用 `postinstall` 等安装生命周期脚本。

### R2. 控制面

- 提供 `apply/status/doctor/check-update/update/unapply`、`task`、`run`、`legacy`、`mcp serve` 和 `hook dispatch` 命令族。
- `apply` 必须执行“规划 → 并发变更校验 → 原子提交”，失败可完整回滚，并写入 `.mta/apply-receipt.json`。
- `unapply` 只撤销回执证明由 MTA 所有的内容；用户后续改动默认保留并报告漂移。
- 检测旧 Python hook/MCP 冲突时拒绝接管，只有显式 `legacy detach --yes` 可停用旧入口，且不得删除旧数据。

### R3. Trellis 生命周期

- TypeScript 原生实现 `.trellis/tasks/` 的定位、创建、激活、完成、归档和 session pointer，不依赖 Trellis Python 脚本。
- 保持 `planning → in_progress → completed/archive` 语义；复杂任务在实施前必须具备 PRD、design、implement 并获批激活。
- 写入按风险分级；破坏性操作、权限提升、预算、取消和完成确认进入人工门禁。

### R4. 长任务运行时

- 用版本化 Zod schema 统一定义领域模型并生成 JSON Schema。
- 核心状态机、事件回放、原子快照、租约、预算、依赖调度和完成不变量与当前已验证 Python 行为保持语义一致。
- Manager、Executor、Auditor 职责严格分离；Executor 声明不能直接进入可信进度，只有独立 Auditor 接受且完整性检查干净才可晋级。
- 持久化顺序固定为：规范化事件 → `events.jsonl` → reducer → 原子 `state.json` → 公共投影。
- 中断后标记未闭合 Episode 为 `abandoned`，且不重复已接受工作。

### R5. Hook、MCP 与宿主

- Codex/Claude hook 共用一个 TypeScript dispatcher，并覆盖会话、提示、工具前后、权限、子代理、压缩、停止和结束事件。
- MCP、CLI、TUI 读取同一运行状态；状态查询和 resume 不得隐式启动模型，`run foreground` 是唯一执行 Episode 的入口。
- Codex 与 Claude 通过统一 `HostAdapter` 运行全新 Episode，保留宿主权限询问，不增加审批或 sandbox 绕过参数。
- 进程层必须支持流式输出、脱敏、大小限制、AbortSignal、超时、进程树终止和孤儿校验。

### R6. 迁移与收敛

- TypeScript 路线达到切换门槛前保留旧 Python 实现作为对照基线，但不新增第二套长期产品路径。
- 只有 golden parity、npm 安装/apply/hook/MCP/run/resume/unapply、双宿主真实 E2E、无 Python 测试和 tarball 检查全部通过后，才删除旧运行时和桥接脚本。
- 首版只正式支持 Codex CLI、Claude Code；不虚报 Cursor、OpenCode、Gemini 或 Web Dashboard 支持。

## Acceptance Criteria

- [ ] AC1. `npm pack` 生成白名单内的纯 JavaScript 发布物，Node 22/24 可通过全局安装和 `npx` 运行两个命令名，且无 Python/Cargo 依赖或安装脚本。
- [ ] AC2. `apply`、重复 apply、并发漂移拒绝、中途回滚、共享配置保真、安全 unapply 和 legacy detach 均有跨平台自动化证据。
- [ ] AC3. TypeScript task CLI 与 `.trellis/tasks/` 兼容，planning 状态不能实施，in_progress 才能写入，归档和 session pointer 可恢复。
- [ ] AC4. TypeScript schema/reducer 对当前 Python golden events 语义一致，并通过损坏尾、重复事件、并发版本、取消竞争和 crash replay 测试。
- [ ] AC5. fake adapters 完成至少两轮 Manager → Executor → Auditor、失败审计返工、所有人工门禁和中断恢复，已接受工作不重复。
- [ ] AC6. Codex/Claude hook、MCP、CLI 和 TUI 共享状态；未信任 hook 明确报告 partial/FAIL，不虚报强制生效。
- [ ] AC7. 双宿主真实 Episode 均保持权限可见、无绕过参数，超时/取消后无孤儿进程，Auditor 独立且只读。
- [ ] AC8. Windows x64、Ubuntu x64、macOS x64/arm64 上的 Node 22/24 CI 通过构建、类型、lint、单测、pack 和安装矩阵。
- [ ] AC9. 旧任务、旧 `runs/`、用户 agent/hook 和证据未被迁移或删除；新 managed run 只写 `mta-runs/`。
- [ ] AC10. 切换门槛全部满足后删除仓库内旧 Python 运行时和重复桥接，tarball 不含 `.py`，README、技能、manifest 和 Trellis spec 全部指向 `mta`。
- [ ] AC11. alpha → beta → rc → stable 证据明确区分 fixture、fake-host、本地 smoke 和模型驱动 E2E，不用模拟结果冒充真实宿主验收。

## Out of Scope

- 首版支持 Codex/Claude 以外的宿主。
- Web Dashboard 或远程托管/计费平台。
- 自动迁移或删除旧 Python run、任务和证据。
- 复制 FastCtx 或 Trellis 的实现代码。

