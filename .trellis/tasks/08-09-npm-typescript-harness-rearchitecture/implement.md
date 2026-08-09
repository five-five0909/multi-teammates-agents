# Implementation Plan: npm + TypeScript Harness 全量重构

## Work Order

- [ ] 子任务 1：`08-09-npm-control-plane`——建立 npm/TypeScript 基础、CLI 协议、pack/install 门禁和接管事务骨架。
- [ ] 子任务 2：`08-09-typescript-runtime`——移植 schema、reducer、存储、Supervisor、人工门禁和 golden parity。
- [ ] 子任务 3：`08-09-lifecycle-hooks`——实现 Trellis task CLI、风险门禁、统一 hook dispatcher、apply/unapply 完整事务和 MCP。
- [ ] 子任务 4：`08-09-host-adapters`——实现 Codex/Claude 真实 Episode、事件归一化、权限、取消和进程清理。
- [ ] 子任务 5：`08-09-verification-release`——完成跨平台矩阵、真实 E2E、文档切换、旧实现删除和分阶段发布证据。

## Integration Gates

1. 每个子任务先通过其局部 typecheck/lint/test，再进入父任务集成检查。
2. 领域契约冻结前不得接入真实模型；fake-host 闭环通过前不得宣称长任务可用。
3. 双宿主真实 E2E 与无 Python 验证通过前不得删除旧实现。
4. 删除旧实现后重新执行全量测试、pack 白名单、全新安装、apply/unapply 和文档/manifest 扫描。

## Baseline and Risk Controls

- 先记录现有 Python schema、MCP 工具、状态机 golden fixtures 和测试结果。
- 保留当前用户未提交改动，任何重叠文件先重新读取并单独审查。
- `temp/` 仅作只读研究，不进入 npm tarball 或提交。
- 许可证台账记录参考项目 commit、文件、许可证、采用思想与未复制范围。

## Final Validation

- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm pack --dry-run`
- 在无 Python/Cargo 的临时环境验证 pack 安装、两个 bin、apply/status/doctor/unapply 和 MCP initialize。
- 在 Windows、Ubuntu、macOS x64/arm64 的 Node 22/24 矩阵运行非模型验证。
- 对 Codex 与 Claude 分别记录真实两轮、失败审计返工、crash/resume、权限、取消和无孤儿证据。

