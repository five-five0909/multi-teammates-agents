# Codex 与 Claude 宿主适配器

## Goal

实现纯 TypeScript、`shell:false` 的 Codex/Claude HostAdapter，并把它们接入唯一显式执行入口 `mta run foreground`。每个 Manager、Executor、Auditor Episode 都必须是独立宿主进程，输出进入统一事件/结果契约；超时、取消、权限请求和异常退出必须可见且不留下孤儿进程。

## Requirements

- Codex 与 Claude 适配器分别使用当前 CLI 的非交互 JSON/JSONL 能力，不解析 UI 文本猜状态。
- 命令解析复用 `resolveCommand`，包括 Windows npm `.cmd` shim 转换；生产代码始终 `shell:false`。
- 每个 Episode 使用独立 session/process；Manager、Executor、Auditor 不共享模型上下文或隐藏状态。
- 明确传递 workspace、model、read-only/host-controlled permission posture、prompt 和 timeout；禁止 `dangerously-skip-permissions`、bypass Hook trust 或等价绕过。
- stdout/stderr 使用有界缓冲与结构化解析；公开结果只保留 visible output、规范化 BackendEvent 和脱敏 trace。
- AbortSignal、timeout 和显式 cancel 复用一个进程注册表；Windows 与 POSIX 都终止整个进程树并等待退出。
- 权限提示映射为 `permission_required`，超时映射为 `timeout`，外部中止映射为 `cancelled`，其他非零退出为 `error`。
- `mta run foreground <run-id>` 是唯一能启动 Supervisor 的 CLI/MCP 路径；status/resume 保持只读。

## Acceptance Criteria

- [x] AC1. 两个适配器都生成可审计的 shell-free 命令和独立 Episode 请求。
- [x] AC2. JSON/JSONL parser 覆盖正常输出、分块、噪声、权限、非零退出和超长输出。
- [x] AC3. timeout、AbortSignal、显式 cancel 会清理整个进程树，且终态只记录一次。
- [x] AC4. Auditor 使用只读宿主配置，无法通过适配器请求写权限或 bypass 参数。
- [x] AC5. foreground 从活动 Trellis session 和 mta-runs 加载配置，调用真实适配器；status/resume 不构造适配器。
- [x] AC6. fake executable 集成测试覆盖 Codex/Claude 命令参数、流解析、权限、取消、超时和并发 Episode。
- [x] AC7. 在本机可用且已认证的 Codex/Claude CLI 上完成最小真实 smoke；不可用能力明确报告而不伪造通过。
- [x] AC8. Windows 与 WSL Node 24 通过 typecheck、lint、Node/Python 回归和无孤儿进程检查。

## Out of Scope

- TUI、联网更新和最终 npm 发布。
- 删除旧 Python 实现；只有双宿主真实 E2E 和发布矩阵全部通过后才执行最终切除。
