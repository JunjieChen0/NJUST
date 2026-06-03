# ADR-004: 多层命令安全分类器链

## Status

Accepted

## Context

AI Agent 模式下，LLM 会生成 shell 命令供执行。需要防止危险命令（`rm -rf /`、fork bomb、数据擦除等）被直接执行，同时不过度限制正常的开发操作。

挑战在于：

- 命令形式多样（bash、PowerShell、多段管道、引号嵌套）
- 误报会中断用户工作流
- 绕过（bypass）模式仍需要保留底线防护
- 新的攻击向量不断出现

## Decision

实现 4 层纵深防御链：

```
Layer 1: BashCommandAnalyzer (静态模式匹配)
    ↓ pass
Layer 2: commandSafety (语义分析)
    ↓ pass
Layer 3: Auto-approval 最长前缀匹配 (白名单)
    ↓ pass
Layer 4: NetworkGuard (网络命令限制)
    ↓ pass
→ 允许执行
```

**关键设计：**

- 每层独立评估，任一层返回 `forbidden` 则阻止
- `forbidden` 级别命令即使在 bypass 模式下也被阻止（硬编码安全底线）
- `dangerous` 级别命令需要用户手动确认
- 分类结果带有 reason 字段，用于向用户解释为何被阻止

**分层职责：**

- Layer 1：正则匹配已知危险模式（`rm -rf`、`mkfs`、`:(){:|:&};:`）
- Layer 2：语义理解命令意图（文件删除、权限修改、网络外传）
- Layer 3：基于 auto-approval 配置的最长前缀匹配白名单
- Layer 4：限制出站网络命令（`curl`、`wget` 到非本地地址）

## Consequences

**正向：**

- 纵深防御：单层故障不会导致完全绕过
- 用户可见性：每次阻止都带有明确的 reason 和建议
- 可配置性：auto-approval 规则允许用户逐步扩展信任范围
- bypass 模式下的 hardline 防护防止灾难性操作

**负向：**

- 规则维护成本高，需要持续跟踪新的攻击向量
- 复杂的 shell 语法（子 shell、here-doc、process substitution）可能漏检
- 多段命令（`&&`、`||`、`;`、`|`）需要分别分析每段
- Windows 命令（PowerShell、cmd.exe）需要额外的分类器
