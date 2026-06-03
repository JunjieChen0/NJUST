# Runbook 005: 高 Token 消耗诊断

## 症状

- API 账单出现异常高额费用
- 单个任务消耗超过预期的 Token 量
- 上下文窗口频繁达到限制（`prompt_too_long` 错误）
- Token 使用量仪表板显示异常增长趋势

## 诊断步骤

### 1. 定位高消耗任务

使用 TaskHistoryService 查询任务级别的 Token 消耗：

```typescript
// 按成本排序任务
const tasks = await taskHistory.getAllTasks()
const sorted = tasks.sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0))
// 查看前 10 个最贵的任务
```

### 2. 分析任务消息长度

检查 `apiConversationHistory` 中的消息大小：

```typescript
const task = await getTaskWithId(taskId)
const messages = task.apiConversationHistory
const totalTokens = messages.reduce((sum, msg) => {
	return sum + estimateTokenCount(msg.content)
}, 0)
```

### 3. 检查上下文压缩状态

确认 `condenseContext` 是否被正确触发：

- 查看任务日志中的 `context_condensed` 事件
- 检查 `compactFailureCount` — 连续压缩失败次数
- 确认 `autoCondenseContext` 设置已启用

### 4. 审查工具调用模式

高 Token 消耗的常见原因：

| 模式         | 影响                       | 检测方法                   |
| ------------ | -------------------------- | -------------------------- |
| 重复文件读取 | 大量文件内容反复加入上下文 | `read_file` 调用频率       |
| 工具调用循环 | 相同工具反复调用无进展     | `consecutiveMistakeCount`  |
| 长工具输出   | 单次工具返回大量数据       | 工具结果 Token 数          |
| 上下文未压缩 | 对话历史无限增长           | `condenseContext` 调用频率 |

### 5. 使用 QueryProfiler

如果已启用 `QueryProfiler`：

```typescript
const profiler = new QueryProfiler()
const report = profiler.getReport(taskId)
// 查看每轮 API 调用的 input/output token 分布
// 识别 token 增长最快的轮次
```

## 解决方案

### 上下文压缩失败

1. 检查 `compactFailureCount` 值
2. 如果 ≥3（circuit breaker 阈值），检查 API 是否支持压缩端点
3. 手动触发压缩：
    ```
    任务界面 → Condense Context 按钮
    ```
4. 如果持续失败，考虑创建新任务继续工作

### 工具调用循环

1. 检查 `consecutiveMistakeCount` — 如果达到限制（默认 12），任务会自动终止
2. 审查 Agent 的系统提示词，确保工具使用说明清晰
3. 检查工具定义是否有歧义导致 Agent 误用

### 减少文件读取开销

1. 配置 `.rooignore` 排除不需要读取的大型文件/目录
2. 使用 `maxWorkspaceFiles` 限制工作空间文件列表
3. 对于大型代码库，使用 code index 而非全文件读取

### 配置 Token 预算

```json
{
	"maxTokensPerTask": 100000,
	"autoCondenseContext": true,
	"autoCondenseContextPercent": 70
}
```

- `maxTokensPerTask` — 单任务 Token 上限
- `autoCondenseContext` — 启用自动上下文压缩
- `autoCondenseContextPercent` — 上下文使用率达到此百分比时触发压缩

## 预防措施

- 启用 `autoCondenseContext` 并设置合理的压缩阈值
- 配置 `maxTokensPerTask` 预算限制
- 监控 `token_usage` 遥测事件，设置异常告警
- 定期审查 TaskMetrics 中的 Token 消耗趋势
- 为大型任务使用子任务分解（`startSubtask`），隔离 Token 预算
- 配置 `.rooignore` 排除大型二进制文件和生成文件
