# ADR-002: ProviderRegistry 取代 switch 工厂

## Status

Accepted

## Context

原 API 工厂函数使用 switch-case 分发到不同的 Provider 构造函数，包含 25+ 个分支。每次新增 Provider 需要修改 7+ 处文件：工厂 switch、类型联合、配置 schema、默认模型列表、图标注册、计费配置、以及 UI 组件。

这种模式的维护成本随 Provider 数量线性增长，且 switch-case 无法在编译时检测到遗漏的分支。

## Decision

引入 `ProviderRegistry`（`Map<name, Factory>`），支持自注册和 fail-fast 查询：

```typescript
// 注册
ProviderRegistry.register("openrouter", {
	create: (config) => new OpenRouterHandler(config),
	defaultModel: openRouterDefaultModelId,
})

// 查询
const handler = ProviderRegistry.create(providerName, config) // fail-fast if not found
```

设计要点：

- 每个 Provider 模块在文件末尾自注册（side-effect import）
- 查询未注册的 Provider 时抛出明确错误（fail-fast）
- Registry 提供 `list()` 方法供 UI 和测试使用

## Consequences

**正向：**

- 新增 Provider 只需修改 1 处文件（Provider 自身的注册语句）
- 编译时通过 TypeScript 类型检查工厂签名一致性
- Provider 模块可按需加载（tree-shaking 友好）
- 测试可以单独注册 mock Provider 而不影响全局 switch

**负向：**

- 注册顺序可能影响 override 行为（后注册覆盖先注册）
- 需要确保所有 Provider 模块被导入以触发注册
- 调试时需要查看 Registry 状态而非阅读 switch 代码
