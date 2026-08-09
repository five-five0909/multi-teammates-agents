# Design: npm-only TUI 控制面切换

## Architecture

保留一个 ESM-only npm 包和一个 TypeScript 状态/事务实现。`mta` 无参数 TTY 进入控制 TUI，CLI 子命令继续供自动化使用；两者都调用 `src/control`、`src/lifecycle` 和 `src/runtime` 的同一服务。

系统分成四个边界：

1. **npm product**：唯一安装、版本和更新来源，携带 `dist/`、双 bin、schema、Skill、Agent 与文档。
2. **control plane**：生成冻结 Apply/Unapply/Migration/Update plan，执行摘要复核、原子提交、回滚和 receipt 写入。
3. **TUI projection/effects**：读取统一状态并展示；所有副作用通过显式 Effect 调用 control plane，不持久化第二套状态。
4. **project integrations**：Codex 与 Claude 的项目级 Hook、MCP、Skill 和 Agent。它们由 npm 安装物的绝对 Node/JS 入口驱动，不从 Git marketplace 缓存执行。

## Removed Product Surface

- 删除 `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json`、包根 `.mcp.json` 和 `bin/mta-plugin-mcp.js`。
- npm tarball 不再声明可由 Git marketplace 直接运行的插件。
- 删除 `.agents/plugins/marketplace.json` 中 MTA 自身的 marketplace 发布面，以及相关 drift/manifest 测试。
- 不删除 `src/templates/registry.ts` 生成的项目级 `.mcp.json`；它是 managed 模式的正式入口。

## Control Status Contract

TUI 读取一个组合投影，不引入新数据库：

```text
ControlSnapshot {
  package: { currentVersion, installSource, updateState, targetVersion? }
  project: ProjectStatus
  integrations: { codex: IntegrationStatus, claude: IntegrationStatus }
  migration: { marketplaceInstalled, pluginInstalled, staleMcp, cleanupPlan? }
  trellis: { activeTask?, session?, run? }
  diagnostics: DoctorResult
}
```

`readControlSnapshot` 只聚合现有 `readProjectStatus`、Doctor、update check、Trellis/run repository 和只读 legacy/marketplace probe。写操作不通过 snapshot 反推目标，而是单独生成版本化 plan。

## TUI State and Effects

首版只保留必要页面：

- Overview：版本、来源、更新、项目、双宿主、MCP、Trellis/run 摘要。
- Integrations：Codex/Claude 选择、Apply、Unapply、迁移旧 marketplace/plugin。
- Update：检查、精确目标、预览、确认、结果与重启/re-apply 提示。
- Doctor：Node/npm/Git、双宿主、项目 MCP initialize、receipt 漂移。
- Runs：复用现有 status/resume/foreground/answer/cancel。

副作用统一建模为 `Plan → Preview → Confirm → Commit → Result`。取消返回 Overview 且零写入；提交必须消费原 plan，不能重新计算后静默改变目标。

## npm-only Apply Flow

1. 从当前运行的 npm 包解析 package root、绝对 Node 和 `bin/mta.js`。
2. 生成双宿主变更：项目 `.mcp.json`、Codex/Claude Hook、共享 Skill、Claude Agent、runtime marker。
3. 冻结变更内容及 before/after SHA-256。
4. TUI/CLI 显示同一 preview。
5. 确认后重新校验 before hash，原子提交，receipt-last。
6. 真实启动 `node <absolute-bin/mta.js> mcp serve --project <root>` 并完成 initialize。

## Marketplace Migration

迁移只处理精确身份：

```text
plugin     = multi-teammates-agents@multi-teammates-agents
marketplace = multi-teammates-agents
```

顺序固定：

1. 验证官方 npm 安装与 `mta --version`。
2. 只读探测 Codex plugin/marketplace 和旧 `expert-team` MCP 来源。
3. 生成 CleanupPlan，列出官方 Codex remove 命令和预期配置变化。
4. 用户确认后执行 plugin remove，再执行 marketplace remove。
5. 生成并提交 npm-only project ApplyPlan。
6. Doctor 完成项目 MCP initialize；提示打开新 Codex/Claude 会话。

若清理或 Apply 失败，保留精确错误和当前状态。不得手工猜删其他 TOML 表或 marketplace 目录。

## Update Flow

- npm official registry/dist-tag 是唯一版本权威。
- 自更新前确认当前来源是受支持的 global npm install；未知/npx 来源仅展示精确命令。
- 检查与下载使用隔离 cache；安装固定 `package@exact`、`--ignore-scripts --no-audit --no-fund`。
- 安装后验证 `--version` 和项目 MCP initialize；失败时恢复旧 `package@exact`。
- 成功后提示重启宿主，并对 receipt 版本落后显示显式 Re-apply，不暗改项目。
- 保留现有 24 小时成功缓存和有界启动检查；离线不阻塞 TUI。

## Compatibility

- CLI 命令保持兼容；TUI 是管理入口，不是第二条实现路径。
- 现有项目 receipt 继续解析；下一次 apply 通过 owned paths 收敛模板。
- 旧 Python run、旧 `runs/` 和用户数据不迁移、不删除。
- Lightweight Skill 不要求启动 managed run；Managed 继续通过项目 TypeScript MCP。

## Rollback

- 配置变更由 receipt/hash 和事务日志回滚。
- npm 更新失败恢复旧精确版本。
- 在 npm-only MCP 健康检查通过前，不删除仓库内旧迁移 oracle 数据。
- marketplace 清理后若 npm-only apply 失败，TUI 提供重试 Apply；不自动重新注册 Git marketplace，避免恢复已知错误路径。

## Key Decisions

- npm-only 单一来源优于“npm + Git plugin”双路径。
- TUI 复用服务优于封装 shell 命令或维护独立状态。
- 双宿主同页管理优于分离工具。
- 项目级 MCP 保留；删除的是 Git plugin 根 MCP，不是 managed runtime。
- 首版不引入 FastCtx 的 native updater/helper、多 registry 或 GitHub Release 复杂度。
