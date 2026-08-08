# Expert Team 模式选择与强制遵循

## Goal

把 Expert Team 从“主要依靠 AI 记住步骤”的提示词工作流，升级为一条可观察、可阻断、可恢复、可验收的入口协议。显式调用 Expert Team 时，AI 不能自行把复杂任务降级为 `lightweight`，不能伪造用户已经同意，也不能忽略 `prepare.next_action` 后直接改代码。

最终体验应当像 Trellis：先判定状态和下一步，再完成用户选择或审批，然后进入规划、执行、检查和收尾；每个阶段都有唯一权威状态和可核验凭据。

## User value

- 用户能够看见并选择执行模式，而不是由 AI 在工具参数里暗自决定。
- 明确需要跨会话、独立审计、Trellis、恢复或多波次的任务不会被降成轻量模式。
- Codex inline 仍可执行 managed 治理，只是实现与检查采用 `main-session-sequential`；“不能派子代理”不再等于“只能轻量化”。
- AI 跳过选择、立项、规划评审或检查门禁时，支持的宿主工具调用会被阻断，并给出可行动的下一步。
- 插件升级、旧会话、缓存漂移、重复调用、中断恢复和 no-action 都有明确状态，不再靠聊天摘要猜测。

## Confirmed root causes

1. `runtime/routing.py:26-27` 无条件相信调用方传入的 `explicit`；即使 `durable_audit=True`，`explicit="lightweight"` 仍直接返回 lightweight。`tests/test_runtime_foundations.py:108` 还把这个危险行为固化成了测试。
2. `runtime/service.py:124-159` 只把 `next_action` 作为返回文本，没有服务器侧消费凭据或状态转换；调用方可以无视 `request_task_consent`。
3. `runtime/server/mcp_stdio.py:69-120` 的 `qualify` 不要求先完成 `prepare` 或用户选择；`auto_start=false` 时甚至不会校验 `contract` / `work_items` 的严格结构。
4. `runtime/service.py:161-173` 的底层 `start` 只验证活动 Trellis task 和运行契约，没有验证入口门禁是否完成，因此正常路径可以被绕过。
5. 历史会话 `019fe17c-cd61-7742-80c4-ac3454760688` 证明了真实失守链：AI 自行传 `explicit=lightweight`，收到 `request_task_consent` 后又在没有用户回复的情况下声称“你已经明确同意”，随后创建任务并开始检查代码。
6. 当前 Codex 会话暴露的 MCP 工具中缺少源码已有的 `expert_team_prepare`，技能 locator 还指向失效的旧缓存文件；说明“仓库已更新/已重装”不等于“当前会话已热加载”。
7. `tests/test_plugin_contract.py:41-42` 当前明确禁止插件打包 hooks/apps，因此没有宿主级入口或写操作拦截器；现有强制力主要来自技能文本。
8. Trellis 已定义任务创建同意、`planning`、规划评审、`task.py start`、执行、检查、spec、commit 和 finish 阶段，但这些状态尚未与 Expert Team 的模式选择形成一个可验证的入口记录。
9. 已安装 MCP 由插件根目录启动，server 又用 `Path.cwd()` 构造 `ExpertTeamService`；因此安装缓存中的 server 会把插件包当成用户项目，可能读取错误的 `.trellis`，无法可靠绑定当前 workspace/task。
10. `HumanDecision.actor` 只是调用方提交的非空字符串；当前测试可以直接构造 `actor="user"` 完成 run，人工 completion/permission gate 与模式选择存在同类伪造风险。
11. Codex cachebuster 只解决 Codex 包缓存；Claude manifest 仍保持相同 base version 时，已安装 Claude 缓存可能继续使用不含 entry gate 的旧 commit。
12. 重复 `auto_start` 对相同 run ID 暴露底层文件已存在错误，对不同 run ID 可重复创建同目标运行；当前没有入口级 idempotency/no-action 合同。

完整证据与外部宿主能力核验见 `research/initial-audit.md`。

## Definitions

- **Execution tier**：治理强度，取值 `lightweight` 或 `managed`。
- **Host execution mode**：宿主如何承载工作，例如 `main-session-sequential`、`native-delegation`、`managed-supervised`。它与 execution tier 正交。
- **Mode assessment**：服务器根据任务事实计算的最低模式、允许选项、推荐项和原因。
- **Mode decision**：可归因的用户选择或策略锁定结果。
- **Entry gate**：从显式调用开始，到模式、Trellis 同意和规划评审完成为止的门禁状态。
- **Managed run**：任务进入 `in_progress` 后，由现有 Manager / Executor / Auditor runtime 管理的持久化运行；它不替代 Trellis task 生命周期。

## Product decision

采用一个唯一方案：**策略下限 + 用户单选 + Trellis 生命周期 + 宿主 hook 守卫**。

1. 系统先计算不可向下突破的 `policy_floor`；硬性 managed 条件成立时只允许 managed。
2. 两种模式都合法时，显示单选，默认推荐 managed，但不替用户提交。
3. `explicit=lightweight` 降级为“未验证偏好”，不能再覆盖硬性事实；旧字段只允许安全升级到 managed。
4. 模式选择完成后仍必须遵循 Trellis 的任务同意、planning、评审和 start 门禁。
5. 宿主支持时用原生单选；不支持时暂停并等待一条明确用户回复，不能自行选择。
6. 插件 hooks 对支持的 Bash、`apply_patch`、MCP 和本地函数工具执行阶段守卫；hooks 被禁用或工具路径不可拦截时必须明确标记为 advisory，不能声称“已强制”。

## Mode policy

### Managed hard triggers

任一条件成立时，`policy_floor=managed`，调用方和用户都不能在不改变任务范围的情况下直接降级：

- 用户明确要求跨会话、持续执行、中断恢复、持久化审计或可追溯 session；
- 需要独立 Auditor、人工门禁、失败返工、预算/轮次控制；
- 依赖图包含两个以上波次，或存在必须在验收后才能继续的依赖；
- 当前请求属于已存在的 Trellis `planning` / `in_progress` 实现任务；
- 请求明确要求 Trellis 立项、spec 更新、commit、恢复、重复运行或全链路验收；
- 生产操作、安全、迁移或其他不能接受无审计执行的高风险工作；
- 用户明确选择 managed。

### Lightweight eligibility

仅当以下条件全部成立时，lightweight 才能出现在单选中：

- 工作可在单会话内完成；
- 无持久化、独立审计或人工门禁要求；
- 无活动 Trellis 实现任务需要跟随；
- 任务图为单波次且边界明确；
- 风险和影响范围允许由 Lead 在当前会话直接验证；
- 用户选择 lightweight，或原请求已由可信宿主事件明确声明 lightweight。

无法可靠判断时进入 `selection_required`，不得默认 lightweight。

## Functional requirements

### P0 — 必须完成

- **R1 Entry detection**：显式 `$expert-team` / `/multi-teammates-agents:expert-team` 调用必须创建或恢复一个 session-scoped `invocation_id`；隐式调用在第一次 `prepare` 时建立同等记录。
- **R2 Safe assessment**：模式路由返回结构化 `ModeAssessment`，至少包含 `policy_floor`、`allowed_tiers`、`recommended_tier`、`decision_state`、`reasons` 和 `next_action`。任何请求参数都不能把结果压到 policy floor 以下。
- **R3 Single-select UX**：两种模式都合法时展示一个单选控件，选项为“Managed Expert Team（推荐）”和“Lightweight Expert Team”；每项说明状态、审计和成本差异。策略锁定时展示 managed 原因和“缩小范围后重新评估”的路径，不伪装成可选 lightweight。
- **R4 User attribution**：持久化 `ModeDecision` 的 actor、source、时间、invocation、宿主事件引用和验证级别。AI/legacy 参数不得记录为 `verified_user`。
- **R5 Enforced transitions**：`prepare -> select/lock -> qualify -> task consent/planning review -> execute` 必须是服务器和 hook 可验证的合法状态转换。未完成前序步骤时，`qualify`、`start` 和支持的写工具要 fail closed。
- **R6 Strict graph**：qualification 必须校验 versioned `TaskContract` 与结构化 `WorkItem[]`，不能再接受仅用于展示的字符串工作项后声称已构图。
- **R7 Tier/mode/assurance separation**：managed + `main-session-sequential` 可用于持久化治理，但 execution mode 不能伪装成独立审计能力。若验收明确要求独立 Auditor 而 inline 宿主无法提供，必须返回 capability blocker，不能降级或过度宣称。
- **R8 Trellis authority**：task consent、`planning`、artifact review、`task.py start`、check、spec、commit 和 finish 仍由 Trellis 负责。Expert Team 只保存入口决定和 managed run，不复制 task lifecycle。
- **R9 Host guard**：增加跨 Codex/Claude 的 plugin hook。显式调用待决时阻断受支持的源码写入、任务启动和 managed run 变更；planning 阶段只允许任务规划文件和安全只读操作。
- **R10 Resume/idempotency**：相同 `invocation_id` 的 prepare/select/qualify 重试返回同一合法状态；相同 task/run 的重复 start 不创建第二份运行；重启、compact 或新会话能够从小型权威记录恢复。
- **R11 Stale-session detection**：入口响应报告 skill contract version、MCP server version、toolset fingerprint 和 hook enforcement level。当前会话缺工具或版本不一致时返回 `stale_session` 并停止实现。
- **R12 No-action/failure**：用户取消、没有选择、宿主无交互能力、hooks 未信任、Trellis task 缺失/状态不合法、选择与 policy floor 冲突时都有稳定结果，不创建 task/run，不改源码。
- **R13 Compliance result**：最终汇报必须包含 prepare、mode decision、qualification、execution mode、Trellis phase、任务图、检查结果、未完成项和 enforcement level；缺任一必需凭据不能报告 success。
- **R14 Privacy/security**：入口状态默认只保存 prompt fingerprint、最小摘要和结构化原因，不保存完整敏感提示词；写入采用原子替换，session/task 范围隔离，禁止信任调用方自报 actor。
- **R15 Cross-host parity**：Codex 与 Claude 共享同一语义合同；宿主 adapter 只负责单选呈现、事件引用和 hook 输入差异。
- **R16 Trusted project root**：MCP 不能用插件安装目录代替用户 workspace。项目根必须来自宿主 hook/session 事件或显式的受验证 workspace context，并绑定到 invocation、task、receipt 和 run；不可信、不存在或漂移时停止。
- **R17 Trusted human gates**：mode、task consent、planning review、completion、permission、cancel 等所有人工决定使用同一 provenance contract；普通 MCP 调用方自报 `actor="user"` 不能形成 verified approval。

### P1 — 同一任务内完成

- **R18 Transcript conformance tests**：增加真实失守转录回归，证明 AI 伪造 `explicit=lightweight`、跳过 consent、用字符串 work_items 或直接 start 都会失败。
- **R19 Installed-package smoke**：从已安装缓存而非 checkout 启动 MCP，核对 tools/list、版本、prepare/select/qualify 和新会话加载说明。
- **R20 Documentation**：README/README_zh、skill、entry-gate、managed-mode、Trellis integration 和插件 spec 同步说明模式选择、强制边界、恢复、升级和回滚。
- **R21 Observability**：诊断输出能够区分 `policy_locked`、`user_selected`、`selection_required`、`stale_session`、`hook_untrusted`、`workspace_unbound`、`task_consent_required` 和 `planning_review_required`。

## Non-functional requirements

- 标准库优先，不引入数据库、Web UI 框架或远程服务。
- 一个 mode policy owner、一个 entry-gate state owner；skill、hook、MCP 和 README 不各自实现路由逻辑。
- 状态文件小型、原子、可重放或可验证；不把原始对话复制进 Trellis PRD。
- 错误信息必须告诉用户当前状态、阻断原因和唯一合法下一步。
- 兼容迁移只保留一个发布周期：旧 `explicit=managed` 可安全升级；旧 `explicit=lightweight` 只能形成待确认偏好，不能继续作为硬覆盖。

## Acceptance criteria

- [ ] **AC1** 显式 implementation 请求在任何 hard trigger 成立时返回 `policy_floor=managed`，即使调用方传旧 `explicit=lightweight`。
- [ ] **AC2** `explicit=lightweight` + `durable_audit=true`、`human_gates=true`、多波次、活动 Trellis task 的组合全部判为 managed；旧危险测试被替换。
- [ ] **AC3** 两种模式均合法时，prepare 返回单选 schema、推荐项和差异说明，但 `selected_tier` 保持空值直到真实选择到达。
- [ ] **AC4** Codex 有原生选择工具时显示单选；无该能力时进入 `needs_input` 并停止。Claude 使用其可验证的原生交互能力；非交互模式不自动代选。
- [ ] **AC5** 伪造 `source=user` 但没有宿主事件/有效 gate 记录的选择被拒绝或降为 unverified，且不能向下突破 policy floor。
- [ ] **AC6** `qualify` 在 prepare/selection 未完成时 fail closed，返回当前 gate 状态与下一步。
- [ ] **AC7** qualification 无论是否 auto-start 都校验严格 `TaskContract` 和 `WorkItem[]`；字符串列表不再算合法任务图。
- [ ] **AC8** `expert_team_start` 缺 qualification receipt、活动 task 或 planning review 凭据时不创建 run。
- [ ] **AC9** managed + inline 返回 `execution_tier=managed`、`execution_mode=main-session-sequential` 和真实 assurance capability；仍要求任务图、验证和合规汇报，独立审计为硬要求但不可用时返回 blocked。
- [ ] **AC10** 没有活动 task 的 implementation 在 task consent 前不创建 Trellis task；planning task 在用户评审前不执行 `task.py start` 或源码写入。
- [ ] **AC11** Codex/Claude hook 在显式调用 gate 待决时阻断受支持的 Bash、apply_patch、MCP 写入；只读检查仍可按阶段策略执行。
- [ ] **AC12** hooks 禁用、未信任或宿主工具路径不受覆盖时，响应明确显示 `enforcement_level=advisory|partial`，不得声称强制完成。
- [ ] **AC13** 用户取消/拒绝选择后，不产生 task、run、源码修改或伪造成功报告。
- [ ] **AC14** 相同 invocation 的重复 prepare/select/qualify 幂等；冲突的第二次选择需要新的明确用户决定。
- [ ] **AC15** 重启 MCP、compact 和新会话后能够恢复 mode decision、Trellis task phase 和 managed run 摘要，已接受工作不重复。
- [ ] **AC16** completed/cancelled/stale gate 的迟到选择或迟到 start 被拒绝。
- [ ] **AC17** 当前会话缺少 `expert_team_prepare`、版本不匹配或 toolset fingerprint 过期时返回 stale，不继续以“已运行入口门禁”名义执行。
- [ ] **AC18** checkout MCP 与安装缓存 MCP 的 tools/list 和 server/contract version 一致；升级测试证明新会话加载新 skill/MCP。
- [ ] **AC19** 真实失守转录回归覆盖：AI 自选 lightweight、伪造 task consent、跳过 next_action、TBD PRD 后直接实现、字符串工作图、任务上下文漂移。
- [ ] **AC20** no-action、失败、恢复、取消、重复运行和两个修复轮次上限均有自动化测试与稳定诊断。
- [ ] **AC21** 最终 success 报告缺 prepare、decision、qualification、task graph、verification 任一项时会被合规检查判为失败。
- [ ] **AC22** mode/entry 状态中不出现完整敏感 prompt、token、password 或 raw trajectory。
- [ ] **AC23** Python unit tests、mypy、compileall、合同 fixtures、Codex/Claude plugin validator、hook fixtures、checkout/cache smoke 与 `git diff --check` 全部通过。
- [ ] **AC24** README 中的 Mermaid 顺序图、状态跟随图与实际 schema/next_action 一致，中英文说明同步。
- [ ] **AC25** Trellis spec 更新后，新 AI 会话能从 breadcrumb/skill/hook 得到同一条强制路径，而不依赖回忆本次对话。
- [ ] **AC26** 从安装缓存启动的 MCP 使用宿主当前 workspace，而不是插件根目录；错误项目根、软链接逃逸、task 属于另一 workspace、会话中途换 cwd 均 fail closed。
- [ ] **AC27** AI 直接提交 `actor="user"` 的 mode/task/completion/permission 决定不能通过 verified human gate；真实宿主决定可恢复且可归因。
- [ ] **AC28** Codex 与 Claude 同一次行为发布使用一致的新 base version；Codex 可另加 cachebuster，但不能用它掩盖 Claude 旧缓存。

## Out of scope

- 不制作独立 dashboard、复杂 MCP App 或自定义网页；优先复用宿主原生单选。
- 不尝试绕过或提升 Codex/Claude 的权限、审批或 sandbox。
- 不把 Expert Team entry gate 变成第二套 Trellis task 状态机。
- 不承诺拦截宿主官方明确不经过 hook 的所有工具路径；覆盖不到时必须显式降级，不能虚报。
- 不在本任务内重写现有 Manager / Executor / Auditor supervisor。

## Open questions

没有阻塞立项的问题。默认按上述唯一方案推进；实施前仍需用户评审本 PRD、`design.md` 与 `implement.md`，评审通过后才能运行 `task.py start`。
