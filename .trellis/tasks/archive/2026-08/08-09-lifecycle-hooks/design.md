# Design: Trellis 生命周期与统一 Hook

## Architecture

- `src/lifecycle/`：task repository、session pointer、风险分类与门禁。
- `src/hooks/`：共享 Hook schema、宿主 normalizer、dispatcher、紧凑恢复投影。
- `src/templates/`：Codex/Claude 模板注册表；apply 和 pack 共用一个文件清单。
- `src/mcp/`：纯 TypeScript stdio framing、workspace binding 与工具 registry。
- `src/cli/`：只做参数解析和输出，调用上述服务，不复制状态规则。

## Data Flow

```text
host hook JSON + explicit event
  → host normalizer
  → strict HookEnvelope
  → workspace/session binding
  → risk classifier
  → lifecycle gate
  → HookDecision
  → host-specific response renderer
  → bounded audit/session projection
```

```text
mta task/run/mcp
  → canonical Git root
  → LifecycleRepository / TrellisRunStore
  → typed projection
  → text or stable JSON output
```

## Ownership and Templates

模板注册表是 apply、unapply、status 和 pack 的单一来源。完全拥有的文件按 SHA-256 回执管理；共享 AGENTS/CLAUDE 指令使用唯一 marker，JSON 配置只声明 MTA 字段。未匹配回执摘要时保留用户内容并报告 drift。

## Workspace Binding

`.mta/sessions/<session-id>.json` 记录 schema、规范化 Git 根、宿主、活动 task、创建/刷新时间和 enforcement 证据。session ID 与路径使用白名单；读取时重新验证 receipt root 和当前 Git root。MCP 没有有效 binding 时返回 `workspace_unbound`，不回退到 cwd。

## Hook Enforcement

- SessionStart/UserPromptSubmit 返回上下文注入，不产生执行。
- PreToolUse 只有在宿主提供真实 pre-action hook 且项目被信任时才可报告 `enforced`。
- PermissionRequest 永不生成 bypass 参数或静默批准。
- PostToolUse 记录证据，不更改先前门禁结果。
- Stop 返回 bounded continuation/gate 建议，不自行启动 foreground。

## Migration

旧 Python Hook/MCP 入口只作为冲突检测目标。`legacy detach` 通过独立事务从共享配置中移除精确旧入口并写 detach receipt；不删除脚本、run、task 或 trace。直到后续双宿主 E2E 完成，仓库旧实现仍保留。

## Validation Levels

- unit：task、pointer、risk、hook codec、模板与 MCP framing。
- simulated integration：apply → hook → task/run status → unapply，fake run repository。
- local CLI smoke：打包安装后通过 stdio 执行 task/hook/MCP，不依赖 Python。
- model-backed E2E：留到 HostAdapter 子任务。
