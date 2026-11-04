# Runbook 003: 命令拦截误报处理

## 记录实际触发条件

保存完整命令、工作目录、当前模式、审批状态、沙盒配置和提示中的原因。自动批准、命令风险分类、路径保护、只检查约束与执行后端是不同的检查，批准一项不代表其他限制已解除。

## 对应实现

| 层                 | 来源                                                                           | 检查内容                                   |
| ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------ |
| 静态分类与规则引擎 | `src/core/tools/permissions/BashCommandAnalyzer.ts`、`PermissionRuleEngine.ts` | 风险模式、注入及写入内容等规则             |
| 命令安全检查       | `src/core/tools/helpers/commandSafety.ts`                                      | 命令安全判断                               |
| 自动批准           | `src/core/auto-approval/`                                                      | `allowedCommands`、`deniedCommands` 等规则 |
| 执行后端           | `src/services/sandbox/`                                                        | Docker 可用性、挂载路径和后端策略          |
| 仓颉只检查限制     | `src/core/verification/checkOnlyGuard.ts`                                      | 禁止写入及自动修复流程                     |

网络访问还受 `packages/core/src/security/networkGuard.ts` 约束，不能把它当作所有终端命令的通用分类器。

## 安全地复现分类

只调用分析函数，不执行被分析的命令。例如，在现有测试中调用：

```typescript
import { BashCommandAnalyzer } from "../BashCommandAnalyzer"

const result = BashCommandAnalyzer.analyze("pnpm test")
expect(result.riskLevel).toBe("safe")
```

相对路径按 `src/core/tools/permissions/__tests__/` 中的测试文件计算。分类结果字段是 `riskLevel`，不是旧示例中的 `risk`。

## 处理方式

- 若是审批配置问题，通过设置界面调整最小必要的命令前缀，并重新保存；同时检查拒绝规则。不要添加笼统的 `git`、任意 Shell 或删除命令来绕开保护。
- 若是分类误报，给分类器添加可复现的安全用例和相近的危险对照，再修正匹配逻辑。
- 若 Docker 不可用或沙盒配置非法，修复后端环境。当前策略不会自动回退到宿主机，见[沙盒说明](../sandbox.md)。
- 若任务明确要求只检查，保留限制；需要修改代码时应先取得相应任务授权。

## 验收

重跑对应分类器、自动批准或沙盒测试。确认安全用例恢复，同时危险对照、用户拒绝和取消仍按预期生效。记录实际执行结果；命令被批准或进入后台不等于执行成功。
