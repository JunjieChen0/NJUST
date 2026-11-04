# 文档导航

[返回项目首页](../README.md)。文档中的命令和配置以包脚本、schema 与工作流为准；验证结论应记录代码状态、命令、日志及未执行项。

## 使用与开发

- [本地开发、构建与安装](development/setup.md)
- [测试、覆盖率、E2E 与 VSIX 冒烟](development/testing.md)
- [贡献指南](../.github/CONTRIBUTING.md)
- [测试命名规范](compose/task-lists/test-naming-convention.md)
- [简体中文概览](../locales/zh-CN/README.md) / [繁體中文概覽](../locales/zh-TW/README.md)
- [CLI 使用](../apps/cli/README.md) / [Agent Loop](../apps/cli/docs/AGENT_LOOP.md)

## 架构与协议

- [架构与模块参考](architecture/overview.md)
- [Docker 沙盒](sandbox.md)
- [Cloud Agent 对接](integrations/cloud-agent.md)
- [仓颉 MCP 接入](integrations/cangjie-mcp.md)
- [开发约定与 Cloud Agent MCP 边界](../AGENTS.md)

## 仓颉评测

- [固定任务说明](../packages/evals/cangjie/README.md)
- [阶段验收标准](../packages/evals/cangjie/ACCEPTANCE.md)
- [评测工程说明](../packages/evals/cangjie/projects/orders/README.md)

## 架构决策

- [ADR-001：ITaskHost 边界](adr/001-itaskhost-interface.md)
- [ADR-002：ProviderRegistry](adr/002-provider-registry.md)
- [ADR-003：文件凭据存储](adr/003-file-secret-storage.md)
- [ADR-004：命令安全分类](adr/004-command-safety-classifier.md)
- [ADR-005：共享核心包边界](adr/005-packages-core-boundary.md)
- [ADR-006：性能预算](adr/006-performance-budget.md)

## 故障排查

- [扩展激活失败与命令未注册](runbooks/001-activation-failure.md)
- [MCP 连接故障](runbooks/002-mcp-connection-failure.md)
- [命令拦截误报](runbooks/003-command-interception-false-positive.md)
- [API 密钥轮换](runbooks/004-api-key-rotation.md)
- [高 Token 消耗](runbooks/005-high-token-consumption.md)
- [构建体积与激活性能](runbooks/006-bundle-perf-regression.md)
- [存档被禁用与测试数据隔离](runbooks/007-checkpoints-disabled.md)

## 文档维护

- 根目录保留项目入口、Agent 指令和 GitHub / 打包常用的政策及许可文件；长篇说明按主题放入本目录。包级 README 保留在对应包中。
- 过时审计、一次性实施草案和生成的 wiki 已清理；需要历史信息时查 Git 历史或工作区外的清理备份，不再维护重复的当前状态报告。
- API 参考由 `pnpm docs:api` 生成到 `docs/api/`，按需生成，不提交生成副本。
- [原始开发笔记（Word）](notes/develop.docx)保留原内容，供历史参考，不作为当前实现规范。
- 仓颉语料和 bundled skills 按版本维护，不能与过时项目说明一起删除或批量重排。
- 新增维护文档时同步添加导航、检查本地链接，并运行仓库 Prettier。
