# Runbook 003: 命令拦截误报处理

## 症状

- 合法的开发命令被阻止执行，显示 "This command has been blocked for safety reasons"
- 命令分类结果为 `dangerous` 或 `forbidden`，但实际操作是安全的
- auto-approval 已配置但仍需要手动确认
- bypass 模式下某些命令仍然被阻止（`forbidden` 级别）

## 诊断步骤

### 1. 确认分类结果

当命令被阻止时，查看消息中的 reason 字段：

```
Command blocked: rm -rf node_modules
Classification: dangerous
Reason: File system deletion (rm -rf)
Layer: BashCommandAnalyzer
```

### 2. 确定分类来源层

命令安全分类有 4 层：

| 层                  | 检查方式     | 结果级别                        |
| ------------------- | ------------ | ------------------------------- |
| BashCommandAnalyzer | 正则模式匹配 | safe/medium/dangerous/forbidden |
| commandSafety       | 语义分析     | safe/medium/dangerous           |
| Auto-approval       | 最长前缀匹配 | allow/deny                      |
| NetworkGuard        | 网络命令限制 | allow/deny                      |

### 3. 测试分类器

使用测试工具验证特定命令的分类结果：

```typescript
import { analyzeBashCommand } from "./BashCommandAnalyzer"
const result = analyzeBashCommand("rm -rf node_modules")
console.log(result) // { risk: "dangerous", reason: "..." }
```

### 4. 检查 auto-approval 配置

查看当前 auto-approval 规则：

```json
{
	"autoApprovalEnabled": true,
	"allowedCommands": ["npm install", "npm run", "git"],
	"alwaysAllowReadOnly": true
}
```

## 解决方案

### 添加命令白名单

对于误判为 `dangerous` 的合法命令：

1. 打开设置 → Auto-Approval 配置
2. 在 `allowedCommands` 中添加命令前缀：
    ```json
    {
    	"allowedCommands": ["npm install", "npm run build", "rm -rf node_modules", "rm -rf dist"]
    }
    ```
3. 白名单使用最长前缀匹配 — `"rm -rf node_modules"` 不会匹配 `"rm -rf /"`

### 处理 forbidden 级别

`forbidden` 命令即使在 bypass 模式下也被阻止。如果确需执行：

1. **不要**将 `forbidden` 命令添加到白名单
2. 手动在终端中执行该命令
3. 如果是误报，向 BashCommandAnalyzer 提交模式修正 PR

### 修正分类器模式

如果 BashCommandAnalyzer 的正则模式有误：

1. 定位 `src/core/tools/permissions/BashCommandAnalyzer.ts`
2. 找到匹配的正则表达式
3. 调整模式以减少误报
4. 添加回归测试用例

## 预防措施

- 为 BashCommandAnalyzer 维护全面的测试用例集（当前 59+ 测试）
- 定期审查误报日志，更新分类器模式
- 为 auto-approval 规则添加注释说明每个白名单的用途
- 使用遥测跟踪命令拦截率和用户手动覆盖频率
