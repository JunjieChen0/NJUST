# ADR-003: FileSecretStorage AES-256-GCM 加密方案

## Status

Accepted

## Context

在 VS Code 环境中，API 密钥等敏感凭证通过 `vscode.SecretStorage` API 存储在操作系统密钥链中。但在 CLI 和非 VS Code 环境（如 web 端、headless 服务器）中，该 API 不可用。

需要一种文件级加密存储方案，满足：

- 零外部依赖（不依赖系统密钥链或 HSM）
- 标准加密算法
- 跨平台兼容（Windows/macOS/Linux）
- 密钥自动派生（无需用户记忆密码）

## Decision

使用 AES-256-GCM + scrypt KDF 实现 `FileSecretStorage`：

**加密流程：**

1. 使用 `os.hostname() + os.userInfo().username` 作为密码
2. 通过 scrypt（N=16384, r=8, p=1）派生 32 字节密钥
3. 生成 16 字节随机 IV
4. 使用 AES-256-GCM 加密明文
5. 存储为 `base64(IV || AuthTag || Ciphertext)`

**解密流程：** 逆向操作，验证 AuthTag 确保完整性。

**存储路径：** `<globalStoragePath>/secrets.enc`

## Consequences

**正向：**

- 使用经过验证的标准算法（AES-256-GCM 是 NIST 推荐的认证加密模式）
- 零外部依赖，仅使用 Node.js 内置 `crypto` 模块
- AuthTag 提供认证加密（AEAD），防止篡改
- scrypt 是内存密集型 KDF，抗 GPU 暴力攻击

**负向：**

- 密钥派生基于可预测的 `hostname + username`，同一机器上的其他用户可以推算
- 未绑定 TPM/Secure Enclave，物理攻击者可提取密钥
- 文件权限依赖操作系统默认设置，需额外确保 600 权限
- scrypt 参数选择需平衡安全性与启动延迟（当前参数在大多数机器上 <100ms）
