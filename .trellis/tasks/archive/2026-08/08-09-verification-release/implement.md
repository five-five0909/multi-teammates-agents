# Implementation Plan: 跨平台验证与发行切换

- [x] 1. 实现严格 semver、registry 查询、24h 原子缓存、check-update 与精确 update/rollback。
- [x] 2. 实现 TTY TUI 和共享 project/run/foreground 状态入口；非 TTY 保持帮助。
- [x] 3. 补齐 `run answer` 与 doctor MCP initialize 探针。
- [x] 4. 新增 tarball 白名单和隔离安装 smoke，覆盖两个 bin、npx、MCP、apply/unapply、无 Python/Cargo PATH。
- [x] 5. 扩展四 runner × Node 22/24 CI 与 pack-install job。
- [x] 6. 重写 README/README_zh、skill、manifest、示例与 notices 到 npm/mta；避开用户正在修改的 expert-team-contract spec。
- [x] 7. 实时查询 npm registry 包名/目标版本，记录但不擅自 publish。
- [x] 8. 运行 Windows、WSL Node 24、pack/install、真实 Codex/Claude smoke，并生成分级 cutover 证据。
- [x] 9. 仅当 cutover 报告全绿时删除旧 Python/bridge/tests；否则保留并记录认证 blocker。
- [x] 10. trellis-check、更新发行 spec、提交并归档；父任务仅在所有 AC 真正满足后归档。

## Validation Commands

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run pack:check`
- `node scripts/npm-install-smoke.mjs <tarball>`
- WSL Node 24 重复 typecheck/lint/test/smoke
- `rg -n -i "python|expert_team_run.py" README.md README_zh.md skills .codex-plugin .claude-plugin examples .trellis/spec/plugin`

## Risk / Rollback Points

- 不在测试中执行真实全局 npm update；进程执行器必须注入 fake。
- 不覆盖 `.trellis/spec/plugin/expert-team-contract.md` 的用户未提交修改。
- 不在 Claude OAuth 恢复前删除旧 Python 实现。
- 不运行 `npm publish`，除非用户另行明确授权。
