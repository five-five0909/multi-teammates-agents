# Implementation Plan: Expert Team 子代理纪律

## Ordered checklist

1. [ ] 读取插件规范和当前 Expert Team 技能，确认没有重复委派规则。
2. [ ] 新增唯一的子代理纪律 reference，写入直接处理/派发条件、探子合同和 lead 责任。
3. [ ] 在 `skills/expert-team/SKILL.md` 的派发流程中链接并应用该 reference。
4. [ ] 在 README 与 README_zh 增加“插件只提供项目规则，不改用户 Codex 配置”的说明。
5. [ ] 检查现有角色注册表、写入 ownership、Trellis 审计和结果合同未被改变。
6. [ ] 运行插件/技能校验、Agent 生成检查、合约 fixtures、单元测试、mypy 和 diff 检查。
7. [ ] 检查 Git diff，确认没有 `%USERPROFILE%\\.codex\\` 文件或敏感配置进入仓库。

## Files in scope

- `skills/expert-team/SKILL.md`
- `skills/expert-team/references/delegation-guardrails.md`
- `.trellis/spec/plugin/expert-team-contract.md`
- `tests/test_plugin_contract.py`
- `README.md`
- `README_zh.md`

## Validation commands

```powershell
python "$env:USERPROFILE/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py" .
python "$env:USERPROFILE/.codex/skills/.system/skill-creator/scripts/quick_validate.py" skills/expert-team
python scripts/render_claude_agents.py --check
python scripts/validate_contract.py tests/fixtures
python -m unittest discover -s tests -p "test_*.py"
python -m mypy runtime scripts tests
git diff --check
```

## Rollback points

- 如果规则与现有角色合同冲突，先停止并只回滚本任务新增的 reference/技能段落。
- 如果校验失败，修复或撤销项目内文档改动；不触碰用户级 Codex 文件。
- 用户配置路径只允许出现在文档的“不会修改”说明中，不允许作为写入目标。

## Review gate

规划收窄后，等待用户确认再执行 `task.py start`。实现阶段只修改仓库内列出的四个文件，
不执行任何用户目录备份或配置写入。
