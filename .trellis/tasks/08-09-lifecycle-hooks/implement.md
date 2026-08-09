# Implementation Plan: Trellis 生命周期与统一 Hook

## Work Order

- [x] 1. 冻结当前 Trellis task/pointer、旧 Hook/MCP 和 CLI lifecycle 行为夹具。
- [x] 2. 实现 `src/lifecycle` task repository、session pointer、风险分类和门禁测试。
- [x] 3. 实现统一 Hook schemas、Codex/Claude normalizer、dispatcher 与有界恢复投影。
- [x] 4. 建立模板注册表，扩展 apply/status/unapply receipt 到 Hook/共享 marker 所有权。
- [x] 5. 实现 `legacy status/detach --yes` 的精确入口事务与数据保留测试。
- [x] 6. 实现 TypeScript MCP stdio、workspace binding 和共享状态工具。
- [x] 7. 扩展 CLI 的 task/run/mcp/hook/legacy 命令并做无 Python pack smoke。
- [x] 8. 用 trellis-check 完成跨层审计，更新 spec、全量回归和阶段证据。

## Validation Commands

- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `python -m unittest discover -s tests -p "test_*.py"`
- `npm pack --dry-run --json`
- Windows 与 WSL Node 24 执行非模型测试。

## Guardrails

- 不修改或提交用户现有 Python/Hook WIP。
- 不自动信任 Hook，不把 installed 等同 enforced。
- 不以 MCP cwd 猜工作区，不让 status/resume 启动模型。
- 不删除旧任务、`runs/`、trace 或用户自定义 Hook。
