# Implementation Plan: Codex 与 Claude HostAdapter

- [x] 1. 核验当前 Codex/Claude 官方 CLI 非交互参数、JSON/JSONL 和权限行为。
- [x] 2. 实现共享 shell-free process runner、活动注册表、有界流和跨平台进程树终止。
- [x] 3. 实现严格外部事件 normalizer 与权限/错误终态分类。
- [x] 4. 实现 CodexHostAdapter 和 ClaudeHostAdapter 命令构造与 cancel。
- [x] 5. 实现 foreground 配置 decoder、BoundRunService/Supervisor 接线和 CLI/MCP 入口。
- [x] 6. 用 fake executables 覆盖正常、权限、噪声、超长、非零、timeout、abort、cancel、并发和子进程清理。
- [x] 7. 执行本机双 CLI 的只读真实 smoke，记录认证或能力限制。
- [x] 8. 运行 trellis-check、更新 HostAdapter spec、Windows/WSL Node 24 与 Python 回归。

## Validation Commands

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `python -m unittest discover -s tests -p "test_*.py"`
- Windows 与 WSL Node 24 fake-host 集成测试。
