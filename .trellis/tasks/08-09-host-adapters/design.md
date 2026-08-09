# Design: Codex 与 Claude HostAdapter

## Architecture

- `src/runtime/host/process-runner.ts`：统一 shell-free spawn、流缓冲、timeout/abort、进程树终止和活动进程注册表。
- `src/runtime/host/codex-adapter.ts`：构造 Codex 非交互命令并把 JSONL 事件归一化。
- `src/runtime/host/claude-adapter.ts`：构造 Claude print/stream-json 命令并归一化事件。
- `src/runtime/host/event-normalizer.ts`：外部 `unknown` 只在这里解析，生成 `EpisodeResult/BackendEvent`。
- `src/runtime/foreground.ts`：解析运行配置、创建适配器和 Supervisor；CLI/MCP 共用。

## Process Flow

```text
EpisodeRequest
  → host command builder
  → resolveCommand (Windows shim safe)
  → spawn shell:false + bounded stdout/stderr
  → JSONL event normalizer
  → permission/timeout/cancel/error classification
  → process-tree cleanup + exit await
  → EpisodeResult
  → Supervisor durable event/trace
```

## Cancellation

活动进程以 `episodeId` 唯一注册。timeout、AbortSignal 与 `cancel()` 竞争同一个幂等终止函数；先标记原因，再终止进程树，最后等待 close。Windows 使用可定位 PID 的系统进程树终止命令，POSIX 为子进程建立独立 process group 并向负 PGID 发信号。终止失败会进入 error metadata，不能报告已清理。

## Permissions

适配器只选择宿主官方非交互权限模式，不使用绕过参数。Auditor 的 `readOnly=true` 必须映射到宿主只读/plan 配置；若宿主无法保证，则在启动前失败，不以提示词替代权限边界。

## Testing

fake Codex/Claude executables 通过 Node fixture 产生真实分块 stdout/stderr、子进程、权限事件和延迟。测试断言参数、状态、缓冲上限、并发隔离、终止时延与子进程消失。真实 smoke 只执行无写入、低成本请求。
