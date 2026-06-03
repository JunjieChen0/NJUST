# ADR-001: ITaskHost 接口打破 webview↔task 循环依赖

## Status

Accepted

## Context

Task.ts 和 ClineProvider.ts 之间存在双向依赖关系。Task 需要调用 ClineProvider 的方法（获取状态、发送 webview 消息、管理配置），而 ClineProvider 需要创建和管理 Task 实例。在 Phase 1 之前，这两个文件分别膨胀到 5181 行和 3376 行，任何改动都需要同时修改两个文件，形成高耦合的代码瓶颈。

TypeScript 的循环导入虽然在运行时可以工作（通过延迟求值），但会导致：

- 模块初始化顺序不确定
- 单元测试需要 mock 整个依赖链
- 代码审查时需要同时理解两个大文件

## Decision

定义 `ITaskHost` 接口在 `src/core/task/interfaces/` 中，作为 Task 对外部宿主（ClineProvider）需求的抽象契约。

依赖方向变为单向：

```
ClineProvider (webview/)  ──implements──▶  ITaskHost (task/interfaces/)
Task (task/)              ──depends on──▶  ITaskHost (task/interfaces/)
```

关键设计原则：

- ITaskHost 只包含 Task 实际需要的宿主方法（约 15+ 方法）
- ClineProvider 实现 ITaskHost，但 Task 只通过 WeakRef<ITaskHost> 引用宿主
- WeakRef 避免 Task 持有 ClineProvider 的强引用导致内存泄漏

## Consequences

**正向：**

- 彻底消除 webview↔task 的循环导入，依赖图变为 DAG
- Task 可以独立于 ClineProvider 进行单元测试（mock ITaskHost 即可）
- Task.ts 和 ClineProvider.ts 可以独立演进，只需同步 ITaskHost 接口
- 为后续 Task.ts 拆分为多个子模块（TaskExecutor、TaskLifecycleHandler 等）奠定基础

**负向：**

- ITaskHost 接口方法较多（15+），需要随 Task 需求变化同步更新
- WeakRef 引入额外的 `deref()` 调用和 null 检查
- 新开发者需要理解接口注入模式才能修改 Task-Provider 交互
