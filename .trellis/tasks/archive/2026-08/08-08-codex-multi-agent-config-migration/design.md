# Technical Design: Expert Team 子代理纪律

## Scope boundary

唯一的运行时行为入口是 `skills/expert-team/SKILL.md` 及其 references。用户提供的
`config.toml`、`AGENTS.md` 和 `default.toml` 规则不作为仓库文件复制，避免插件安装
时静默修改主机配置或锁定某个用户的模型。

## Rule placement

在 Expert Team 技能的任务图和派发波次之前增加一段“Delegation guardrails”，覆盖：

1. 何时直接处理、何时派发；
2. 如何写自包含的一轮探查任务；
3. 如何限制递归、越权决策和上下文继承；
4. 如何要求 `file:line` 证据并区分事实/推断；
5. 主代理如何抽查、集成并最终验证。

现有的角色选择、依赖波次、写入 ownership、审计和结果合同继续作为权威规则；新段落
只补充“是否值得派发”和“探子如何回传”的行为纪律，不重定义角色类型。

## Data flow

```text
user request
  -> lead identifies direct work vs independent exploration
  -> self-contained bounded subagent task (read / write / verify)
  -> evidence-first result with file:line anchors
  -> lead samples evidence, integrates disjoint writes, and runs final checks
```

## Compatibility

- Codex 和 Claude 都能理解技能文本；不把 Codex 专属的 V2 配置字段写进技能合同。
- `fork_turns="none"` 作为宿主支持时的优先策略，用条件式措辞避免 Claude 路径出现
  不可用参数。
- `explorer` / `worker` / `default` 仍由现有注册表和任务模式选择，不受用户级 default
  Agent 的固定模型影响。

## Risks and mitigations

| 风险 | 处理 |
|---|---|
| 规则过强导致实现任务无法写入 | 明确“探索/核验默认只读”，同时保留有 ownership 的 worker 写任务。 |
| 新旧规则重复或冲突 | 只在主技能入口增加一段，并链接一个唯一 reference；不创建第二套角色目录。 |
| 用户误以为插件会改主机配置 | README 明确主机级配置不由插件自动修改。 |
| 子代理返回无出处摘要 | 把 `file:line`、事实/推断分离设为回传合同要求。 |
