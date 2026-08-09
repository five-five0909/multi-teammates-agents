# Multi Teammates Agents

Multi Teammates Agents（MTA）是面向 Codex CLI 与 Claude Code 的项目级 AI
Harness。它把 Trellis 任务生命周期、Manager → Executor → Auditor 长任务闭环、
独立审计、可恢复 JSONL 状态和人工门禁放进同一个 npm 包。

当前 npm 产品版本是 `0.5.0-alpha.0`。alpha 表示 TypeScript 契约、控制面、
fake-host 运行时和本地打包门禁已经建立，不代表 stable 的真实模型验收矩阵已经通过。

## 环境要求

- Node.js 22 或 24
- Git
- 已由宿主自身完成登录的 Codex CLI 和/或 Claude Code

npm 运行时不需要 Python、Rust、Cargo，也没有安装生命周期脚本。

## 安装

```bash
npm install --global --ignore-scripts multi-teammates-agents@0.5.0-alpha.0
mta --version
multi-teammates-agents --version
```

本次 alpha 验证时，公开 registry 尚未返回该包。在另行明确授权并完成 publish 前，
应先用 `npm pack` 生成本地 tarball，再安装该精确 `.tgz` 路径；不能声称上面的
registry 安装现在已经成功。

也支持一次性运行：

```bash
npx --yes --package multi-teammates-agents@0.5.0-alpha.0 -- mta --help
```

## 接管项目

在 Git 项目内运行。写操作默认只预览，只有加 `--yes` 才提交。

```bash
mta apply --codex --claude
mta apply --codex --claude --yes
mta status --json
mta doctor --json
mta unapply
mta unapply --yes
```

`apply` 合并 MTA 拥有的 hook、MCP 和说明字段，并写入
`.mta/apply-receipt.json`。提交前会复核所有摘要，中途失败会完整回滚。
`unapply` 只恢复回执能证明且没有漂移的内容；用户后续修改会保留并报告。

若检测到精确的旧 Expert Team Python hook/MCP 入口，apply 会拒绝接管。先查看
`mta legacy status`，确认后才执行 `mta legacy detach --yes`。detach 只停用入口，
不会迁移或删除旧 Trellis 任务、run 和证据。

## Trellis 任务

```bash
mta task create "实现功能" --slug implement-feature
mta task start implement-feature --session <session-id> --host codex
mta task current --session <session-id>
mta task finish --session <session-id>
mta task archive implement-feature --session <session-id>
```

planning 状态不能实施。复杂任务必须先具备已审阅的 `prd.md`、`design.md` 和
`implement.md`，再由 `start` 进入 `in_progress`。

## Managed run

新 run 写入活动任务的 `mta-runs/`，旧 `runs/` 永远保持不变。

```bash
mta run start <run-id> --session <session-id> \
  --contract '<TaskContract JSON>' --workItems '<WorkItem[] JSON>'
mta run foreground <run-id> --session <session-id> --host codex
mta run status <run-id> --session <session-id> --json
mta run resume <run-id> --session <session-id> --json
mta run answer <run-id> --session <session-id> --decision '<HumanDecision JSON>'
mta run cancel <run-id> --session <session-id>
```

只有 `foreground` 会启动模型 Episode。Manager 和 Auditor 使用宿主只读模式；
Executor 只能使用宿主正常的可写模式。MTA 不加入审批、sandbox 或 hook 信任绕过参数。
`status` 与 `resume` 只回放持久状态。

可以用 `--config` 明确配置每个角色：

```bash
mta run foreground run-1 --session session-1 --config '{
  "max_concurrency": 2,
  "human_completion_gate": true,
  "roles": {
    "manager":  {"host":"codex"},
    "executor": {"host":"claude"},
    "auditor":  {"host":"codex"}
  }
}'
```

## MCP 与 Hook

`mta apply` 安装项目绑定的 MCP：

```bash
mta mcp serve --project <项目绝对路径>
```

迁移期保留 15 个 `expert_team_*` 工具名。主要 managed 路径是
`expert_team_start` → `expert_team_run` → `expert_team_status`/
`expert_team_resume`，遇到门禁时调用 `expert_team_answer`。CLI、MCP 和 TUI
读取同一个任务绑定与 runtime repository。

Codex 与 Claude 原生事件进入同一个 dispatcher：

```bash
mta hook dispatch --host codex
mta hook dispatch --host claude
```

安装 hook 不等于用户已信任。`mta status` 分开报告 installed、trusted、
enforced；managed 写入必须同时具有可信前置 hook、活动任务和无漂移回执。

## TUI 与更新

在终端直接运行 `mta` 会打开控制 TUI，可查看项目/run 状态、显式启动 foreground、
运行 doctor 和检查更新。启动检查有超时，成功结果缓存 24 小时；离线不会阻塞使用。
除以下命令外，非交互命令不主动联网：

```bash
mta check-update
mta update --version <精确版本>
mta update --version <精确版本> --yes
```

更新使用 `--ignore-scripts` 安装精确 npm 版本。安装失败时会尝试恢复当前精确版本，
并分别报告更新失败和回滚失败。

## 开发与验证

```bash
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test
npm run pack:check
npm run smoke:install
```

安装 smoke 会生成真实 tarball，安装到隔离 prefix，从 PATH 中排除 Python/Cargo，
然后验证两个 bin、npx、apply、hook、MCP initialize、status 和 unapply。CI 覆盖
Windows x64、Ubuntu x64、macOS Intel、macOS arm64，以及 Node 22/24。

## 安全与发布状态

- Executor 输出必须由独立 Auditor 在工作区完整且证据对齐后接受，才能成为可信进度。
- permission、cancel、blocked、budget、ask 和 completion 都进入人工门禁。
- 原始宿主轨迹有大小限制、会脱敏，并与验收证据分开存储。
- stable 必须通过真实 Codex/Claude managed E2E 和完整平台/安装矩阵；不会把
  fake-host 结果冒充真实模型验收。

许可证为 MIT。设计来源与依赖声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
