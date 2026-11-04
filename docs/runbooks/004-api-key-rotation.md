# Runbook 004: Provider API 密钥轮换

## 确认失败发生在哪一步

记录当前 Provider Profile、Base URL、模型 ID、出错阶段和 HTTP 状态。模型目录刷新与正式推理使用不同请求，列表返回成功不能单独证明推理凭据有效，列表失败也不能单独证明模型不可用。

密钥只在本地设置界面检查，不写入问题报告、命令行参数、截图或仓库。不要上传原始认证请求头。

## 存储边界

VS Code 扩展的 Provider Profile 由 `src/core/config/ProviderSettingsManager.ts` 通过 `ExtensionContext.secrets` 管理。不要在扩展安装目录中查找或手工编辑旧文档假设的 `globalStorage/secrets.enc`。

CLI 等垫片环境使用 `packages/vscode-shim/src/storage/SecretStorage.ts`，与真实 VS Code 的 SecretStorage 分开排查。配置导出也可能包含敏感字段，分享前必须检查并脱敏。

## 正常轮换

1. 在当前服务商或自建网关的管理界面生成新密钥。
2. 打开扩展设置，选中实际使用的 Profile，检查 Provider、Base URL、自定义认证头和模型 ID。
3. 输入新密钥并点击保存。设置界面的本地编辑缓冲在保存前不会作为正式配置使用。
4. 如需模型发现，手动刷新目录并记录结果；再发送一条最小推理请求验证当前 Profile。
5. 确认新密钥工作后，在服务商管理界面撤销旧密钥。旧 Profile 的清理由用户明确确认后进行。

自建 OpenAI Compatible 服务可能使用自定义认证头。目录请求和推理请求均需核对实际配置，不要同时保留互相冲突的认证值。

## 泄露后的处理

立即在服务商侧撤销泄露密钥，再生成替代密钥。检查访问记录、费用及仓库历史；删除本地文本本身不会撤销远端凭据，也不会清除历史副本。

## 验收

记录所用 Profile、服务端地址（按需脱敏）、模型 ID、目录刷新与推理各自的结果。认证失败不应依靠无限自动重试恢复；修正配置后再明确重试。模型准备、错误分类和重试入口分别见 `src/api/registry/ProviderRegistry.ts`、`src/core/task/TaskRetryHandler.ts`。
