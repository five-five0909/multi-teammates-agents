# Multi Teammates Agents

[English](README.md) · [简体中文](README_zh.md)

`multi-teammates-agents` 是一个适配 Codex CLI 和 Claude Code 的专家团插件，
用于协调多个专业 Agent。它同时支持轻量级的原生委派，以及由 Trellis 持久化
管理的长任务模式，提供独立审计、任务恢复、有限重试和人工完成门禁。

本项目不复制 Qoder 的代码，也不依赖 Qoder 服务。Codex 和 Claude Code 仍然
负责 Agent 的执行、权限、并发和原生代码检查；项目内置的本地 MCP 服务负责
可移植的运行状态和证据验收。

## 功能概览

- 在 Codex 中使用 `$expert-team`，或在 Claude Code 中使用
  `/multi-teammates-agents:expert-team`，也支持保守的隐式激活。
- 支持依赖关系图和真实状态报告。
- 六个默认角色：研究员、调试工程师、全栈工程师、代码审查员、QA 和 UI 操作员。
- 二十个独立定义的 ExpertTeam-Codex 专家档案，覆盖软件、产品、设计、基础设施、
  安全和数据库工作。
- 支持 `direct`、`fast`、`bugfix`、`standard`、`audit` 五种轻量工作流，以及软件、
  产品、设计、运维、安全和数据库领域视角。
- 支持并行只读工作，以及受控的、互不冲突的写入范围。
- 原生子 Agent 不可用时自动退化为串行执行。
- 支持通过 `.expert-team/roles/` 添加项目级角色覆盖。
- 轻量模式不写入 Trellis 运行记录。
- 管理模式提供 Trellis 持久化、中断恢复、租约、独立审计、紧凑恢复上下文和人工门禁。
- Codex 与 Claude 的主机事件使用同一套规范化事件契约。

## 插件结构

仓库根目录就是插件根目录：

- Codex 使用 `.codex-plugin/plugin.json`；
- Claude Code 使用 `.claude-plugin/plugin.json`；
- 两者共同加载 `skills/expert-team/`、根目录 `.mcp.json`、共享 Python 运行时和统一
  的专家注册表；
- Claude Code 还会自动发现 `agents/` 下生成的二十个 Agent 定义。

仓库还包含 Codex 的仓库级 marketplace：`.agents/plugins/marketplace.json`。它指向
公开仓库的 `main` 分支，因此不需要把文件复制到 `~/.codex` 就能安装。

对于 Claude Code，`.claude-plugin/marketplace.json` 也提供了同一个仓库级 marketplace，
并使用仓库根目录作为插件源。

不需要外部账户、托管服务或图形化画布即可运行。

## 使用方式

显式调用专家团技能：

```text
$expert-team 调查这个性能回归，实施修复，审查正确性，并验证基准结果。
```

需要明确领域时，可以添加路由提示：

```text
$expert-team security 审计认证边界并报告证据。
$expert-team ops 诊断部署回归并提出可安全回滚的方案。
```

在 Claude Code 中使用带命名空间的技能：

```text
/multi-teammates-agents:expert-team 对这次迁移进行独立 QA 审计。
```

当请求包含多个独立工作流或需要不同专家视角时，Codex 也可以自动激活该技能。
简单问答或机械性小修改不会自动触发专家团。

可以使用 Codex CLI 的 `/agent` 或 Claude Code 的 Agent/上下文界面查看原生工作。
子 Agent 保持宿主平台的权限行为，并会消耗额外 token。插件不会注入权限绕过或沙箱
绕过参数。

### 子代理委派行为

技能会在每一大轮任务前后应用[子代理委派规则](skills/expert-team/references/delegation-guardrails.md)：
小范围、已知位置的内容由主代理直接处理；宽读取、跨文件检索、并行探索或独立审查，
只有在能减少主线程污染或增加核验价值时才派发。探子必须返回带 `file:line` 的证据，
主代理保留方案取舍、写入集成和最终验收权。这些只是项目内规则，安装插件不会修改
`~/.codex/config.toml`、`~/.codex/AGENTS.md` 或用户的 Agent 文件。

## 执行模式

`lightweight` 是适合单次会话、有明确边界任务的默认模式。它使用宿主平台的原生
Agent，不创建 managed run 目录。

对于跨会话、多轮次、证据密集型或需要人工门禁的任务，可以显式选择 `managed`：

```text
Manager -> Executor 执行波次 -> 独立 Auditor 审计波次 -> 合并/返工/门禁
```

内置 Supervisor 负责完整闭环。`expert_team_run` 会为每个角色启动全新的 Codex 或
Claude CLI 进程，收集规范化事件，执行超时/取消控制，并在人工门禁处暂停。
底层的 `next`、`submit_result`、`submit_audit` 工具只用于恢复或集成，不是正常的
日常交互路径。

Executor 的结果在独立 Auditor 接受真实证据前都不会被视为已验证。任务完成还要求
所有必需工作项通过审计，并且人工完成门禁获得批准。

## 命令行叙事控制台

管理模式优先采用命令行输出。Codex/Claude 的 MCP 工具会返回一份公开叙事，包含每轮
Manager 决策、Executor 摘要、Auditor 结果和 Trellis 同步点。本地脚本默认输出相同
叙事；自动化调用可以选择旧 JSON 或紧凑 JSON。

本地入口可以直接查看已有运行记录，不会因此重新启动模型 Episode：

```powershell
python scripts/expert_team_run.py `
  --task-id <trellis-task-id> `
  --run-id <run-id>
```

三种输出模式：

```powershell
# 默认：适合人阅读的 Manager / Executor / Auditor 叙事
python scripts/expert_team_run.py --task-id <task> --run-id <run>

# 兼容旧脚本：输出原来的快照 JSON
python scripts/expert_team_run.py --task-id <task> --run-id <run> --quiet

# 自动化：输出紧凑的公开结构化投影
python scripts/expert_team_run.py --task-id <task> --run-id <run> --json
```

叙事渲染是只读的，只投影经过验证的 Trellis 事件、角色结果、审计、门禁和存储引用。
它不会为了展示而读取原始 Episode 轨迹，也不会输出宿主 stdout、私有思维链、密钥或
未脱敏的命令元数据。

## 安全的并行写入

研究、诊断、审查和 QA 默认是只读的。实现 Agent 只有在负责人分配了明确且互不冲突
的文件或模块时，才可以并行写入。跨范围或重叠修改会被串行化，负责人负责集成和
最终验证。

工作流会选择满足任务所需的最小形态，不会为单个专家任务强行创建团队。重复失败的
门禁最多进行两轮修复和验证，之后报告为 blocked。

## 项目级角色

可以在 `.expert-team/roles/` 下添加 Markdown 定义，用于覆盖或扩展默认角色目录。
格式见 `skills/expert-team/references/expert-catalog.md`。插件不会自动创建这些文件。

## 内置专家目录

完整目录索引位于 `skills/expert-team/references/agent-registry.md`。每个专家都有独立
档案，包含用途、职责、排除范围、证据要求和交接规则。软件、产品和设计协调角色由
当前负责人直接应用，不会被作为嵌套负责人再次派发。

## 管理模式持久化

管理模式状态存储在：

```text
.trellis/tasks/<task>/runs/<run-id>/
```

其中包含不可变初始状态、原子化当前快照、追加式事件、审计记录、工作项尝试、人工
决策和最终报告槽位。体积较大的宿主轨迹单独存放在：

```text
.trellis/workspace/<developer>/traces/<run-id>/
```

事件回放是权威来源；如果中断导致快照过期，系统会根据事件日志修复快照。

可以复制 `examples/expert-team-config.toml` 到 `.expert-team/config.toml` 来定制管理
模式默认值。配置支持全局和按角色设置宿主、模型、超时以及上下文预算。认证仍由
Codex/Claude 当前环境负责，持久化配置会拒绝 key、token、password 和 secret 字段。

在不启动模型 Episode 的情况下检查两个宿主运行时：

```powershell
python scripts/expert_team_run.py --probe
```

## Trellis 约束

管理运行时只会写入已批准任务的 `runs/` 目录，不会修改 Trellis 任务的状态、阶段、
审批或归档状态。没有 Trellis 时，轻量模式仍然可用。

## 校验

```powershell
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
python "$codexHome/skills/.system/plugin-creator/scripts/validate_plugin.py" .
python "$codexHome/skills/.system/skill-creator/scripts/quick_validate.py" skills/expert-team
python -m unittest discover -s tests -p "test_*.py"
python scripts/validate_contract.py tests/fixtures
python scripts/render_claude_agents.py --check
python -m mypy runtime scripts tests
claude plugin validate . --strict
```

## 安装

插件以源码形式分发：不需要执行 `pip install`，也没有额外的包仓库。你需要安装
Git、Python 3.10+，并完成 Codex CLI 或 Claude Code 的登录。轻量模式不依赖 Trellis；
管理模式还要求存在一个已批准且处于 `in_progress` 的 Trellis 任务。

### Codex CLI

先添加仓库自带的公开 marketplace，再安装插件：

```powershell
codex plugin marketplace add https://github.com/five-five0909/multi-teammates-agents.git --ref main --sparse .agents/plugins
codex plugin add multi-teammates-agents --marketplace multi-teammates-agents
codex plugin list --marketplace multi-teammates-agents
```

本地开发时，可以克隆仓库并直接注册本地 marketplace：

```powershell
git clone https://github.com/five-five0909/multi-teammates-agents.git
cd multi-teammates-agents
codex plugin marketplace add .
codex plugin add multi-teammates-agents --marketplace multi-teammates-agents
```

要安装更新后的版本，先刷新 marketplace：

```powershell
codex plugin marketplace upgrade multi-teammates-agents
```

### Claude Code

在当前 Claude Code 会话中加载本地仓库：

```powershell
git clone https://github.com/five-five0909/multi-teammates-agents.git
cd multi-teammates-agents
claude --plugin-dir .
```

也可以不克隆仓库，直接把公开 `main` 分支作为 ZIP 加载到当前会话：

```powershell
claude --plugin-url https://github.com/five-five0909/multi-teammates-agents/archive/refs/heads/main.zip
```

`--plugin-dir` 和 `--plugin-url` 都只对当前会话生效。要持久安装到 Claude Code，
可以添加公开 marketplace 并安装插件：

```powershell
claude plugin marketplace add https://github.com/five-five0909/multi-teammates-agents.git#main
claude plugin install multi-teammates-agents@multi-teammates-agents --scope user
claude plugin list
```

从本地 checkout 开发时，在仓库根目录执行 `claude plugin marketplace add ./`，再按需
使用 `--scope local` 或 `--scope project`。

### 验证与移除

安装后，执行宿主探针和插件校验：

```powershell
python scripts/expert_team_run.py --probe
claude plugin validate . --strict
```

移除 Codex 安装：

```powershell
codex plugin remove multi-teammates-agents --marketplace multi-teammates-agents
codex plugin marketplace remove multi-teammates-agents
```

移除持久化的 Claude Code 安装：

```powershell
claude plugin uninstall multi-teammates-agents
```

移除插件不会删除用户自行创建的 `.expert-team/runs/` 审计文件。

## Qoder 到 Codex 的映射

| Qoder 专家团能力 | Codex 实现 |
|---|---|
| Lead 加多个专家 | Lead Codex 线程 + 原生子 Agent |
| 并行专家工作 | Codex 原生子 Agent 并发 |
| 专家任务列表和状态 | Lead 任务账本 + `/agent` |
| 内置专家 | 内置可移植角色目录 |
| 自定义子 Agent | 项目级角色覆盖 |
| 专家同步 | 原生等待与结果收集 |
| Experts Canvas | 暂不实现；继续使用可检查的原生线程 |

管理模式的生命周期借鉴了 MIT 许可的
[LongHorizon-Harness](https://github.com/AMAP-ML/LongHorizon-Harness) 中可移植的
设计：Manager/Executor/Auditor 分离、独立验证进度、有限轮次、恢复和人工门禁。
当前实现已经包含持久化状态、MCP 控制、真实 CLI Episode Runner、连续 Supervisor
以及受保护的 Auditor 执行。确定性的 fake-process/fake-backend 集成已通过；跨宿主的
模型 E2E 仍由活动 Trellis 任务跟踪，不能提前宣称全部完成。

上游特权启动器默认值和绕过参数没有被引入。

路由和安全规则也吸收了 MIT 许可的
[ExpertTeam-Codex](https://github.com/ReJeCtAll/ExpertTeam-Codex) 中可移植的经验。
项目只适配了领域路由和有限质量闭环，没有复制其直接写入 `~/.codex` 的安装器、旧版
Agent/command 格式或团队运行时假设。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
