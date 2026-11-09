# pnpm overrides 治理策略

`package.json` 的 `pnpm.overrides` 用强制版本覆盖整棵依赖树。它是安全补丁的主要手段，但也最容易失去可追溯性：一条 override 会影响所有传递依赖，且在无人察觉的情况下掩盖上游新公告。

## 现状与分类

当前共 101 条 override，按用途分三类：

1. **安全修复**：为已知公告强制最低安全版本（如 `tar`、`tar-fs`、`undici`、`dompurify`、`lodash`、`js-yaml`、`form-data`、`ws`、`axios`）。这类必须保留，并应附公告编号。
2. **兼容性/行为修复**：上游版本与工作区其他依赖冲突时的钉死（如 `@types/react`、`esbuild`、`vite`）。上游修复发布后应移除。
3. **浮动范围**（22 条，形如 `>=x.y.z`）：用于让传递依赖跟随较新版本，主要出现在 `minimatch` / `brace-expansion` 一线。浮动范围的代价是无法复现历史构建。

## 规则

- **新增 override 必须登记理由**。在 `security/audit-exceptions.json` 追加条目（`package` 或 `paths` + `reason` + `owner` + `expires`），或在本文件相应分类下说明。
- **安全类 override 应写明公告编号**（GHSA / CVE）。没有编号的按兼容性修复处理。
- **浮动范围应逐步替换为精确下限**。`>=` 允许意外的大版本跳跃，优先写成 `^x.y.z` 或确切版本。
- **每条 override 必须有到期复核日**，默认不超过 12 个月。

## 复核流程

每季度执行：

```sh
pnpm audit --json > audit.json
node scripts/vulnerability-report.js < audit.json
```

对每条 override 判断：上游是否已发布安全版本？若已发布，移除 override 并升级依赖；若仍需要，更新到期日并记录为什么仍不能移除。

## 已知例外

- `@lmstudio/sdk>zod`：SDK 仍固定 `zod ^3.22.4`，与工作区 zod 4 冲突。详见 `security/audit-exceptions.json` 中 `GHSA-mrhx-c7xc-m3w5`，到期 2026-12-31。
- 22 条 `>=` 浮动范围集中在 ESLint 与 `minimatch` 生态，属于"让传递依赖取较新补丁"的临时手段，非长期方案。
