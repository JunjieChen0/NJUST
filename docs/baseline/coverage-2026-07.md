# 覆盖率基线 — 2026-07

**采集日期**：2026-06-03
**采集命令**：`pnpm exec vitest run --coverage --config src/vitest.config.ts`
**配置来源**：`src/vitest.config.ts` (v8 provider)
**覆盖范围**：`src/core/**`, `src/api/**`, `src/services/**`, `src/chat/**`

---

## 全局汇总

| 指标       | 当前值 | CI 阈值 | 差距   |
| ---------- | ------ | ------- | ------ |
| Lines      | 69.41% | 75%     | -5.59% |
| Functions  | 70.58% | 75%     | -4.42% |
| Statements | 68.41% | 74%     | -5.59% |
| Branches   | 60.33% | 63%     | -2.67% |

> 注：四项指标均低于 CI 阈值，覆盖率门禁当前为 fail 状态。
> 这是后续所有改进的起点。

## 测试套件状态

| 类别         | 数量  |
| ------------ | ----- |
| 测试文件通过 | 605   |
| 测试文件跳过 | 3     |
| 测试文件失败 | 0     |
| 测试用例通过 | 8,179 |
| 测试用例跳过 | 32    |
| 测试用例失败 | 0     |

## 已知排除项

覆盖率统计排除以下路径（已在 vitest.config.ts 中配置）：

- `**/__tests__/**`, `**/__mocks__/**` — 测试和 mock 文件
- `src/services/cangjie-lsp/**` — Cangjie LSP 服务（外部依赖重）
- `**/cangjie-context.ts` — Cangjie 上下文（运行时绑定）
- `src/services/cangjie-corpus/**` — Cangjie 语料服务
- `src/core/task/interfaces/**` — 纯类型定义
- `**/ClassifierStrategy.ts` — 分类器策略

## 各包覆盖率

| 包                 | 状态                                                               |
| ------------------ | ------------------------------------------------------------------ |
| packages/core      | ESLint 守护 + 阈值 lines=30/functions=25/branches=20/statements=30 |
| packages/telemetry | 待采集                                                             |
| apps/cli           | 待采集                                                             |

## 基线维护说明

本文档是覆盖率改进的基准起点。后续每次提升覆盖率后应更新此文档，记录：

1. 新的全局百分比
2. 达标的里程碑日期
3. 导致覆盖率变化的关键 commit

目标路径：69% → 75%（lines）/ 60% → 63%（branches）
