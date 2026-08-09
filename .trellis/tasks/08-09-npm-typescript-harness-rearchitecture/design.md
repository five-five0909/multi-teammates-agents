# Design: npm + TypeScript Harness 全量重构

## Architecture

采用一个 ESM-only TypeScript npm 包：`src/cli` 负责命令协议，`src/control` 负责项目接管事务，`src/lifecycle` 负责 Trellis 与风险门禁，`src/hooks` 负责统一事件分发，`src/runtime` 负责长任务状态机和 Supervisor，`src/adapters` 隔离宿主事件，`src/storage` 负责 JSONL/快照/租约，`src/mcp` 提供 stdio 服务，`src/tui` 提供交互控制面。

模板、schema 与运行代码各有单一来源。Codex 和 Claude 只在 manifest、hook 映射及 HostAdapter 边界分叉，不复制业务状态机。

## Data Flow

1. `mta apply` 解析规范化项目根和宿主能力，生成不可变计划。
2. 计划记录目标对象的原摘要，提交前再次校验并发漂移。
3. 原子写入模板、共享配置的拥有字段/marker，并落盘 ownership receipt。
4. hook dispatcher 把宿主事件归一化为领域事件并执行生命周期门禁。
5. foreground supervisor 通过 HostAdapter 运行 Manager/Executor/Auditor Episode。
6. 每个事件先追加 JSONL，再通过纯 reducer 计算快照，最后原子替换公开状态。
7. CLI、MCP、TUI 读取同一个 repository，不直接修改 verified progress。

## Compatibility and Migration

- `.trellis/tasks/` 与现有 Trellis 文件布局兼容，但实现不调用 Python。
- 新 run 使用 `mta-runs/`；旧 `runs/` 永远只读保留。
- 旧 Python hook/MCP 与新入口冲突时 fail closed；显式 detach 只移除入口。
- Python 与 TypeScript 共存仅用于迁移期 golden 对照；产品切换后删除旧执行路径，不提供 fallback。

## Key Decisions

- 单包优于 monorepo：当前只有一个发布产品，拆包会增加版本、构建和安装复杂度。
- Node `>=22`：避免为已停止维护的旧运行时增加兼容层。
- Zod 为运行时 schema 单一来源：同时提供 TypeScript 类型与 JSON Schema，减少手写契约漂移。
- 事务 receipt 采用对象级/字段级所有权：既能安全 unapply，也不覆盖用户修改。
- 核心只消费规范化事件：防止 Codex/Claude 原始格式污染状态机。

## Rollback

每个子任务形成独立可验证里程碑。切换前不删除旧 Python 代码；若 TypeScript 阶段失败，可停止新入口并保留全部旧数据。`apply` 自身使用事务日志回滚，发布升级使用精确版本，不依赖安装脚本。

