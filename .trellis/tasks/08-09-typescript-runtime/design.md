# Design: TypeScript 长任务运行时

## Architecture

保持一个 npm 包，新增三层边界：

- `src/runtime/core/`：Zod schemas、codec、纯 reducer、图校验与调度；不访问文件系统或宿主。
- `src/runtime/storage/`：Trellis run repository、JSONL、原子快照、租约和脱敏持久化。
- `src/runtime/supervisor/`：有界 prompts、strict parsers、HostAdapter 接口、完整性 guard 和 Manager → Executor → Auditor 控制循环。

宿主差异只通过 `HostAdapter` 注入。本阶段测试使用 fake adapter，真实 Codex/Claude adapter 留到后续子任务。

## Data Flow

```text
unknown JSON
  → Zod decode
  → normalized RunEvent
  → append + fsync events.jsonl
  → pure reducer
  → atomic state.json
  → typed public projection

foreground Supervisor
  → Manager episode
  → dependency-ready Executor episodes
  → persisted RoleResult
  → separate read-only Auditor episode + workspace diff
  → persisted AuditDecision
  → reducer-controlled verified_progress / rework / human gate
```

所有消费者读取已解码类型或 reducer 快照，不在 CLI、storage 或 supervisor 内局部强转事件 payload。

## Persistence Layout

```text
.trellis/tasks/<task>/mta-runs/<run-id>/
  contract.json
  initial.json
  events.jsonl
  state.json
  rounds.jsonl
  decisions.jsonl
  work-items/<id>/attempt-<n>.json
  audits/<id>/attempt-<n>.json
```

大型 backend trace 继续隔离在 `.trellis/workspace/<developer>/traces/<run-id>/`。路径 ID 使用白名单校验并在解析后的根目录内二次验证。

## Schema and Golden Strategy

Zod schema 是运行时、类型和 JSON Schema 的单一来源。冻结 fixture 记录输入事件与期望最终快照，TypeScript 测试直接读取 JSON，不调用 Python；迁移期另有显式 parity 工具用于人工更新 fixture，避免形成生产 fallback。

为避免覆盖仍被 Python 使用的旧 schema，本阶段生成到 `schemas/mta/v1/`。切换阶段再统一入口并删除旧 schema。

## Failure and Recovery

- 事件写入失败：不更新快照。
- reducer 拒绝事件：事件不得落盘。
- 事件已落盘但快照写入失败：下次 load 由事件日志重放并修复落后快照。
- 快照领先事件日志或 JSONL 损坏：fail closed，返回恢复诊断。
- controller 重启：扫描 unmatched `episode.started`，追加 `episode.abandoned`，只重试未接受工作。
- 并发 writer：使用短租约和 `expected_version`；不得静默覆盖。

## Key Decisions

- 保持 snake_case wire shape，避免迁移期引入双向字段转换。
- reducer 使用一个 exhaustive switch，事件分类不散落到多个消费者。
- 存储按 event-first 落盘，遵循父任务已批准的事实来源顺序。
- `mta-runs/` 与旧 `runs/` 物理隔离，回滚只需停用新入口，不触碰旧证据。
- 完整性不确定等同失败；不自动恢复 Auditor 造成的未知修改。

## Validation Levels

- `unit`：schema、codec、reducer、调度、parser、storage。
- `simulated_integration`：fake adapters 的多轮 Supervisor、门禁、取消和 restart。
- 真实 CLI/model-backed 证据在后续 host-adapters 与 verification 子任务完成。
