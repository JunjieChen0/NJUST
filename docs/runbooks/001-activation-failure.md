# Runbook 001: 扩展激活失败与命令未注册

## 症状与定位

侧栏空白、扩展激活报错，或出现 `command 'njust-ai-nightly.settingsButtonClicked' not found` 时，先确认安装的是哪个变体，再查看激活日志。命令不存在可能是扩展尚未成功激活，并不只表示按钮配置错误。

1. 在扩展列表和 `Developer: Show Running Extensions` 中核对扩展 ID、版本、运行位置及启用状态。ID 来自已安装清单的 `publisher.name`，普通包、Nightly 和旧安装可能不同。
2. 打开输出面板中的扩展通道（普通构建默认为 `NJUST_AI`），以及 `Log (Extension Host)`。通过 `Developer: Open Logs Folder` 保存完整日志。
3. 从第一条激活异常开始排查，记录错误、堆栈和版本。后续的命令未注册通常只是前面的初始化失败造成的结果。

## 清单与打包检查

检查实际 VSIX 中的 `extension/package.json`，不要只检查源码清单：

- `contributes.commands` 中声明的命令是否使用该变体的前缀；
- `contributes.debuggers` 是否声明 `cangjie`，避免注册调试适配器时因归属未声明而中断激活；
- 语言配置、语法、片段、图标和 Webview 资源是否存在；
- 激活入口是否能继续执行到命令注册。

相关实现：`src/extension.ts`、`packages/build/src/esbuild.ts` 和 `apps/vscode-nightly/esbuild.mjs`。

Nightly 的复核步骤见[测试指南](../development/testing.md#已打包-nightly-的冒烟测试)。该测试安装真实 VSIX 后，校验清单、资源、激活、Webview 与设置命令；保留输出中的 SHA-256，以绑定实际安装包。

## 配置与凭据检查

VS Code 扩展通过 `ExtensionContext.globalState`、`globalStorageUri` 和 `secrets` 存储状态及凭据。用户数据根目录随系统、编辑器和 Profile 变化，扩展数据通常位于其 `User/globalStorage/<extension-id>/` 下，不在扩展安装目录内。

`packages/vscode-shim/src/storage/SecretStorage.ts` 的 `FileSecretStorage` 用于 CLI 等垫片环境，不能据此假设 VS Code 扩展会在密钥链不可用时自动回退到同名文件。

怀疑配置异常时，先备份对应 Profile 和扩展数据，通过设置界面修正当前配置并保存。不要直接删除任务、检查点或凭据目录。

## 修复后的验收

1. 安装对应变体的新 VSIX，执行 `Developer: Reload Window`。
2. 确认扩展激活无异常、侧栏可加载、设置按钮能够打开设置。
3. 记录安装包哈希、扩展版本、VS Code 版本和验证日志。

若错误是存档检测到嵌套 Git 仓库，继续阅读[存档排障](007-checkpoints-disabled.md)。
