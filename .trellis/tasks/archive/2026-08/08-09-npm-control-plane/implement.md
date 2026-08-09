# Implementation Plan: npm 控制面与发行基础

## Steps

- [x] 冻结当前仓库文件布局、Python MCP 工具/schema、测试命令和 npm 包名可用性证据。
- [x] 建立 `package.json`、lockfile、`tsconfig`、lint、test、build 和 `dist` 约定。
- [x] 实现共享 CLI 入口、help/version、JSON 输出和稳定退出码。
- [x] 实现项目根安全解析、status/doctor 的只读骨架。
- [x] 实现 apply plan、摘要冻结、原子事务、receipt 与回滚。
- [x] 实现安全 unapply 和漂移诊断。
- [x] 增加 Windows/POSIX、空格/Unicode、并发漂移、故障注入和幂等测试。
- [x] 验证 pack 白名单、tarball 安装、两个 bin 和无 Python smoke。

## Validation Order

1. 单个模块测试。
2. `npm run typecheck` 与 `npm run lint`。
3. `npm test`。
4. `npm pack --dry-run` 与临时目录安装 smoke。
5. 检查 git diff，确认未覆盖现有未提交 Python 改动，`temp/` 未进入产物。

## Rollback Points

- 基础工具链提交前不接管任何项目配置。
- apply 事务测试全部通过前，commit 路径保持显式实验状态。
- receipt schema 一旦被后续阶段消费，只允许版本化演进，不做静默破坏性修改。
