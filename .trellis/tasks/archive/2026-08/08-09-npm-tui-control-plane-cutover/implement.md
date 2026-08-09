# Implementation Plan: npm-only TUI 控制面切换

## Work Order

- [ ] 1. 冻结当前 npm tarball、Git plugin 缓存失败、双宿主 apply 和 TUI 行为基线。
- [ ] 2. 新增版本化 marketplace migration probe/plan/result，只识别精确 MTA plugin 与 marketplace 身份。
- [ ] 3. 将 Doctor 的 MCP 探针切换为标准 `bin/mta.js mcp serve --project`，删除 plugin-only launcher 依赖。
- [ ] 4. 扩展统一 ControlSnapshot，聚合版本/来源、双宿主、项目、MCP、Trellis/run、迁移和诊断状态。
- [ ] 5. 重构 TUI 为 Overview / Integrations / Update / Doctor / Runs，并将所有写操作接到现有冻结 plan/commit 服务。
- [ ] 6. 为 TUI 增加双宿主 Apply/Unapply、旧 marketplace 清理、exact Update 的 preview/confirm/result 流程。
- [ ] 7. 删除 Git plugin 发布面：两份 plugin manifest、根 `.mcp.json`、plugin MCP launcher、marketplace entry 及重复契约。
- [ ] 8. 收敛 tarball、README、Skill、spec 与安装 smoke 到 npm-only；保留项目级 MCP/Hook/Skill/Agent。
- [ ] 9. 运行本地全量验证、真实 registry 安装、当前 Windows/Ubuntu2204 迁移和双宿主 Doctor。
- [ ] 10. 推送并等待四平台 Node 22/24 CI；发布下一个 prerelease 后完成真实 exact upgrade/rollback 演练。

## File Ownership and Risk

| Scope | Likely files | Risk / rollback |
|---|---|---|
| Migration/control | `src/control/*`, `src/contracts/public-schemas.ts` | 只能匹配精确 MTA 身份；fixture 证明不碰其他配置 |
| Doctor/templates | `src/control/doctor.ts`, `src/templates/registry.ts` | 包根与项目 MCP 不得混淆 |
| TUI/CLI | `src/tui/index.ts`, `src/cli/index.ts` | UI 不拥有状态；非 TTY 行为保持 |
| Distribution | `package.json`, manifests, `.mcp.json`, `bin/` | tarball 必须保留双 bin、dist 和项目接入资产 |
| Tests/docs/spec | `test/`, `scripts/npm-install-smoke.mjs`, README/spec/task evidence | 移除旧断言并增加 registry/TUI/迁移闭环 |

## Validation Sequence

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`
4. `npm run pack:check`
5. `npm run smoke:install`
6. 临时 HOME/CODEX_HOME 下验证其他 MCP/marketplace 字节保持不变。
7. 从官方 registry 全局安装精确 prerelease，进入 TUI，完成双宿主 Apply → Doctor → Unapply。
8. 在真实 Windows 与 Ubuntu2204 清理旧 MTA marketplace/plugin，确认新会话无 plugin MCP startup warning。
9. GitHub Actions 四平台 × Node 22/24 全绿。
10. 从 `0.5.0-alpha.0` 升级到新 prerelease，验证成功更新、失败恢复旧版和 rollback failure 显式结果。

## Review Gates

- 实施前：用户审阅 PRD/design/implement 并明确批准启动。
- 删除 Git plugin 面前：npm-only project MCP initialize 自动化证据通过。
- 清理当前机器旧入口前：CleanupPlan 只包含精确 MTA 身份，且 npm 安装可用。
- 发布前：本地 full check、真实 tarball smoke、双宿主迁移和远程 8/8 CI 通过。

## Rollback Points

- 每个 control/TUI 变更保持独立提交，失败回退该提交，不使用 `git reset --hard`。
- Apply/Unapply/Migration 写入失败使用事务原字节恢复。
- npm 更新失败安装旧精确版本；若回滚也失败，停止并显示手工恢复命令。
- 不自动恢复 Git marketplace；已知缺 `dist` 的路径不得成为 fallback。
