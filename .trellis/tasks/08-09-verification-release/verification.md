# Verification Evidence

## Product checks

- Windows Node 24.18.0 与隔离 Node 22.23.2: typecheck、lint、80/80 Node 测试通过；真实 tarball 隔离安装通过两个 bin、npx、双宿主 apply、status、hook、MCP initialize 和 unapply，PATH 不含 Python/Cargo/Rust。
- WSL Node 24.14.0 与隔离 Linux Node 22.23.2: typecheck、lint、79 个 Node 测试通过，1 个 Windows-only shim 测试按设计跳过；tarball 隔离安装通过，PATH 不含 Python/Cargo/Rust。
- Node 22 首轮暴露更新超时计时器被 `unref()` 后可能提前结束事件循环；移除 `unref()` 后 Windows/WSL Node 22 均复跑通过。
- Python migration-oracle suite: Windows 与 WSL 均为 105/105 通过。
- WSL 首轮借用 Windows npm CLI 时继承了跨系统 cache 路径；烟测现从第一条 npm 命令起使用临时 cache，复跑后仓库未再生成异常目录。
- 原始方案复核发现 status 只报告本地回执；现已扩展为真实 doctor/MCP 探针和 Trellis session/task 绑定，同时保留轻量状态供 PreToolUse/TUI 使用。
- Codex/Claude 官方 hook 契约复核发现 Stop 输出形态与 compact 恢复缺口；现按 `decision:block` 做一次有界续跑，`stop_hook_active` 后转人工输入，并用不含 transcript/summary 的原子 compact 记录恢复。
- 公共模型复核发现 Apply/Host/Episode/Cancellation 仍有 TypeScript-only interface；现已补齐严格 Zod 边界、`CancellationResult` 不变量和全部 `schemas/mta/v1` 生成一致性检查。
- npm 发布白名单已从整个 `schemas/` 收紧到 `schemas/mta/`，旧 v1/v2 迁移 schema 不进入 tarball。
- 发行面复核发现 npm tarball 原先缺少插件 skill/agent/manifest 资产，导致全局安装后的 `apply` 不能建立宿主发现路径；现由同一 tarball 把共享 skill 纳入 Codex `.agents/skills` 与 Claude `.claude/skills`，把生成的 Claude profiles 纳入 `.claude/agents`，并全部进入同一 ownership receipt、漂移保护和 unapply 回滚。隔离安装 smoke 已覆盖双宿主写入与撤销。
- `status.integrations.<host>.installed` 现同时要求该宿主 hook/settings 与 receipt-owned skill，旧回执缺少 skill 时不再误报完整安装。
- Windows 与 Linux tarball smoke 现从全局安装目录严格读取 Codex/Claude manifest，并通过已安装根 `.mcp.json` 启动 TypeScript MCP initialize；Claude `plugin validate --strict`、marketplace strict validation、skill validator 和 20 个生成 agent 的 registry drift check 均通过。
- Claude 官方 exec-form Hook 在 Windows 不能直接启动 npm `.cmd` shim；项目模板现写入绝对 Node 与已安装 `bin/mta.js`，项目 MCP 使用同一入口。Windows 与 WSL tarball smoke 均直接执行生成后的 Claude SessionStart Hook 和项目 MCP initialize。
- PostToolUse 只持久化工具名、tool-use ID、响应存在性和有界耗时；SubagentStart/Stop 只持久化 agent ID/type 与权限/停止元数据，并把启动身份绑定到当前 Trellis 任务，不记录原始响应、transcript 或 final message。
- 活动 `expert-team-contract.md` 已在用户明确授权后收敛为当前 npm/TypeScript 产品契约，不再把 Python runner、Python MCP launcher、CCSwitch 或第二套路由实现写成正式路径。
- npm registry: `npm view multi-teammates-agents version dist-tags --json` 返回 E404；这说明当前公开 registry 未返回该包或当前账号无读取权限。本任务没有执行 publish，也不把 E404 单独当作最终所有权证明。

## Real host evidence

- Codex CLI 0.147.0 direct read-only Episode 通过。
- Codex real managed E2E 通过：隔离项目、1 轮、4 个唯一 Episode、Manager → Executor → independent read-only Auditor → completion；verified evidence 确认 `evidence.txt` 为 `ALPHA`。
- 该 E2E 首轮暴露 `read-token` 被字段脱敏误伤的根因；修复为只对精确敏感字段名做字段级脱敏，并增加自动回归后复跑通过。
- Claude Code 2.1.220 可启动并产出 stream-json，但真实调用返回 `OAuth session expired and could not be refreshed`；最终只读 `claude auth status` 进一步确认 `loggedIn: false`、`authMethod: none`。未伪造 beta/stable 通过。

## CI evidence

- workflow 定义覆盖 `ubuntu-latest`、`windows-latest`、`macos-15-intel`、`macos-15` 与 Node 22/24。
- 官方 action release 核验后使用 `actions/checkout@v7` 和 `actions/setup-node@v6`；每个矩阵项执行 pack/install smoke。
- 用户明确授权后已推送 `main`。远程运行 [31298351583](https://github.com/five-five0909/multi-teammates-agents/actions/runs/31298351583) 在提交 `71cb57d` 上 8/8 全绿：Ubuntu、Windows、macOS Intel、macOS arm64 的 Node 22/24 均通过 `npm ci --ignore-scripts`、typecheck、lint、80 项 Node 测试、pack 白名单和真实 tarball 隔离安装 smoke。
- 首轮远程矩阵真实暴露 macOS `/var`→`/private/var` 与 Windows 8.3 短路径→长路径差异；Hook 信任边界和测试现统一以 filesystem `realpath` 比较，同一目录别名可通过，越界/不存在路径仍失败关闭。
- 后续安装轮次又暴露全局包入口可能保留短路径拼写；smoke 现比较入口文件的规范身份并继续实际启动生成后的 Claude Hook 与项目 MCP。第四轮远程矩阵完整通过。
- RC 仍保持 false：远程全新 tarball 安装已通过，但 registry 当前 E404，尚无已发布 alpha 可执行真实 registry 升级/失败回滚演练；本任务未获得 `npm publish` 授权。
