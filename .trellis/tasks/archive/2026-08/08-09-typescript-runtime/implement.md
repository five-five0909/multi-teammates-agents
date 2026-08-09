# Implementation Plan: TypeScript 长任务运行时

## Work Order

- [x] 1. 冻结当前 Python worktree 的契约、事件与取消竞争 golden fixtures。
- [x] 2. 引入精确版本 Zod，建立 `src/runtime/core/contracts.ts`，生成 `schemas/mta/v1/`。
- [x] 3. 移植 codec、纯 reducer 和 scheduling，先通过 schema/replay/golden 单测。
- [x] 4. 实现 `mta-runs/` Trellis store、event-first 追加、原子快照、租约、记录与脱敏。
- [x] 5. 实现 prompts、strict parsers、workspace integrity guard 与 HostAdapter fake contract。
- [x] 6. 移植 Supervisor 控制循环、人工门禁、取消竞争和 abandoned 恢复。
- [x] 7. 完成两轮 fake-host integration、全量 Node/Python 回归、pack 白名单检查。
- [x] 8. 更新 managed runtime spec，记录证据与尚未达到的真实宿主门槛。

## Validation Commands

- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `python -m unittest discover -s tests -p "test_*.py"`
- `npm pack --dry-run`

## Guardrails

- 不修改或提交用户已有的 Python WIP 文件；golden 以工作区实际行为为准。
- 不让 TypeScript 测试依赖 Python 可执行文件。
- 不提前实现真实宿主、MCP、hook 或 lifecycle 命令。
- 不删除旧实现；切换门槛属于父任务最后阶段。
