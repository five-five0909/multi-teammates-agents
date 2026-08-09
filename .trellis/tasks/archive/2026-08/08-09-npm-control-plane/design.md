# Design: npm 控制面与发行基础

## Boundaries

- `src/cli/`：参数解析、稳定输出、退出码和命令路由。
- `src/control/`：项目根解析、apply plan、receipt、事务提交和 unapply。
- `src/platform/`：文件系统原子操作、路径规范化和进程探测。
- `templates/`：首轮只放最小 ownership marker/运行时占位模板；完整 hook/插件模板由后续子任务扩展。

## Apply Transaction

`inspect → plan → freeze digests → validate conflicts → stage adjacent temp files → commit sequentially → write receipt`。任一步失败时按反向事务日志恢复写前字节；无法证明安全恢复时停止并保留诊断，不继续叠加补丁。

receipt 使用版本化 schema，保存规范化项目根、包版本、事务 ID、宿主选择和每个对象的写前/写后摘要。共享结构只记录 MTA 拥有的字段或 marker，不声称拥有整个用户文件。

## Dependencies

生产依赖只引入当前明确需要的 CLI 参数解析、schema/验证能力；优先使用 Node 标准库。测试和构建依赖固定版本并进入 lockfile。任何新增库先核对当前版本官方 API、Node 22/24 支持和许可证。

## Rollback

此阶段不替换旧入口。新 CLI 仅在显式调用时工作，apply 失败会恢复写前状态；删除 TypeScript 新文件即可回到当前仓库行为。

