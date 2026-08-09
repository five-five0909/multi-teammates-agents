# Verification

- Windows: Node typecheck、lint、67/67 Node 测试通过；105/105 Python 测试通过。
- WSL: 隔离 Node 24.14.0 下 65 个 Node 测试通过，1 个 Windows-only shim 测试按设计跳过；Node 24 PATH 下 105/105 Python 测试通过。
- 真实 Codex 0.147.0：`read-only`、JSONL、stdin prompt smoke 通过，返回预期 JSON。
- 真实 Claude Code 2.1.220：CLI 启动与 stream-json 解析正常，但本机 OAuth session 已过期且无法刷新；记录为认证不可用，未伪造模型 smoke 通过。
- 进程测试确认 Windows 与 POSIX timeout/cancel 均清理 fake host 子进程树。
