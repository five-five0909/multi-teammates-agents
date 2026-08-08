# Codex 子代理逻辑移植到 Expert Team 插件

## Goal

把用户提供的“子代理作为探子”的工作纪律移植到本项目的 Expert Team 技能中，
让插件在需要宽范围读取、独立核验或并行探索时主动委派，同时避免上下文污染、
递归派生和子代理越权做最终决策。

## Confirmed facts

- 本次只改当前仓库，不修改、不备份、不读取后写入用户本地 Codex 配置。
- 用户级 `~/.codex/config.toml`、`~/.codex/AGENTS.md` 和 `~/.codex/agents/default.toml`
  仅作为参考，本任务不对它们执行任何写操作。
- 项目 `skills/expert-team/SKILL.md` 已有依赖感知的任务图、读写所有权、角色选择和
  最终验证规则，是移植逻辑的主入口。
- 项目已有 `explorer`、`worker`、`default` 三类任务角色；本次不删除、不禁用、不把
  它们统一替换成 `default`。
- 项目 `.codex/config.toml` 明确不声明结构化 `[features.multi_agent_v2]`，以保持
  Codex 版本兼容；本次不改变该边界。

## Requirements

### R1. Delegation decision rules

- 直接处理：已知位置的小文件、少量代码、单一事实、即将修改的具体代码、以及作为
  全局地基的架构/设计/交接文档。
- 适合派发：巨型文件、跨文件/跨目录检索、相互独立的探索或核验、长任务中的现状复查、
  会产生大量外围日志的读取。
- 只有在能减少主线程上下文污染、提高并行度或提供独立核验时才派发；不为转述上下文
  或单个简单问题制造子代理。
- 就绪的独立只读任务应并行派发；写任务必须有互不重叠的明确 ownership。

### R2. Subagent contract

- 委派提示必须自包含，写清范围、问题、排除项和期望产出。
- 探索/检索/核验子代理默认只读，不做方案取舍、最终判断或最终集成。
- 子代理不得递归派生；宿主支持时优先使用 `fork_turns="none"`，避免复制主线程历史。
- 回传必须紧凑、证据优先，关键结论带准确的 `file:line`、符号名和必要原文。
- 明确区分“看到的事实”和“推断”，不把猜测包装成事实；一轮任务结束后返回结果。

### R3. Lead ownership and safety

- 主代理负责需求理解、任务拆分、方案取舍、写入集成、冲突解决和最终验证。
- 子代理结果只作为线索，主代理按其出处抽查关键结论，不无目的重复整篇重读。
- 保留现有 Expert Team 的 `explorer` / `worker` / `default` 角色语义：通用探子纪律
  约束行为，角色类型仍由任务模式和领域需要决定。
- 保留现有 Trellis 审计、独立 Auditor、写入 ownership 和两轮修复上限。

## Acceptance Criteria

- [ ] `skills/expert-team/SKILL.md` 包含可执行的委派决策、子代理回传和主代理责任规则。
- [ ] 新增或更新的参考文档与主技能入口互相链接，不出现第二套冲突的委派规则。
- [ ] 文档明确禁止递归派生、越权决策和无收益的单任务派发，并保留可验证证据要求。
- [ ] 现有 `explorer`、`worker`、`default` 选择逻辑、写入 ownership 和 Trellis 审计规则不变。
- [ ] 用户级 Codex 配置文件的内容、时间戳和 Git 状态不因本任务发生写入变化。
- [ ] 插件/技能校验、生成 Agent 检查、合约 fixtures、单元测试和 mypy 通过。

## Out of scope

- 不修改或备份 `%USERPROFILE%\.codex\` 下任何文件。
- 不新增固定模型、并发上限、等待超时、工具命名空间或用户级 `default.toml`。
- 不修改 Codex/Claude 安装包、Trellis 状态机、专家注册表或 managed run 合同。
- 不把用户私有配置、凭据或完整用户级 `AGENTS.md` 提交进仓库。

## Decision

采用“项目技能内移植通用纪律、主机配置保持用户自理”的方案。这样安装插件不会产生
隐式主机副作用，同时能让本项目的专家团拥有一致的探查、证据和委派边界。
