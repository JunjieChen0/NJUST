# ADR-002: ProviderRegistry 取代 switch 工厂

## Status

Accepted

## Context

原 API 工厂函数使用 switch-case 分发到不同的 Provider 构造函数，包含 25+ 个分支。每次新增 Provider 需要修改 7+ 处文件：工厂 switch、类型联合、配置 schema、默认模型列表、图标注册、计费配置、以及 UI 组件。

这种模式的维护成本随 Provider 数量线性增长，且 switch-case 无法在编译时检测到遗漏的分支。

## Decision

引入 `ProviderRegistry`（`Map<name, Factory>`），支持自注册和 fail-fast 查询：

```typescript
import { ProviderRegistry } from "../../src/api/registry/ProviderRegistry"
import { OpenRouterHandler } from "../../src/api/providers/openrouter"

// 示例使用独立实例；生产代码使用统一注册的 providerRegistry。
const registry = new ProviderRegistry()

// 工厂注册集中在 src/api/providers/register-all.ts。
registry.register("openrouter", (options) => new OpenRouterHandler(options))

// configuration 由调用方提供，此处应选择 openrouter。
const handler = registry.createHandler(configuration)
const registeredIds = registry.getRegisteredIds()
```

设计要点：

- `src/api/index.ts` 导入 `src/api/providers/register-all.ts`，由统一入口注册内置 Provider；不是每个 Provider 文件末尾自注册。
- 查询未注册的 Provider 时抛出明确错误（fail-fast）
- Registry 提供 `getRegisteredIds()`、`has()`、`get()` 和 `size()`。
- 重复注册默认抛错；有意覆盖时显式传入 `{ override: true }`。
- 模型目录缓存和元数据解析由 `modelCache.ts` / `resolveModelInfo.ts` 负责，Registry 的 `prepareModel` 接入请求前准备。

## Consequences

**正向：**

- 新增 Provider 有统一工厂注册入口；模型、配置、界面及发现策略仍需按功能补齐，不能承诺只改一个文件。
- 编译时通过 TypeScript 类型检查工厂签名一致性
- 工厂调用与注册分离，便于在测试中注入独立实例。
- 测试可以单独注册 mock Provider 而不影响全局 switch

**负向：**

- 需要显式管理重复注册和有意覆盖。
- 需要确保统一注册入口在创建 handler 前被导入。
- 调试时需要查看 Registry 状态而非阅读 switch 代码
