# Runbook 001: 扩展激活失败排查

## 症状

- VS Code 输出面板显示 "Activating extension 'njust-ai.cline' failed"
- 扩展图标不出现或显示为灰色
- 侧边栏 Webview 显示空白或加载超时
- 开发者工具控制台出现 "SecretStorage is not available" 或 "Configuration migration failed"

## 诊断步骤

### 1. 检查激活错误日志

打开 VS Code 输出面板 → 选择 "Extension Host" → 搜索 "njust-ai.cline"：

```
Error: Activating extension 'njust-ai.cline' failed: <具体错误>
```

常见错误模式：

- `SecretStorage is not available` → SecretStorage 初始化失败
- `ENOENT: no such file or directory, ...config.json` → 配置文件损坏
- `Timeout: extension activation took more than 10 seconds` → 依赖初始化超时

### 2. 验证 SecretStorage 可用性

在 VS Code 开发者工具控制台执行：

```javascript
// 检查密钥链是否可用（macOS Keychain / Windows Credential Manager / Linux libsecret）
// 如果 libsecret 未安装，Linux 上会回退到 FileSecretStorage
```

### 3. 检查配置迁移状态

查看 `~/.vscode/extensions/njust-ai.cline-*/globalStorage/` 目录：

- 确认 `config.json` 存在且可解析
- 确认 `secrets.enc` 权限正确（Linux: 600）

### 4. 检查依赖初始化

在扩展主机日志中搜索以下关键服务的初始化状态：

- `McpServerManager` — MCP 服务器连接
- `ContextProxy` — 配置代理
- `ProviderSettingsManager` — Provider 配置

## 解决方案

### SecretStorage 不可用

**Linux:** 安装 `libsecret`：

```bash
# Ubuntu/Debian
sudo apt install libsecret-1-0 libsecret-1-dev gnome-keyring
# 或回退到文件存储：扩展会自动检测并使用 FileSecretStorage
```

**Windows:** 确认 Windows Credential Manager 服务正在运行。

### 配置文件损坏

1. 备份当前配置：`cp globalStorage/config.json config.json.bak`
2. 删除损坏的配置：`rm globalStorage/config.json`
3. 重启 VS Code — 扩展会使用默认配置重新初始化

### 依赖初始化超时

1. 检查 MCP 服务器配置是否有无效的连接地址
2. 禁用不必要的 MCP 服务器以减少启动延迟
3. 如果网络环境受限，确认代理设置正确

## 预防措施

- 在 CI 中运行扩展激活冒烟测试
- 监控 `extension.activation` 遥测事件中的 P95 延迟
- 配置 SecretStorage 可用性探针，在不可用时主动回退
- 添加配置文件的 schema 验证和自动修复机制
