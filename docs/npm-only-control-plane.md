# MTA npm-only 控制面

## 结论

MTA 只有一个产品来源：npm 官方 registry 的 `multi-teammates-agents`。
Codex CLI 与 Claude Code 不再从 Git marketplace 缓存运行 MTA；两者由同一个
`mta` TUI/CLI 管理，并通过项目内配置调用已安装 npm 包的绝对 Node/JS 入口。

删除的是旧 Git plugin 根 MCP。Managed 模式需要的项目级 TypeScript MCP 继续保留，
由 `mta apply` 创建，并由 receipt、摘要校验、原子提交和漂移保护管理。

## 系统边界

```mermaid
flowchart TB
  Registry["npm 官方 Registry<br/>唯一版本权威"] --> Package["multi-teammates-agents<br/>dist + bin + schema + skill + agents"]
  Package --> Entry["mta<br/>TUI / CLI"]

  subgraph Control["共享 Control Plane"]
    Status["Status 投影"]
    Apply["Apply / Unapply"]
    Migration["Marketplace 迁移"]
    Update["Exact Update / Rollback"]
    Doctor["Doctor / MCP initialize"]
  end

  Entry --> Status
  Entry --> Apply
  Entry --> Migration
  Entry --> Update
  Entry --> Doctor

  Apply --> Codex["Codex 项目配置<br/>Hook + Skill + AGENTS.md"]
  Apply --> Claude["Claude 项目配置<br/>Hook + Skill + Agents + CLAUDE.md"]
  Apply --> MCP["项目 .mcp.json<br/>absolute node + bin/mta.js"]
  MCP --> Runtime["TypeScript Managed Runtime<br/>Trellis + Manager/Executor/Auditor"]
  Codex --> Runtime
  Claude --> Runtime
```

不存在第二套 TUI 状态库或 shell 包装层。TUI 与 CLI 都直接调用 `src/control`、
`src/lifecycle` 和 `src/runtime` 的同一实现。

## 安装与项目接入

```mermaid
sequenceDiagram
  autonumber
  actor User as 用户
  participant NPM as npm 官方 Registry
  participant MTA as mta TUI/CLI
  participant Plan as Apply Control
  participant Project as Git 项目
  participant MCP as 项目 TypeScript MCP

  User->>NPM: npm install -g --ignore-scripts multi-teammates-agents@exact
  NPM-->>User: 安装 dist、双 bin、schema、skill、agents
  User->>MTA: mta / mta apply --codex --claude
  MTA->>Plan: 生成冻结 ApplyPlan
  Plan->>Project: 只读当前字节并计算 before/after hash
  Plan-->>User: 展示 Codex + Claude + MCP 预览
  User->>MTA: 显式确认
  MTA->>Plan: commit 同一个计划
  Plan->>Project: 复核快照、原子写入、receipt-last
  alt 写入失败或内容漂移
    Plan->>Project: 回滚已写内容 / 保留用户字节
    Plan-->>User: 返回精确错误
  else 提交成功
    MTA->>MCP: initialize（绝对 node + bin/mta.js）
    MCP-->>MTA: serverInfo / tools
    MTA-->>User: 接入完成
  end
```

项目接入包含：

- Codex：`.codex/hooks.json`、`.agents/skills/expert-team`、`AGENTS.md`。
- Claude：`.claude/settings.json`、`.claude/skills/expert-team`、
  `.claude/agents`、`CLAUDE.md`。
- 共享：项目 `.mcp.json`、`.mta/runtime.json` 和 `.mta/apply-receipt.json`。

## 所有写操作的统一状态机

```mermaid
stateDiagram-v2
  [*] --> Plan
  Plan --> Preview: 冻结目标、命令、摘要
  Preview --> Cancelled: 用户取消
  Cancelled --> [*]: 零写入
  Preview --> Validate: 用户确认
  Validate --> Rejected: 快照漂移 / 身份不匹配
  Rejected --> [*]: 保留当前字节
  Validate --> Commit: 校验通过
  Commit --> Result: 成功
  Commit --> Rollback: 中途失败
  Rollback --> Result: 恢复已拥有内容
  Result --> [*]
```

Apply、Unapply、旧 marketplace 清理和 Update 均遵守这个流程。计划生成后不会在
确认阶段静默重算成另一组目标。

## 旧 Git marketplace 迁移

迁移只识别以下精确身份：

```text
plugin      multi-teammates-agents@multi-teammates-agents
marketplace multi-teammates-agents
stale MCP  name=expert-team，且 launcher 与 cwd 同时指向 MTA plugin cache
```

```mermaid
flowchart TD
  A["验证全局 npm 安装与版本"] --> B["只读列出 Codex plugin / marketplace / MCP"]
  B --> C{"精确旧身份存在？"}
  C -- 否 --> D["无需清理"]
  C -- 是 --> E["冻结 CleanupPlan 并展示"]
  E --> F{"用户确认？"}
  F -- 否 --> G["结束：零写入"]
  F -- 是 --> H["移除精确匹配的旧 expert-team MCP"]
  H --> I["codex plugin remove<br/>精确 plugin ID"]
  I --> I2["codex plugin marketplace remove<br/>精确 marketplace 名"]
  I2 --> J["npm-only Apply"]
  J --> K["Doctor: 项目 MCP initialize"]
  K --> L["重启 Codex / Claude 会话"]
```

清理不会扫描后猜删目录，也不会删除其他 marketplace、MCP 或用户配置。旧 run、
Trellis 任务和证据数据不属于这个迁移的删除范围。

## 精确更新与回滚

```mermaid
sequenceDiagram
  autonumber
  actor User as 用户
  participant TUI as Update 页面
  participant Registry as npm 官方 Registry
  participant NPM as npm CLI
  participant Health as 健康检查

  User->>TUI: 检查更新
  TUI->>Registry: GET package/<channel>（预发布取 alpha/beta/rc，稳定版取 latest；有界超时）
  Registry-->>TUI: exact semver
  TUI->>TUI: 判断当前是否为 canonical global npm 安装
  alt npx 或来源未知
    TUI-->>User: 只显示 exact 人工命令，不执行
  else 全局 npm 安装
    TUI-->>User: 展示 exact 版本与冻结命令
    User->>TUI: 显式确认
    TUI->>NPM: install -g package@exact<br/>官方 registry + 隔离 cache + ignore-scripts
    NPM-->>TUI: 安装结果
    TUI->>Health: node global/bin/mta.js --version
    alt 安装或健康检查失败
      TUI->>NPM: install -g package@old-exact
      NPM-->>TUI: 回滚结果
      TUI-->>User: 分别报告更新与回滚错误
    else 成功
      TUI-->>User: 提示重启宿主并重新 Apply
    end
  end
```

## TUI 页面

| 页面 | 读取内容 | 可执行操作 |
|---|---|---|
| Overview | 当前版本、安装来源、项目、双宿主、MCP、Trellis/run | 刷新与导航 |
| Integrations | Codex/Claude 接入、receipt、旧 plugin/marketplace | Apply、Unapply、迁移 |
| Update | 当前/可用版本、dist-tag 通道、来源、精确命令 | 检查、预览、确认更新 |
| Doctor | Node/npm/Git、Codex、Claude、项目 MCP initialize | 重新诊断 |
| Runs | 绑定任务和 managed run 快照 | status、resume、foreground 等现有操作 |

## 发布门禁

发布新 alpha 前必须依次通过：

1. TypeScript typecheck、lint 和全部单元/集成测试。
2. `npm pack` 内容检查：必须有 `dist`、双 bin、schema、skill、agents；不得有
   plugin manifest、根 `.mcp.json` 或 `bin/mta-plugin-mcp.js`。
3. 隔离 prefix 真安装：双 bin、npm exec、双宿主 Apply、Hook、项目 MCP initialize、
   Status、Doctor、Unapply。
4. Windows、Ubuntu、macOS Intel/arm64 × Node 22/24 CI。
5. 官方 registry 发布后验证全新安装、升级、失败回滚与新会话复验。

Alpha 通过上述门禁仍不等于 Stable。Stable 继续要求真实 Codex 与 Claude 的
model-backed managed E2E；fixture/fake-host 证据必须单独标注。
