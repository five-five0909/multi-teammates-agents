# TypeScript 长任务运行时

## Goal

在不删除旧 Python 对照实现的前提下，用 TypeScript 建立可回放、可恢复、可审计的 managed runtime，并以冻结 golden fixtures 证明领域契约、状态机和两轮 Manager → Executor → Auditor 闭环与当前已验证行为一致。

## Requirements

### R1. 单一领域契约

- 使用 Zod 定义版本 1 的 `TaskContract`、`WorkItem`、`RoleResult`、`AuditDecision`、`DecisionProvenance`、`HumanDecision`、`BackendEvent`、`RunEvent` 和 `RunSnapshot`。
- 外部 JSON/JSONL 只允许在契约/codec 边界从 `unknown` 严格解码；拒绝未知字段、非法枚举、重复 ID、脏审计接受和自审计。
- TypeScript 类型和 `schemas/mta/v1/*.schema.json` 从同一 schema 来源生成，序列化字段保持既有 snake_case 协议。

### R2. 纯 reducer 与调度

- reducer 覆盖现有 16 种事件、乐观版本、事件幂等、合法状态转换、重试上限、完成不变量和取消竞争。
- 只有独立 Auditor 的 `accepted + clean + aligned` 决定可以写入 `verified_progress`。
- 依赖图拒绝缺失、自依赖、环、同波依赖；并行写入拒绝相同或祖先/后代所有权重叠。
- 重启时未闭合 Episode 只能变为 `episode.abandoned`，不得改变已接受工作或产生验证证据。

### R3. Trellis 存储

- 新运行仅写 `.trellis/tasks/<task>/mta-runs/<run-id>/`；旧 `runs/` 保持只读且不迁移。
- `events.jsonl` 是唯一事实来源。追加顺序为：严格事件 → fsync 事件日志 → reducer → 原子替换 `state.json`。
- 支持从 `initial.json + events.jsonl` 重放、修复落后快照、拒绝超前/损坏状态、路径逃逸和并发租约。
- 角色结果、审计、人工决定和 trace 在持久化前脱敏；公共状态不包含原始宿主轨迹。

### R4. 有界角色协议与 Supervisor

- Manager、Executor、Auditor prompt 有字符预算，并明确精确、可复制的输出字段。
- structured output 只接受一个严格 JSON 对象，不翻译模型自造字段。
- fake HostAdapter 能由一次 foreground 调用自动完成至少两轮 Manager → Executor → 独立 Auditor。
- 覆盖无效 Manager 输出、执行失败、权限请求、超时、取消、审计污染、返工、预算耗尽、完成确认和恢复。
- 状态查询与 resume 只恢复/读取状态；只有 foreground Supervisor 能启动 Episode。

### R5. 迁移边界

- Python 只用于生成/核验迁移期 golden fixtures，TypeScript 测试和产品运行不能启动 Python。
- 当前工作区中的 Python 取消竞争修复是 golden 语义的一部分。
- 本子任务不接入真实 Codex/Claude 进程、不删除 Python 代码，也不改宿主 manifest；这些由后续子任务完成。

## Acceptance Criteria

- [x] AC1. 所有版本 1 schema 严格解码并生成稳定 JSON Schema；异常字段、枚举和跨字段不变量有单测。
- [x] AC2. TypeScript reducer 对冻结 Python golden events 产生等价快照，并覆盖重复事件、陈旧版本、损坏尾、取消竞争和 abandoned 恢复。
- [x] AC3. 调度器覆盖依赖环、同波依赖、并行所有权重叠、依赖失败和顺序波约束。
- [x] AC4. 存储只创建 `mta-runs/`，证明 event-first、快照原子替换、重放等价、陈旧快照修复、超前快照拒绝和租约冲突。
- [x] AC5. fake adapters 从单次 foreground 调用完成至少两轮完整闭环，且 Executor 结果在审计前不会进入 `verified_progress`。
- [x] AC6. 失败审计返工、全部人工门禁、预算/重试边界、外部取消和重启恢复有 simulated-integration 证据。
- [x] AC7. Auditor 使用独立 episode、只读请求和工作区完整性保护；任何不确定或污染都 fail closed。
- [x] AC8. `npm run build`、`npm run typecheck`、`npm run lint`、`npm test` 和既有 Python 测试通过；发布物仍不包含 Python runtime。

## Out of Scope

- 真实 Codex/Claude 子进程、MCP server、hook dispatcher 和 TUI。
- 旧 `runs/` 数据迁移或删除。
- 删除旧 Python runtime、脚本和兼容入口。
