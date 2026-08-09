# npm-only TUI 控制面切换

## Goal

把 MTA 从“npm 产品 + Git marketplace 插件”双安装源收敛为唯一 npm 产品源，并将安装状态、宿主配置、版本、更新、诊断和安全撤销统一到 `mta` TUI。消除 Git 插件缓存缺少 `dist/` 导致的 MCP 启动失败，同时保留项目级 TypeScript MCP 和 managed execution。

## Background

- 已复现 Codex marketplace 缓存中的 `bin/mta-plugin-mcp.js` 导入不存在的 `dist/cli/index.js`，导致 `ERR_MODULE_NOT_FOUND` 并在 MCP `initialize` 前退出。
- `package.json.files` 只控制 npm tarball；Git marketplace clone 不包含被 `.gitignore` 排除的 `dist/`，也不会安装 `zod` 依赖或执行构建。
- 官方 npm `multi-teammates-agents@0.5.0-alpha.0` 已发布，隔离全局安装、两个 bin 和 `@alpha` npx 均通过。
- 当前 `mta apply/unapply` 已具备冻结计划、摘要复核、原子提交、所有权回执、漂移保护和失败回滚；TUI、CLI、MCP 应直接复用这些服务。
- FastCtx 的可采纳模式是控制面 TUI、冻结 plan、显式确认、所有权回执、exact 更新和失败回滚；MTA 不复制其 Rust 平台包、GitHub Release、多镜像或 native updater 架构。

## Requirements

### R1. 单一安装与版本来源

- npm 包 `multi-teammates-agents` 是唯一产品安装、版本和更新来源。
- 删除 Git marketplace 运行面、包根插件 manifest、包根 `.mcp.json` 和 plugin-only MCP launcher；不再让 Codex 从 Git 缓存执行 MTA。
- 保留 `mta apply` 生成的项目级 `.mcp.json`、Hook、Skill 和 Claude Agent；这些入口必须指向已安装 npm 包的绝对 Node/JS 路径。
- Alpha 阶段只允许已确认的全局 npm 安装执行自更新；npx 或未知来源仅显示精确安装命令。

### R2. 统一 TUI 控制面

- 无参数且在 TTY 中运行 `mta` 打开唯一控制 TUI；非 TTY 继续输出帮助。
- TUI 首页显示当前版本、可用版本、安装来源、项目接管状态、Codex/Claude 配置状态、MCP 健康、活动 Trellis 任务和 managed run 摘要。
- TUI 提供 Apply、Unapply、Status、Doctor、Update 和配置管理入口；复用现有控制服务，不建立第二套状态或事务逻辑。
- 所有写操作必须先显示冻结预览，再由用户显式确认；取消时零写入。
- 更新使用官方 npm registry 的 exact 版本、隔离 cache、`--ignore-scripts`，失败时恢复先前精确版本并显示重启/re-apply 提示。
- Codex CLI 与 Claude Code 必须同时纳入同一个 TUI；首页、配置预览、Apply、Unapply、Doctor 和迁移状态不得只覆盖其中一个宿主。

### R3. 安全迁移

- 提供旧 Codex marketplace/plugin/MCP 的只读检测和显式一键清理；不得删除其他 marketplace、MCP 或用户配置。
- 当前机器切换时使用 Codex 官方 `plugin remove` 与 `plugin marketplace remove`，删除对象必须精确匹配 `multi-teammates-agents`。
- 旧项目回执继续可读；新 apply 能收敛到 npm-only 模板，并保留用户漂移字节。
- 切换顺序固定为：验证 npm 安装 → 预览旧入口清理 → 清理旧入口 → npm-only apply → MCP initialize/doctor → 新会话复验。

### R4. 发布与验证

- npm tarball 继续包含 `dist/`、双 bin、schema、Skill/Agent 和文档，但不再包含宿主 plugin manifest 或 plugin-only MCP launcher。
- Doctor 通过标准 `bin/mta.js mcp serve --project <root>` 做真实初始化握手。
- Windows、Ubuntu、macOS Intel/arm64 × Node 22/24 继续验证全新 npm 安装、TUI/CLI、apply、项目 MCP、Hook、status、doctor 和 unapply。
- 文档必须明确 lightweight 可不启动 managed runtime，但 managed 模式仍依赖项目级 TypeScript MCP。

## Acceptance Criteria

- [ ] AC1. 从官方 npm 全局安装后，仅运行 `mta` 即可进入 TUI 并看到版本、来源、更新、宿主、项目和 MCP 健康状态。
- [ ] AC2. 仓库和 npm tarball 不再声明 Git plugin MCP；Codex 不会再创建 `multi-teammates-agents@multi-teammates-agents` marketplace 缓存。
- [ ] AC3. TUI Apply/Unapply/Update 均执行 preview → confirm → commit，同 CLI 共用服务；取消零写入，漂移拒绝且失败完整回滚。
- [ ] AC4. npm-only apply 后，Codex 与 Claude 项目级 MCP 使用绝对 npm 入口并完成 initialize；status/doctor 不再调用 `bin/mta-plugin-mcp.js`。
- [ ] AC5. TUI 能精确检测并清理旧 MTA marketplace/plugin/MCP，不影响其他 Codex 配置；当前 Windows 与 Ubuntu2204 迁移有实证。
- [ ] AC6. exact 更新成功后提示重启/re-apply；失败恢复原精确版本；未知安装来源不执行自更新。
- [ ] AC7. 相关单测、隔离 tarball smoke 和四平台 Node 22/24 CI 全部通过，发布证据区分本地、远程和真实 registry。

## Out of Scope

- GitHub Release、镜像 registry 自动选择、平台原生二进制包或 Rust updater。
- Web Dashboard、后台服务或第二套配置数据库。
- 静默删除用户配置、自动接受写操作或绕过 Codex/Claude 权限。
- 本次同时发布 Stable；仍按 prerelease 门禁推进。
