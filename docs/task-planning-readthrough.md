# 任务规划相关代码精读笔记

本文档为「任务规划代码阅读指南」计划的三项待办落实：**TaskExecutor 主循环**、**new_task 委托链**、**会话 Todo 与 TaskBoard 对比**。不修改行为，仅记录代码事实与调用关系。

---

## 1. `recursivelyMakeClineRequests` 与 `attemptApiRequest` 的衔接

**位置**：[src/core/task/TaskExecutor.ts](src/core/task/TaskExecutor.ts)

### 栈 `StackItem[]`

- 入口将 `{ userContent, includeFileDetails }` 压栈（约 644 行），`while (stack.length > 0)` 每次 `pop` 得到当前轮输入。
- **流失败重试**：catch 中 `stack.push` 相同 `userContent`、`retryAttempt+1`（约 1479–1484 行）。
- **空助手消息重试**：用户拒绝重试或 auto 重试时同样 `stack.push`（约 1875–1899 行）。

### 每轮 API 前的状态重置

- 在消费流之前，将 `assistantMessageContent` 清空、`userMessageContent` 清空、`userMessageContentReady = false`（约 876–882 行），并重置工具/流式解析相关标志（约 883–897 行）。
- **流来源**：`const stream = t.attemptApiRequest(...)`（约 909 行），随后 `asyncIterator` 读取 chunk 并驱动 `NativeToolCallParser`、写入 `assistantMessageContent` 等。

### 流结束后的回合推进

- `didCompleteReadingStream = true`（约 1511 行），补齐未完成流式 tool call（1521 行起）。
- `await pWaitFor(() => t.userMessageContentReady)`（约 1785 行），等待 `presentAssistantMessage` 把工具结果写入 user 侧。
- 若本轮**没有任何** `tool_use`：累加 `consecutiveNoToolUseCount`，可能 SAY `MODEL_NO_TOOLS_USED`，并向 `userMessageContent` 推入 `formatResponse.noToolsUsed()`（约 1793–1808 行）。
- **继续下一轮**：若 `userMessageContent.length > 0` **或** `t.isPaused`，则 `stack.push({ userContent: [...t.userMessageContent], includeFileDetails: false })`（约 1814–1820 行）。  
  - `isPaused` 分支保证子任务暂停时仍向栈追加条目，恢复后循环可继续。

### 返回值

- 正常耗尽栈：末尾 `return false`（约 1937–1938 行）。
- 内层 `catch`：`return true`，便于外层结束（约 1926–1933 行）。

### 子任务 Token

- `checkSubtaskTokenBudget()`（约 614–628 行）：存在 `parentTask` 时对比父剩余窗口与子任务用量并 `console.warn`。

---

## 2. `NewTaskTool` → 子任务与栈、`SubTaskContextBuilder`

**工具**：[src/core/tools/NewTaskTool.ts](src/core/tools/NewTaskTool.ts)

- 校验 `mode` / `message`，可选 `todos`、`isolation_level`；`newTaskRequireTodos` 配置可强制要求 checklist。
- 用户批准后通过 `ITaskHost`（`task.providerRef`）调用 `**delegateParentAndOpenChild**`（见 [NewTaskTool.ts](src/core/tools/NewTaskTool.ts)），传入 `parentTaskId`、`message`、`initialTodos`、`mode`、`isolationLevel`（`forked` 或默认 `shared`）。

**委托实现**：[ClineProvider.delegateParentAndOpenChild](src/core/webview/ClineProvider.ts)（`ITaskHost` 契约与此一致）

- 校验当前任务与 `parentTaskId` 一致；`flushPendingToolResultsToHistory`；`removeClineFromStack({ skipDelegationRepair: true })`；`handleModeSwitch(mode)`。
- `createTask(message, ..., parent, { initialTodos, initialStatus: "active", startTask: false })`；持久化父 history 后再 `child.start()`。
- `**forked**`：若未传 `forkedContextSummary`，用 `**generateParentContextSummary**`（[SubTaskContextBuilder.ts](src/core/task/SubTaskContextBuilder.ts)）从父 `apiConversationHistory` 生成摘要，写入子任务。

另：[TaskDelegationManager.ts](src/core/webview/TaskDelegationManager.ts) 内有结构相近实现，与 ClineProvider 并行；**当前入口为 Provider**（该文件未在宿主侧实例化）。

**任务栈（运行时）**：仍以 [ClineProvider](src/core/webview/ClineProvider.ts) 的 `**clineStack: Task[]`** 为事实来源（见下文「栈变更入口审计」）；[TaskStack](src/core/task/TaskCenter.ts) 仅为 **可复用的 LIFO 抽象**（测试/未来重构），[webview TaskCenter](src/core/webview/TaskCenter.ts) 为与 `clineStack` 对齐的 **模块草稿**（尚未替代 Provider 内实现）。

---

## 3. `update_todo_list` 与 TaskBoard / `task_*` 工具


| 维度       | 会话 Todo（`update_todo_list`）                                                                                              | TaskBoard（`task_create` 等）                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **存储**   | `Task.todoList`（内存），经 `setTodoListForTask` 赋值（[UpdateTodoListTool.ts](src/core/tools/UpdateTodoListTool.ts) 约 149–151 行） | `{cwd}/.roo/tasks/{taskId}.json`（[TaskBoard.ts](src/core/task/TaskBoard.ts)）                                                                            |
| **模型工具** | `update_todo_list`，需审批（`askApproval`）                                                                                    | `task_create`、`task_update`、`task_list`、`task_get` 等（如 [TaskCreateTool.ts](src/core/tools/TaskCreateTool.ts) 使用 `new TaskBoard(task.cwd, task.taskId)`） |
| **条目模型** | `TodoItem`（id/content/status，来自 checklist 解析）                                                                            | `TaskBoardItem`（UUID、title、priority、dependsOn、状态机等）                                                                                                     |
| **用途**   | 会话内 checklist，与 UI todo 同步                                                                                               | 工作区内持久化「任务看板」，可与会话并行存在                                                                                                                                  |


**注意**：`new_task` 的 `**todos`**（解析为 `initialTodos`）是子任务 **构造参数**；与 `update_todo_list` 写当前 `Task.todoList`、与 `task_*` 写 `.roo/tasks/*.json` 是三条通路，互不自动同步。

### 三张对照表（读/写/迁移）

| 规划数据 | 谁会读（典型） | 谁会写（典型） |
| -------- | -------------- | -------------- |
| 会话 Todo（`update_todo_list` → `Task.todoList`） | 系统提示词/会话上下文中 checklist；侧栏 Todo 与任务历史 | 模型调用 `update_todo_list`（需审批）；恢复会话时可能从持久化恢复 |
| TaskBoard（`.roo/tasks/{taskId}.json`） | `task_get` / `task_list` 工具；需要持久化、依赖、跨轮次引用时 | `task_create` / `task_update` 等 |
| `new_task` 的 `todos` | 子任务 **首帧** 初始 `TodoItem[]`（经 `CreateTaskOptions.initialTodos`） | 仅 `new_task` 工具批准路径 |

**迁移与弃用策略（当前代码事实）**

- **保留双轨**为常态：会话 Todo 偏「本轮对话可见」；TaskBoard 偏「项目内结构化任务与依赖」。合并存储需产品决策与双写/冲突策略，未实施前以本文三张表为准。
- 若将来 **只保留 TaskBoard**：需将会话 Todo 导出为 Board 条目或一次性迁移脚本（旧会话仅有 `Task.todoList` 无 JSON）。
- 若将来 **只保留会话 Todo**：需废弃 `task_*` 工具与 `.roo/tasks` 目录约定，并处理已有 JSON 的只读/导入。

---

## 4. 任务栈变更入口审计（`clineStack`）

**事实来源**：[ClineProvider](src/core/webview/ClineProvider.ts) 私有字段 `clineStack`。

**唯一可变路径（生产代码）**

| 操作 | 入口 | 说明 |
| ---- | ---- | ---- |
| `push` | `addClineToStack(task)` | 新任务入栈；`TaskDelegationManager.createTask`、恢复/创建路径等调用 |
| `pop` | `removeClineFromStack(options?)` | 栈顶任务出栈并 `abortTask`；委托父任务时可用 `skipDelegationRepair` |
| 原位替换 | `rehydrateCurrentTaskInPlace`（private） | 仅替换栈顶元素，用于无闪烁恢复等 |
| 读栈 | `getCurrentTask`、`getTaskStackSize`、`clineStack[i]` 查找 | 不修改数组长度 |

**外部直接调用 `removeClineFromStack` 的入口示例**：[registerCommands.ts](src/activate/registerCommands.ts)、[extension/api.ts](src/extension/api.ts)（API 删队列等场景）。**不应**在扩展宿主内绕过 Provider 直接 `clineStack.push/pop`。

**不变量测试（跟读）**：[removeClineFromStack-delegation.spec.ts](src/__tests__/removeClineFromStack-delegation.spec.ts)（委托与 `skipDelegationRepair`）、[single-open-invariant.spec.ts](src/__tests__/single-open-invariant.spec.ts)（单开）、[provider-delegation.spec.ts](src/__tests__/provider-delegation.spec.ts)（委托前后顺序）。

---

## 相关测试（可选跟读）

- [src/**tests**/new-task-delegation.spec.ts](src/__tests__/new-task-delegation.spec.ts)
- [src/core/webview/**tests**/ClineProvider.spec.ts](src/core/webview/__tests__/ClineProvider.spec.ts)（栈深度、`clineStack`）
- [src/core/tools/**tests**/newTaskTool.spec.ts](src/core/tools/__tests__/newTaskTool.spec.ts)

