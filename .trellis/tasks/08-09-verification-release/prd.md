# 跨平台验证与发行切换

## Goal

补齐纯 TypeScript npm 产品的最后操作面和发行门禁：实现精确版本更新、共享状态 TUI、缺失 CLI 契约、真实 doctor 握手、跨平台安装矩阵和文档切换。只有批准方案规定的双宿主真实 managed E2E 等切换条件全部成立后，才删除旧 Python 运行时和重复桥接。

## Confirmed Facts

- Windows 与 WSL Node 24 的 TypeScript/fake-host 测试已通过，Codex 真实只读 Episode 已通过。
- Claude Code 2.1.220 当前 OAuth session 过期且无法刷新；因此 Claude 真实模型 E2E 尚未通过，当前禁止删除旧运行时。
- `.github/workflows/npm-control-plane.yml` 已覆盖 Windows x64、Ubuntu x64、macOS Intel/arm64 和 Node 22/24，但尚未验证 tarball 的全局安装、npx、无 Python/Cargo 和 apply/MCP smoke。
- README、skill、manifest、示例和活动规范现已切换到 npm/TypeScript 路径；用户已明确授权合并 `.trellis/spec/plugin/expert-team-contract.md` 的在途修改。

## Requirements

- 实现 `mta check-update` 和 `mta update [--version <exact>] [--yes]`；registry 响应严格校验，更新只能安装精确版本，并传递 `--ignore-scripts`。失败后尝试恢复当前精确版本，结果明确区分更新失败与回滚失败。
- 更新检查显式命令可联网；TUI 启动检查最多等待有界时间，成功结果缓存 24 小时，离线/超时不阻止使用。其他非交互命令不主动联网。
- 无参数且连接 TTY 时启动轻量 TUI；非 TTY 保持帮助输出。TUI 的项目状态、run status 和 foreground 必须复用 `readProjectStatus`、`BoundRunService` 与 `runForeground`，不维护第二份状态。
- 补齐 `mta run answer`，通过严格 `HumanDecision` 契约写入同一 repository。
- doctor 除命令版本外实际执行本包 MCP initialize，且 MCP 失败会使 required health 失败；Codex/Claude 缺失仍作为可选宿主能力报告。
- 扩展 CI：每个平台/Node 版本构建与测试；单独 pack/install smoke 验证白名单、两个 bin、npx、MCP initialize、无 Python/Cargo PATH 和项目 apply/unapply。
- npm tarball 不得包含 `.py`、旧 schemas、旧 bridge、测试或源 TypeScript；包无 postinstall。
- README、README_zh、skill、manifest、示例和许可证台账切换到 npm/mta 事实；不虚报未完成的 Claude E2E 或 stable 状态。
- 发行证据明确分层：alpha=fake/fixture，beta=真实本地双宿主，rc=三平台全新安装与升级/回滚，stable=完整双宿主模型 E2E。
- 删除旧 `runtime/`、Python hooks/scripts/tests 和重复桥接前，必须重新证明 golden parity、完整 npm 生命周期、Codex/Claude 各一次真实 managed E2E、无 Python 非模型测试、无 `.py` tarball 和全部文档切换。任一项未满足就保留旧文件并记录 blocker。

## Acceptance Criteria

- [x] AC1. update/check-update 通过缓存、离线、超时、精确版本、预览、成功、失败回滚和回滚失败测试。
- [x] AC2. TUI 与 CLI/MCP 读取相同 project/session/run repository；无 TTY 不挂起，启动更新检查不阻塞离线使用。
- [x] AC3. `run answer` 与 doctor MCP initialize 有自动化契约测试。
- [x] AC4. Windows 与 WSL Node 22/24 全绿，CI 定义覆盖四个 runner 与 Node 22/24，并执行 pack/install smoke。
- [x] AC5. tarball 白名单和隔离安装证明两个 bin、npx、apply/hook/MCP/run status/unapply 在无 Python/Cargo PATH 下工作。
- [x] AC6. 英中 README、skill、manifest、示例、notices 与活动 TypeScript spec 不再指导用户走 Python 产品路径。
- [x] AC7. registry 包名/版本可用性有实时证据；不执行未经用户明确授权的 `npm publish`。
- [x] AC8. 真实证据报告明确记录 Codex 通过、Claude 当前认证状态，以及 alpha/beta/rc/stable 各自是否满足。
- [x] AC9. 仅当所有切换门槛满足时删除旧实现；否则保留并给出唯一明确 blocker，不用 fake 结果替代真实 Claude E2E。

## Out of Scope

- Web Dashboard、Codex/Claude 之外的宿主。
- 未经用户明确授权直接发布 npm stable 或修改远程仓库设置。
- 自动迁移或删除旧任务、旧 `runs/` 和用户证据。
