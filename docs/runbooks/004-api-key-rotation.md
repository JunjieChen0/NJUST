# Runbook 004: Provider API 密钥轮换

## 症状

- API 请求返回 `401 Unauthorized` 或 `403 Forbidden`
- 扩展显示 "Invalid API key" 或 "Authentication failed"
- 切换到新 Provider 后任务无法继续执行
- 密钥泄露后需要紧急更换

## 诊断步骤

### 1. 确认密钥状态

在设置界面检查当前 Provider 配置：

- API Key 字段是否有值
- 密钥是否已过期（检查 Provider 管理后台）
- Base URL 是否正确

### 2. 验证 SecretStorage 同步

```bash
# 检查加密存储文件
ls -la ~/.vscode/extensions/njust-ai.cline-*/globalStorage/secrets.enc
# Linux 确认权限为 600
stat -c '%a' secrets.enc
```

### 3. 测试密钥有效性

使用 curl 直接测试 API 密钥：

```bash
# OpenAI
curl -H "Authorization: Bearer $API_KEY" https://api.openai.com/v1/models

# Anthropic
curl -H "x-api-key: $API_KEY" -H "anthropic-version: 2023-06-01" \
  https://api.anthropic.com/v1/messages

# OpenRouter
curl -H "Authorization: Bearer $API_KEY" https://openrouter.ai/api/v1/models
```

### 4. 检查 Provider Profile

确认当前激活的 Provider Profile 包含正确的密钥：

在设置界面 → Provider Profiles → 检查当前激活的配置

## 解决方案

### 正常密钥轮换

1. **在 Provider 管理后台生成新密钥**

2. **在扩展中更新密钥：**

    - 打开设置 → 选择对应 Provider
    - 粘贴新的 API Key
    - 点击保存

3. **验证新密钥生效：**

    - 发送一条测试消息
    - 确认 API 调用成功

4. **撤销旧密钥：**
    - 回到 Provider 管理后台
    - 删除或禁用旧密钥
    - 确认扩展不再使用旧密钥

### 通过 Provider Profile 管理多密钥

1. 创建新的 Provider Profile：
    ```
    设置 → Profiles → Create New Profile
    ```
2. 在新 Profile 中配置新密钥
3. 激活新 Profile：
    ```
    Profiles → Activate "New Profile Name"
    ```
4. 删除旧 Profile

### 紧急密钥撤销

如果密钥泄露：

1. **立即在 Provider 后台撤销密钥** — 这是最紧急的步骤
2. 生成新密钥
3. 在扩展中更新密钥
4. 检查访问日志确认无未授权访问
5. 如果密钥存储在 SecretStorage 中，清除并重新存储

### 批量密钥更新

对于使用 OpenRouter 等聚合平台的场景：

1. 使用 OAuth 回调自动获取新密钥：
    ```
    设置 → OpenRouter → Login with OpenRouter
    ```
2. 浏览器完成 OAuth 流程
3. 密钥自动更新到当前 Profile

## 预防措施

- 定期轮换 API 密钥（建议每 90 天）
- 使用 Provider Profile 隔离不同环境的密钥
- 启用 SecretStorage 加密存储（非明文）
- 监控 API 使用量异常（密钥泄露指标）
- 在 CI/CD 中使用环境变量而非硬编码密钥
