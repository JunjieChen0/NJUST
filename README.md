# NJUST_AI_CJ

> 基于 [NJUST_AI_CJ](https://github.com/NJUST-AI/NJUST_AI_CJ) 定制的 AI 编程助手 VS Code 扩展，面向 NJUST 内部使用。

## 项目概述

NJUST_AI_CJ 是一个运行在 VS Code / Cursor 编辑器中的 AI 编程助手。它能够理解你的代码库、生成代码、执行终端命令、编辑文件，并通过多种工作模式适配不同的开发场景。

本项目基于 NJUST_AI_CJ 上游版本进行定制，移除了云服务（Cloud）和市集（Marketplace）等外部依赖功能，保留了核心的 AI 辅助编程能力和 MCP（Model Context Protocol）服务器配置能力。

## 与上游 NJUST_AI_CJ 的主要差异

| 模块        | 状态   | 说明                                        |
| ----------- | ------ | ------------------------------------------- |
| Cloud 服务  | 已移除 | 登录、组织管理、任务同步、云端分享等        |
| Marketplace | 已移除 | 市集浏览、远程安装 MCP/Mode 等              |
| Telemetry   | 已简化 | 保留类型定义，移除远程上报逻辑              |
| MCP 配置    | 保留   | MCP 服务器管理、配置编辑等功能完整保留      |
| Modes 系统  | 保留   | Code / Architect / Ask / Debug / 自定义模式 |
| 代码索引    | 保留   | Codebase Indexing 及向量搜索                |
| Checkpoints | 保留   | 任务检查点及回滚                            |

## 功能

- **AI 代码生成**：通过自然语言描述生成代码
- **多模式协作**：Code、Architect、Ask、Debug 及自定义模式
- **代码重构与调试**：理解上下文并进行修改
- **MCP 服务器**：接入外部工具和数据源
- **代码索引**：基于向量的代码库语义搜索
- **Checkpoints**：任务级别的代码状态快照与回滚
- **多语言支持**：中文、英文等 18 种语言

## 本地开发

### 环境要求

- Node.js 20.19.2
- pnpm 10.8.1

### 安装与运行

1. 克隆仓库：

```sh
git clone <repo-url>
cd NJUST_AI_CJ
```

2. 安装依赖：

```sh
pnpm install
```

3. 启动开发模式：

在 VS Code 中按 `F5` 启动调试，会打开一个加载了 NJUST_AI_CJ 扩展的新窗口。Webview 和核心扩展的修改都会自动热重载。

### 构建 VSIX

```sh
pnpm vsix
```

生成的 `.vsix` 文件位于 `bin/` 目录下，可通过以下命令安装：

```sh
code --install-extension bin/njust-ai-cj-<version>.vsix
```

或使用自动化安装脚本：

```sh
pnpm install:vsix
```

## 项目结构

```
├── src/                    # VS Code 扩展主体
│   ├── api/providers/      # AI 模型提供商适配
│   ├── core/               # 核心逻辑（Task, ClineProvider, webview 消息处理）
│   ├── services/           # 服务层（代码索引、MCP、Skills 等）
│   └── i18n/               # 国际化（后端）
├── webview-ui/             # React 前端 UI
│   ├── src/components/     # UI 组件
│   └── src/context/        # 状态管理
├── packages/
│   ├── types/              # 共享类型定义
│   └── telemetry/          # Telemetry 模块（已简化）
└── AGENTS.md               # AI Agent 协作规范
```

## 许可证

[Apache 2.0](./LICENSE)
