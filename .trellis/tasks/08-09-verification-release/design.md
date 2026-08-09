# Design: 跨平台验证与发行切换

## Boundaries

- `src/control/update.ts`：npm registry 查询、24 小时缓存、semver 比较、精确版本更新与回滚。网络和进程依赖可注入，测试不访问真实 registry 或修改全局 npm。
- `src/control/doctor.ts`：现有命令 probe 加本包 MCP initialize 子进程探针。
- `src/tui/index.ts`：只负责交互和渲染，状态与执行调用现有 service；不创建 TUI 专属 store。
- `src/cli/index.ts`：新增 update/check-update、run answer 和 TTY 路由，不复制业务逻辑。
- `scripts/npm-install-smoke.mjs`：从 tarball 安装到隔离 prefix，构造不含 Python/Cargo 的 PATH，并验证两个 bin、MCP 和项目生命周期。
- `.github/workflows/npm-control-plane.yml`：平台矩阵继续运行静态/测试门禁；pack-install job 运行发行 smoke。

## Update Flow

```text
explicit check or bounded TUI check
  → fetch registry JSON with AbortSignal timeout
  → strict version decode + semver compare
  → atomic user-cache write (successful checks only)

mta update
  → resolve exact target → preview
  → --yes: npm install -g --ignore-scripts package@exact
  → failure: npm install -g --ignore-scripts package@current
  → report update and rollback independently
```

## TUI Flow

无参数时仅在 stdin/stdout 都是 TTY 才进入交互。首屏并行读取项目 status 和有界缓存更新结果。run status/foreground 要求显式 session 与 run ID，并调用同一 `BoundRunService`。退出、网络错误或没有 binding 都返回可读信息，不改变 durable state。

## Cutover Gate

删除动作是最后一个独立步骤，不与文档或 TUI 修改混在同一事务。先生成 `cutover-report.json`，每个门槛包含证据和 `passed`。只有全部为 true 才允许删除旧目录；当前 Claude OAuth 失败使该 gate 为 false，因此本阶段先完成所有非阻塞项并保留旧实现。

## Rollback

- update 安装失败尝试恢复运行中的精确版本。
- 项目 apply/unapply 仍由 ownership receipt 回滚。
- 文档/manifest 与运行代码分提交；旧实现删除单独提交，门槛失败时不产生删除差异。
- CI 扩展失败只回退 workflow/smoke 脚本，不影响已验证运行时。
