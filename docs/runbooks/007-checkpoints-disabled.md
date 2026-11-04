# Runbook 007: 存档被禁用与测试数据隔离

## 确认嵌套仓库的来源

提示“在某路径检测到嵌套的 git 仓库”时，先记录完整路径，区分真实项目仓库与 VS Code E2E 缓存。不要直接删除 `.git`、任务或检查点数据。

- `apps/vscode-e2e/.vscode-test/user-data/.../tasks/.../checkpoints` 一类路径可能是旧 E2E 用户数据中的影子仓库。
- `vendor/`、子目录工程等位置的真实 Git 仓库仍会触发保护，即使该路径已写入 `.gitignore`。单纯添加忽略规则不能解除这种限制。

## 当前实现

`src/services/checkpoints/ShadowCheckpointService.ts` 检测嵌套 `.git/HEAD` 时仅额外跳过保留的 `.vscode-test/` 测试缓存目录。`excludes.ts` 同时将该目录排除在影子快照外，避免把未受保护的测试数据纳入回滚。

`apps/vscode-e2e/src/runTest.ts` 将新测试工作区、用户目录和扩展目录创建在系统临时目录；日志中的 `Test profile (retained for logs)` 给出保留的用户目录位置。`.vscode-test/` 仍可保存下载的 VS Code 引擎。

## 恢复步骤

1. 先更新到包含上述修复的版本，记录实际安装版本和包的 SHA-256。
2. 若仍有旧测试用户目录，确认没有测试进程使用它，并将需保留的数据完整备份到工作区外。只处理已经确认来源的测试用户目录，不批量清理下载缓存、真实项目或任务。
3. 执行 `Developer: Reload Window`，再重新打开或恢复受影响任务，使任务内已经禁用的存档状态重新初始化。
4. 若提示指向真实嵌套仓库，调整打开的工作区范围，或在明确了解影响后重新组织工程；不要通过忽略所有嵌套仓库来解除保护。

## 验收

- 对当前工作区重新检测，确认不再因测试缓存误报。
- 在临时工程中实际创建存档并查看差异，确认预期源文件在快照中，测试用户数据不在其中。
- 用独立临时工程确认真实嵌套仓库仍被拒绝，包括被 `.gitignore` 忽略的仓库。
- 保留备份、日志和测试结果。未在真实工作区执行创建或回滚时，应明确说明验证仅覆盖检测或临时工程。

相关自动化测试见 `src/services/checkpoints/__tests__/ShadowCheckpointService.spec.ts` 和 `src/__tests__/e2e-profile.test.ts`；运行方式见[测试指南](../development/testing.md)。
