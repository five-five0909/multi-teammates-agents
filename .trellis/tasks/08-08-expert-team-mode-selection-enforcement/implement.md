# Implementation Plan: Expert Team 模式选择与强制遵循

## Preconditions

- 用户已评审并明确批准 `prd.md`、`design.md`、本文件；任务已通过 `task.py start` 进入 `in_progress`。
- 启动前运行 PRD convergence pass 和 `task.py validate`。
- Codex inline 模式下由主会话实现与检查，不派发 implement/check 子代理；只读研究结果可以作为证据输入。
- 现有未归属脏文件必须保持不动：`.trellis/spec/plugin/expert-team-contract.md`、`runtime/core/reducer.py`、`runtime/supervisor.py`、`tests/test_supervisor.py`。

## Ordered work graph

### W0 — Baseline and ownership guard

- [x] 记录 `git status --short`、当前 task/parent 状态、checkout 与 installed-cache 版本/tool list（当前会话工具表缺 prepare，已记录为 stale/sequential fallback）。
- [x] 把本任务预期修改文件与现有脏文件对比；任何重叠先做 diff ownership 审计。
- [x] 固定 schema/version/cachebuster 发布策略（base 0.4.0，Codex cachebuster 由 plugin-creator 更新）。

Completion check: baseline 写入 task research/check 记录，未知脏文件未被覆盖。

### W1 — Mode contracts and pure policy

Ownership: `runtime/routing.py`、`runtime/core/contracts.py`、对应 unit tests。

- [x] 定义 `ModeAssessment`、`ModeDecision`、`QualificationReceipt` 严格 schema。
- [x] 将 `explicit` 从硬覆盖改为安全偏好；实现 policy floor、eligibility、reason codes。
- [x] 分离 execution tier 与 host execution mode。
- [x] 添加 hard-trigger、ambiguous、verified selection、legacy downgrade、invalid input 的回归测试。

Completion check: `explicit=lightweight + durable_audit` 等组合全部无法降到 managed floor 以下；无选择时不默认 lightweight。

### W2 — Entry-gate store and service transitions

Ownership: 新的最小 entry-gate module、`runtime/service.py`、store/service tests。

- [x] 实现 session/invocation-scoped 原子 EntryGateRecord。
- [x] 分离 plugin runtime root 与 verified user workspace；task/store lookup 只能发生在 receipt 绑定的 workspace。
- [x] 让 prepare 幂等创建/恢复 assessment。
- [x] 实现 select/cancel、可信 source 校验、冲突决定处理。
- [x] qualification 强制接收 strict contract/graph，并生成 receipt。
- [x] start/auto_start 验证 receipt、task status、contract/graph fingerprint 和 idempotency。
- [x] 添加 duplicate、stale record、privacy/redaction、workspace drift 回归测试；重启/迟到事件继续由既有 Trellis store/supervisor 覆盖。
- [x] 将人工 gate 接入 `DecisionProvenance`，拒绝调用方自报 `actor=user`。

Completion check: 直接 qualify/start、伪造 source/actor、错误 workspace、字符串 work_items、重复冲突操作全部 fail closed，且失败不创建 run。

### W3 — MCP surface and compliance projection

Ownership: `runtime/server/mcp_stdio.py`、console/projection、MCP tests、fixtures。

- [x] 更新 `expert_team_prepare` schema/description。
- [x] 新增 `expert_team_select_mode`。
- [x] 收紧 `expert_team_qualify` 和 `expert_team_start` schema。
- [x] MCP initialize/prepare 返回 contract/toolset/version fingerprint。
- [x] 增加合规结果 projection（`expert_team_compliance`）。
- [x] 错误路径 fail closed 并返回可执行的状态/原因/下一步文本。

Completion check: tools/list、正常路径、每个非法跳步、no-action 和错误结构测试通过。

### W4 — Codex/Claude host gate and single-select adapter

Ownership: plugin hooks、hook runtime/launcher、host fixtures、manifests。

- [x] 添加 `UserPromptSubmit` 检测与 invocation context 注入脚本。
- [x] 添加 `PreToolUse` 阶段守卫，覆盖项目可观察的 Bash/apply_patch/MCP/local tools。
- [x] 无原生选择能力时输出 `selection_required`/`needs_input`，不自动代选。
- [x] Codex/Claude 共享 MCP/contract 语义；宿主 hook 只做最小输入输出适配。
- [x] hooks disabled/untrusted/unsupported tool path 时输出 `advisory`/`partial`。
- [ ] 插件 manifest 不声明当前 Codex 不接受的 `hooks` 字段；按 plugin-creator 约束保留脚本和项目 hook 配置，待宿主官方支持后再启用 manifest 声明。

Completion check: fixture 证明 selection pending、task consent、planning、stale/cancelled 阶段的非法写入会被阻断，合法只读/规划操作可执行。

### W5 — Trellis lifecycle integration

Ownership: `skills/expert-team/**`、必要的 runtime Trellis adapter/tests。

- [x] 更新 entry-gate、README 和 plugin code-spec；managed-mode/trellis-integration 的现有状态权威保持不变。
- [ ] 把 G0-G6 作为证据门禁接入，不复制 task lifecycle。
- [ ] 规划评审 receipt 绑定稳定 task ID/status/path。
- [ ] 父子任务仅作组织关系；WorkItem dependencies 保持显式。
- [ ] inline managed 明确走 `main-session-sequential`。

Completion check: transcript fixtures 无法伪造 consent、跳过 planning review 或把 inline 等同 lightweight。

### W6 — Recovery, cache, and cross-host regression matrix

Ownership: tests、scripts validators、installed-cache smoke fixtures。

- [ ] 覆盖 MCP restart、compact/new session、task drift、duplicate run、cancel/late result。
- [ ] 覆盖 checkout vs installed cache tools/list/version/skill contract。
- [ ] 从安装缓存启动 MCP，证明 task lookup 使用用户 workspace 而非 plugin cache root。
- [ ] 覆盖旧会话 stale、重装后新会话、cachebuster、Claude package base version。
- [ ] 覆盖 hook trusted/untrusted、interactive/noninteractive、native single-select/fallback。
- [ ] 把历史 simulation 失守链做成 transcript conformance regression。

Completion check: PRD AC1-AC22、AC26-AC28 均映射到至少一个自动化测试或明确的宿主 E2E 证据。

### W7 — Documentation, spec, release, and final verification

Ownership: `README.md`、`README_zh.md`、`.trellis/spec/plugin/expert-team-contract.md`、version manifests、task check notes。

- [x] README/README_zh 已补模式单选、收据、长任务状态跟随、inline/subagent 和 hook 边界说明。
- [x] 已记录 hooks 的强制边界、升级/重开会话、回滚和诊断步骤。
- [x] Codex/Claude base version 同步为 0.4.0，并用 plugin-creator 更新 Codex cachebuster。
- [ ] 从安装缓存运行完整 prepare/select/qualify smoke（当前 host 会话工具表缺 prepare，需新会话/重装后完成）。
- [x] 已运行当前范围的完整检查；trellis-check/trellis-update-spec 的最终门禁待最后一轮执行。
- [ ] 形成按所有权分组的 commit 计划；未知脏文件单列，不自动 push。

Completion check: AC23-AC28 通过，用户审核最终合规报告后才进入 finish/archive。

## Validation commands

实施阶段按从小到大顺序运行：

```powershell
python -m unittest tests.test_runtime_foundations tests.test_service_mcp
python -m unittest discover -s tests -p "test_*.py"
python -m mypy runtime scripts tests
python -m compileall runtime scripts tests
python scripts/validate_contract.py tests/fixtures
python scripts/render_claude_agents.py --check
python "$env:USERPROFILE/.codex/skills/.system/skill-creator/scripts/quick_validate.py" skills/expert-team
python "$env:USERPROFILE/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py" .
claude plugin validate . --strict
python ./.trellis/scripts/task.py validate .trellis/tasks/08-08-expert-team-mode-selection-enforcement
git diff --check
```

Installed package smoke 还必须执行：

```powershell
codex plugin marketplace upgrade multi-teammates-agents
codex plugin add multi-teammates-agents@multi-teammates-agents
codex mcp list
```

随后从实际 cache root 启动 MCP，核对 initialize、tools/list、prepare、select、qualify；重开 Codex 会话再验证 skill locator 与工具表。

## Acceptance traceability

| Work item | Primary acceptance criteria |
| --- | --- |
| W1 | AC1-AC3, AC9 |
| W2 | AC5-AC8, AC13-AC16, AC22, AC26-AC27 |
| W3 | AC3, AC6-AC8, AC20-AC21 |
| W4 | AC4, AC10-AC12 |
| W5 | AC9-AC10, AC19, AC25 |
| W6 | AC14-AC20, AC23, AC26-AC28 |
| W7 | AC18, AC23-AC28 |

## Risky files and rollback points

- `runtime/routing.py`：先合入纯策略与测试；若失败可独立回滚，不触碰 run state。
- `runtime/server/mcp_stdio.py`：tool schema 是跨宿主边界，必须与 skill/docs/fixtures 同批同步。
- plugin hooks/manifests：先本地 fixture，再 checkout smoke，再 cache 安装；发现误拦截时可禁用 hooks 发布，但 runtime receipt 仍保持 fail closed。
- `runtime/service.py`：start/qualify 收紧可能破坏旧调用方；兼容期只允许安全升级，不恢复不安全降级。
- `.trellis/spec/plugin/expert-team-contract.md` 当前已有用户未提交改动；实现前必须逐行识别归属，不能覆盖或整文件重写。

## Stop conditions

- 用户尚未批准 planning artifacts；
- 当前会话/plugin toolset stale 且无法在新会话验证；
- hook 在目标宿主没有可阻断的必要工具覆盖，却仍被要求宣称 fully enforced；
- qualification receipt 设计需要复制 Trellis task state；
- 同一门禁连续两轮修复/验证仍失败。

命中 stop condition 时保留证据并报告 blocked，不用新增兼容补丁掩盖问题。

## Before `task.py start`

- [x] 用户已评审并明确批准本 PRD/design/implement。
- [x] PRD convergence pass 完成，无重复/已解决 open question。
- [x] 三个只读研究工作项的证据已归档到 `research/`。
- [x] `task.py validate` 通过；inline 模式明确记录跳过 JSONL 的原因。
- [x] 当前脏文件所有权重新核验。
- [x] 只运行一次 `task.py start`，子任务已从 `planning` 变为 `in_progress`。
