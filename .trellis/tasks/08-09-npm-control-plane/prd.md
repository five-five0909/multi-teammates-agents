# npm 控制面与发行基础

## Goal

建立可安装、可测试、可发布的 Node.js `>=22` TypeScript 单包基础，并交付稳定的 `mta`/`multi-teammates-agents` CLI 协议与项目接管事务最小闭环，为后续运行时迁移提供唯一产品入口。

## Requirements

- ESM-only TypeScript 单包，两个 bin 指向同一个已构建入口。
- 提供 build、typecheck、lint、test、pack 检查；运行依赖保持最小化，禁止 postinstall。
- CLI 先实现 `--help`、`--version`、`status`、`doctor`、`apply` dry-run/commit、`unapply` 和 JSON 输出/退出码契约。
- apply 定位可信 Git 根，拒绝 HOME/磁盘根，冻结计划并在提交前校验摘要。
- 所有写入使用同目录临时文件和原子替换；部分失败按事务日志回滚。
- receipt 记录版本、项目根、宿主、对象级所有权、写前状态和写后摘要。
- unapply 只撤销无漂移且由 receipt 拥有的对象；漂移内容保留并报告。
- Windows 空格/Unicode 路径、POSIX 路径和 npm `.cmd` 入口均纳入测试。

## Acceptance Criteria

- [x] AC1. `npm run build/typecheck/lint/test` 全部通过，两个 bin 的 `--help` 和 `--version` 输出一致。
- [x] AC2. `npm pack --dry-run` 只包含白名单文件，包内无 `.py` 运行时、`temp/`、测试缓存或安装脚本。
- [x] AC3. 从 tarball 在临时目录安装后，无仓库源码和无 Python 环境仍可运行 help/status/doctor。
- [x] AC4. apply dry-run 不写文件；commit 成功写入 receipt；重复 apply 幂等。
- [x] AC5. 提交前并发漂移会拒绝写入；中途故障完整回滚；无 receipt 时 unapply 拒绝猜测删除。
- [x] AC6. 用户修改后的共享内容不被 unapply 覆盖或删除，诊断明确列出漂移和保留原因。
- [x] AC7. Windows 与 POSIX 路径测试覆盖 Git 根、HOME/磁盘根拒绝、Unicode、空格和原子替换。

## Out of Scope

- 本子任务不移植长任务状态机、真实 HostAdapter、完整 Trellis task CLI 或模型 E2E。
- 本子任务不删除现有 Python 代码，只建立替代入口和迁移门槛。
