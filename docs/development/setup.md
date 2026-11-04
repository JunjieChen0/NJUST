# 本地开发与打包

所有命令从仓库根目录执行；安装包输出位于 `bin/`。返回[文档导航](../README.md)。

### 环境要求

- Node.js `>=20.19.2 <25`（CI 默认 `20.19.2`）
- pnpm `10.8.1`（以根 `package.json` 的 `packageManager` 为准）

### 安装与运行

1. 克隆仓库：

```sh
git clone https://github.com/JunjieChen0/NJUST.git
cd NJUST
```

2. 安装依赖：

```sh
pnpm install
```

3. 启动开发模式：

在 VS Code 中按 `F5` 启动调试，会打开一个加载了 NJUST_AI 扩展的新窗口。Webview 和核心扩展的修改都会自动热重载。

### 构建 VSIX

```sh
pnpm vsix
# Nightly 变体（命令前缀和扩展 ID 与普通包不同）
pnpm vsix:nightly
```

生成的 `.vsix` 文件位于 `bin/` 目录下，可通过以下命令安装：

```sh
code --install-extension bin/njust-ai-<version>.vsix
```

安装已有包可直接使用上面的命令；以下脚本会重新安装依赖、清理构建目录并重新打包：

```sh
pnpm install:vsix
```

## 普通版与 Nightly

普通版扩展 ID 使用 `njust-ai`，Nightly 使用 `njust-ai-nightly`。Nightly 是从 main 自动构建的开发预览版，与普通版可分别安装；两者使用同一校徽，但运行配置与命令前缀各自独立。

安装后执行 `Developer: Reload Window`。安装包应记录版本、代码提交和 SHA-256；本地重打包或工作区有未提交内容时，应另行说明，不能直接沿用其他安装包的验证结论。

## 仓颉 SDK

仓颉 CLI 工具需要本机 SDK。配置 `CANGJIE_HOME` 或扩展的工具路径，按 [AGENTS.md](../../AGENTS.md) 中的 LSP 与工具链步骤检查。SDK 不可用时保留明确的阻碍，不把未执行的构建或测试写成通过。

## 验证与排障

- [测试与真实 VSIX 冒烟](testing.md)
- [扩展激活失败](../runbooks/001-activation-failure.md)
- [存档被禁用](../runbooks/007-checkpoints-disabled.md)
