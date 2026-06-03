# ADR-005: packages/core 平台无关边界

## Status

Accepted

## Context

核心业务逻辑分散在 `src/`（与 VS Code API 紧耦合）和 `packages/core/`（平台无关）两个位置。这导致：

- CLI 环境无法复用 `src/` 中的核心逻辑
- Web 端和 headless 服务器需要重复实现
- 测试 `src/` 中的逻辑需要 mock 整个 VS Code API

`packages/core` 作为 monorepo 中的独立包，理论上应该包含所有平台无关的业务逻辑。

## Decision

`packages/core` 严格执行以下边界规则：

**硬性约束：**

1. `packages/core/src/` 下禁止 `import "vscode"` 或 `from "vscode"`
2. 所有 VS Code API 依赖通过接口注入（依赖反转原则）
3. ESLint 规则 `no-restricted-imports` 在 CI 中强制执行

**当前包含的模块（13 个子目录）：**

- `api/` — API handler 抽象和 Provider 实现
- `tools/` — 工具定义和参数 schema
- `prompts/` — 系统提示词构建
- `shared/` — 通用工具函数
- `auto-approval/` — 自动审批规则引擎
- `ignore/` — .rooignore 规则解析
- `protect/` — .rooprotect 文件保护
- 等其他模块

**迁移策略：**

- 新功能优先放入 `packages/core`
- `src/` 中现有的平台无关逻辑逐步迁移
- 需要 VS Code API 的功能通过接口抽象，`src/` 提供 VS Code 实现

## Consequences

**正向：**

- CLI/web/headless 环境可直接引用 `packages/core`
- 核心逻辑的单元测试无需 mock VS Code API
- 包体积更小，可独立发布和版本管理
- 清晰的架构边界降低新开发者的认知负荷

**负向：**

- 部分现有逻辑需要接口化改造才能迁移
- 接口抽象可能引入额外的间接层和性能开销
- 需要维护两套构建配置（core 包 + 扩展主包）
- 某些 VS Code API（如 `vscode.workspace`）的抽象成本较高
