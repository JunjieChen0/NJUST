# Runbook 006: Bundle Size / 激活性能回归排查

## 区分 CI 门禁与性能目标

当前 `bundle-size-check` 构建扩展后执行 `pnpm check:bundle-size`，硬门槛是 `src/dist/extension.js` 不超过 30 MiB（`30 * 1024 * 1024` 字节）。脚本会报告 dist 各组成部分，但没有对 dist 总体积单独设置 120 MB 门禁。

ADR-006 中的激活 P95/P99、黄色预警和 2026-06 体积数据是设计目标或历史快照，不是本次构建的实测结论。Code QA 没有单独的 `report-activation-perf` 作业；Nightly 激活冒烟也不等于完成 P95/P99 性能测量。

## 构建与体积复核

从仓库根目录执行：

```bash
pnpm bundle
pnpm check:bundle-size
node scripts/check-bundle-size.mjs --json
```

记录代码提交、构建方式、Node/pnpm 版本和输出。检查生产构建时使用 `pnpm --dir src bundle --production`；不要直接运行缺少 `--production` 的 `esbuild.mjs` 后称其为生产体积。

比较依赖或构建配置变化时，关注整个 SDK 引入、重复版本、静态资源和动态 `require`。如需 metafile，应先确认当前构建确实生成该文件；CI 目前没有保证上传每次构建的 metafile，不能假设总能下载到历史文件。

## 激活性能复核

1. 在实际 VS Code 中打开 `Developer: Startup Performance`，结合 Extension Host 日志确认慢在哪个阶段。
2. 审查 `src/extension.ts` 中新增的同步工作和阻塞初始化，不要仅凭 `await` 数量判定性能。
3. 收集实际 `extension_activated` 事件后，显式指定遥测目录：

```bash
node scripts/report-activation-perf.mjs <actual-telemetry-directory> --days=7 --json
```

扩展将遥测目录传为实际 `context.globalStorageUri.fsPath`；脚本默认猜测的旧扩展 ID 路径可能不适用于当前变体或 Profile。`sampleCount: 0` 表示没有样本，不表示性能达标。记录样本数、冷/热启动分布和时间范围后，再与目标比较。

## 安装包验收

涉及构建清单或资源复制时，另按[测试指南](../development/testing.md#已打包-nightly-的冒烟测试)运行真实 VSIX 冒烟，确认激活及设置命令可用。记录包的 SHA-256，不沿用不同代码或不同安装包的结论。

## 参考

- [ADR-006：性能预算](../adr/006-performance-budget.md)
- [当前覆盖率配置与测试方式](../development/testing.md#覆盖率)
- `scripts/check-bundle-size.mjs`
- `scripts/report-activation-perf.mjs`
