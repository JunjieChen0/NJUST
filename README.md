# NJUST_AI

<img src="src/assets/icons/icon.png" alt="NJUST_AI 校徽" width="96" />

面向仓颉开发的 AI 编程助手，运行于 VS Code / Cursor，提供代码阅读与修改、工具审批、构建测试验证和交付摘要。

基于 [Roo Code](https://github.com/RooVetGit/Roo-Code)（Apache-2.0），由 NJUST_AI 团队维护。当前仓库为 [JunjieChen0/NJUST](https://github.com/JunjieChen0/NJUST)。

## 核心能力

- **仓颉工作台**：LSP、`cjpm`、格式化、静态检查、测试与调试整合。
- **任务验证**：模型声明完成、构建、实际测试和用户验收分开记录；代码或 SDK 变化后，旧证据标为过期或不完整。
- **模型与服务接入**：多 Provider、OpenAI Compatible、Cloud Agent 和 MCP。
- **上下文与经验**：代码索引、Skills 与基于验证事实的跨任务记忆。
- **改动交付**：检查点、diff、检查日志和未验证项集中展示；只检查任务限制写入。

## 快速开始

安装已生成的 VSIX，将占位版本替换为实际文件名：

```sh
code --install-extension bin/njust-ai-<version>.vsix
```

安装后执行 `Developer: Reload Window`。打开仓颉工程时需准备 SDK，并配置 `CANGJIE_HOME` 或工具路径。

从源码开发：

```sh
git clone https://github.com/JunjieChen0/NJUST.git
cd NJUST
pnpm install
```

环境要求为 Node.js `>=20.19.2 <25`、pnpm `10.8.1`。在 VS Code 中按 `F5` 启动开发窗口，完整步骤见[本地开发与打包](docs/development/setup.md)。

普通版使用 `njust-ai`，Nightly 使用 `njust-ai-nightly`；Nightly 是开发预览版，两者的设置与命令前缀独立。

## 文档

| 内容                             | 入口                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| 全部维护文档                     | [文档导航](docs/README.md)                                                                          |
| 架构、模块与交互                 | [架构参考](docs/architecture/overview.md)                                                           |
| 开发、构建与安装                 | [开发指南](docs/development/setup.md)                                                               |
| 单元测试、覆盖率、E2E、VSIX 冒烟 | [测试指南](docs/development/testing.md)                                                             |
| Cloud Agent / 仓颉 MCP           | [Cloud Agent 对接](docs/integrations/cloud-agent.md) / [仓颉 MCP](docs/integrations/cangjie-mcp.md) |
| 故障排查                         | [排障手册](docs/README.md#故障排查)                                                                 |
| 固定仓颉任务与验收边界           | [评测说明](packages/evals/cangjie/README.md)                                                        |
| 贡献与安全报告                   | [贡献指南](.github/CONTRIBUTING.md) / [安全政策](SECURITY.md)                                       |

## 仓库结构

```text
├── src/                    # VS Code 扩展
├── webview-ui/             # React Webview
├── packages/               # 共享核心、类型、构建与评测
├── apps/                   # CLI、E2E、Nightly 和网站
├── docs/                   # 使用、开发、架构、协议与排障文档
├── CangjieCorpus-1.0.0/    # 版本化仓颉语料
└── AGENTS.md               # 开发约定与 Agent 指令
```

## 许可证

[Apache 2.0](LICENSE)。第三方说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
