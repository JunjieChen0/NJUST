# Docker 沙箱隔离

本文档说明当前 Docker 沙箱实现的配置、镜像要求和使用方法。最后核对日期：2026-07-20。

## 概述

Docker 沙箱为 Agent 命令执行提供操作系统级隔离，确保：

- 命令在容器内运行；仅配置的工作区通过 bind mount 暴露为 `/workspace`（默认可读写）
- 敏感环境变量（API keys、tokens）不会泄漏到容器
- 网络访问默认禁用
- 资源使用（CPU、内存、进程数）受限
- 容器以非 root 用户运行

## 配置

沙箱设置位于 VS Code 设置的 `njust-ai.sandbox.*` 命名空间：

| 配置项                | 类型    | 默认值                      | 说明                                            |
| --------------------- | ------- | --------------------------- | ----------------------------------------------- |
| `backend`             | string  | `"guarded-host"`            | 执行后端：`"guarded-host"` 或 `"docker"`        |
| `dockerImage`         | string  | `"njust-ai/sandbox:latest"` | Docker 镜像名称                                 |
| `networkMode`         | string  | `"none"`                    | 网络模式：`"none"` 或 `"bridge"`                |
| `workspaceAccess`     | string  | `"read-write"`              | 工作区访问权限：`"read-only"` 或 `"read-write"` |
| `memoryMb`            | number  | `512`                       | 内存限制（MB）                                  |
| `cpuLimit`            | number  | `1.0`                       | CPU 限制（核心数）                              |
| `pidsLimit`           | number  | `256`                       | 进程数限制                                      |
| `timeoutSeconds`      | number  | `120`                       | 命令超时时间（秒）                              |
| `taskScopedContainer` | boolean | `true`                      | 任务结束时是否销毁容器                          |

> [!WARNING]
> 仓库当前没有构建或发布 `njust-ai/sandbox:latest` 的 Dockerfile/workflow，公开 Docker Hub
> 接口也未发现该镜像。这个值是配置默认字符串，不代表镜像已发布。启用 Docker 后端前必须配置并拉取
> 经过验证的镜像；拉取或启动失败时执行会 fail closed，不会回退到宿主机。

## 默认镜像要求

配置的镜像必须满足以下要求。下列要求同时描述 Run Code/Cangjie 路径依赖的工具；仓库当前不提供满足这些要求的镜像构建产物。

### 基础系统

- **操作系统**: Ubuntu 22.04 LTS 或 Alpine Linux
- **Shell**: POSIX 兼容的 `/bin/sh`（如 dash、bash）
- **用户**: 非 root 用户（UID 1000）

### 必需工具链

镜像应包含以下工具，路径固定：

| 工具           | 路径                     | 说明                 |
| -------------- | ------------------------ | -------------------- |
| Cangjie SDK    | `/usr/local/bin/cjpm`    | Cangjie 项目管理工具 |
| Cangjie 编译器 | `/usr/local/bin/cjc`     | Cangjie 编译器       |
| Node.js        | `/usr/local/bin/node`    | JavaScript 运行时    |
| npm            | `/usr/local/bin/npm`     | Node.js 包管理器     |
| Python 3       | `/usr/local/bin/python3` | Python 运行时        |
| pip            | `/usr/local/bin/pip3`    | Python 包管理器      |

### 可选工具

以下工具可选但推荐：

- `git`: 版本控制
- `curl`/`wget`: HTTP 客户端
- `jq`: JSON 处理
- `make`: 构建工具

### 参考 Dockerfile（非仓库发布产物）

```dockerfile
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# 安装基础工具
RUN apt-get update && apt-get install -y \
    curl \
    git \
    jq \
    make \
    && rm -rf /var/lib/apt/lists/*

# 安装 Node.js 18
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs

# 安装 Python 3
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# 安装 Cangjie SDK
# 注意：根据实际安装方式调整路径
COPY cangjie-sdk/ /usr/local/
RUN ln -s /usr/local/cangjie/bin/cjpm /usr/local/bin/cjpm \
    && ln -s /usr/local/cangjie/bin/cjc /usr/local/bin/cjc

# 创建非 root 用户
RUN useradd -m -u 1000 sandbox && \
    mkdir -p /workspace && \
    chown sandbox:sandbox /workspace

USER sandbox
WORKDIR /workspace
```

## 构建自有镜像

```bash
docker build -t njust-ai/sandbox:latest .
```

上面的命令仅是命名示例；本仓库根目录没有与该命令对应的 Dockerfile。生产环境应使用自有 registry、固定版本或 digest，并在发布前完成 SBOM 与漏洞扫描。

## 使用自定义镜像

在 VS Code 设置中修改 `njust-ai.sandbox.dockerImage`：

```json
{
	"njust-ai.sandbox.dockerImage": "my-registry/my-sandbox:v1.0"
}
```

自定义镜像必须满足上述要求，特别是：

- 非 root 用户（UID 1000）
- POSIX shell 可用
- 工作目录为 `/workspace`

## 安全约束

Docker 沙箱自动应用以下安全约束：

### 容器创建参数

```bash
docker create \
  --pull never \
  --no-healthcheck \
  --read-only \                          # 只读根文件系统
  --cap-drop ALL \                       # 删除所有 Linux capabilities
  --security-opt no-new-privileges \     # 禁止提权
  --user 1000:1000 \                     # 非 root 用户
  --network none \                       # 禁用网络（默认）
  --memory 512m \                        # 内存限制
  --memory-swap 512m \                   # 禁用 swap
  --cpus 1.0 \                           # CPU 限制
  --pids-limit 256 \                     # 进程数限制
  --tmpfs /tmp:size=64m,noexec,nosuid \  # 可写临时目录
  --mount type=bind,src=<workspace>,dst=/workspace \
  --workdir /workspace \
  --label njust-ai.sandbox=true \
  --label njust-ai.sandbox.task-id=<taskId> \
  --label njust-ai.sandbox.workspace=<workspacePath> \
  --label njust-ai.sandbox.instance=<instanceId> \
  --entrypoint /bin/sh \
  <image> \
  -c "exec sleep infinity"
```

### 环境变量过滤

以下环境变量会被自动过滤，不会传递到容器：

**敏感键**（匹配模式）：

- `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`
- `AWS_SECRET_*`, `AWS_ACCESS_KEY_ID`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- `GITHUB_TOKEN`, `NPM_TOKEN`
- `DATABASE_URL`, `REDIS_URL`, `MONGO_URI`
- 完整列表见 `src/utils/env.ts`

**危险键**（精确匹配，不区分大小写）：

- `LD_PRELOAD`, `LD_LIBRARY_PATH`
- `NODE_OPTIONS`, `NODE_PATH`
- `PYTHONPATH`, `PYTHONSTARTUP`
- `BASH_ENV`
- `DYLD_INSERT_LIBRARIES`
- 完整列表见 `src/utils/env.ts`

### Windows 命令兼容性

Docker 后端使用 Linux 容器，Windows 特有命令会被拒绝：

**拒绝的命令**：

- PowerShell cmdlets: `Get-*`, `Set-*`, `New-*`, `Remove-*`
- Windows 可执行文件: `.bat`, `.cmd`, `.exe`
- PowerShell 语法: `$variable`, `| Out-*`, `| Where-*`
- Windows 路径: `C:\path\to\file`

**解决方案**：
使用 POSIX shell 语法重写命令：

```bash
# Windows (拒绝)
Get-ChildItem -Path C:\project
dir C:\project\*.txt

# Linux (接受)
ls -la /workspace/project
find /workspace/project -name "*.txt"
```

## 并发安全

沙箱实现包含以下并发安全机制：

### 容器创建互斥

- 使用 `pendingCreation` Map 跟踪进行中的容器创建
- task scope 使用 canonical workspace + `resourceScopeId`；workspace shared scope 使用 canonical workspace
- 相同容器 key 的命令串行，不同 key 可并行；全局 `ConcurrencyGate` 保护配置更新与 dispose
- 避免重复创建和孤儿容器

### 配置更新互斥

- 使用 `operationLock` Promise 序列化配置更新和容器访问
- `updateSettings()` 等待所有进行中的操作完成
- `run()` 等待配置更新完成后再执行
- 避免配置切换期间使用旧容器

## 生命周期管理

### 任务作用域容器

- `taskScopedContainer: true`（默认）：任务结束时销毁容器
- `taskScopedContainer: false`：容器跨任务复用
- 容器键：task scope 为 `canonicalWorkspace::task::<resourceScopeId>`；shared scope 为 `canonicalWorkspace::workspace::shared`

### 过期容器清理

扩展检测或刷新 Docker backend 时可清理：

- 带有 `njust-ai.sandbox=true` 标签的容器
- 不属于当前实例（通过 `instanceId` 判断）
- cleanup 失败会向调用方传播，不伪装为清理了 0 个容器

### 配置变更重建

以下配置变更会触发容器重建：

- `networkMode`
- `dockerImage`
- `workspaceAccess`
- `memoryMb`
- `cpuLimit`
- `pidsLimit`

## 审计追踪

每次命令执行都会记录审计信息：

- `executionId`: 执行唯一标识
- `taskId`: 任务 ID
- `resourceScopeId`: 任务/会话实例资源作用域
- `backend`: 使用的后端（`guarded-host` 或 `docker`）
- `requestedBackend` / `dockerStatus`: 策略判定时请求的后端和 Docker 状态
- `cwd`: 实际请求的工作目录
- `containerId`: 容器 ID（Docker 后端）
- `startTime`: 开始时间
- `endTime`: 结束时间
- `exitCode`: 退出码
- `timedOut`: 是否超时
- `cancelled`: 是否取消
- `approvalResult` / `commandSafety` / `interactive` / `bypass`: 审批与安全上下文

审计记录通过 `logger.info("SandboxAudit", ...)` 输出。

## 故障排查

### Docker 未安装

**症状**：选择 Docker 后端但执行失败

**解决**：

1. 安装 Docker Desktop
2. 启动 Docker 服务
3. 点击设置中的 "Check Docker" 按钮验证

### Docker 后启动

**症状**：扩展启动时 Docker 未运行，后来启动 Docker 但执行仍失败

**解决**：

1. 启动 Docker Desktop
2. 点击设置中的 "Check Docker" 按钮
3. 系统会自动检测并创建 Docker runner

### 容器创建失败

**症状**：执行时报错 "Failed to create container"

**可能原因**：

- Docker 服务未运行
- 镜像不存在
- 工作区路径无效
- 资源不足

**解决**：

1. 检查 Docker 状态：`docker info`
2. 拉取你已配置且确认存在的镜像；不要把默认字符串视为已发布镜像
3. 检查工作区路径是否有效
4. 检查系统资源（内存、磁盘）

### Windows 命令被拒绝

**症状**：执行时报错 "Windows-specific command in Linux container"

**解决**：
使用 POSIX shell 语法重写命令（见上文"Windows 命令兼容性"部分）

## 测试

运行沙箱相关测试：

```bash
# 沙箱单元测试
pnpm --dir src test -- services/sandbox

# ExecuteCommand 回归测试
pnpm --dir src test -- core/tools/__tests__/executeCommandTool.spec.ts

# MCP 工具回归测试
pnpm --dir src test -- services/mcp-server/__tests__/tool-executors.spec.ts

# Cloud Agent 回归测试
pnpm --dir src test -- services/cloud-agent
```

## 参考

- 实现代码：`src/services/sandbox/DockerSandboxRunner.ts`
- 配置管理：`src/services/sandbox/SandboxConfig.ts`
- 策略评估：`src/services/sandbox/SandboxPolicy.ts`
- 审计记录：`src/services/sandbox/SandboxAudit.ts`
- 执行服务：`src/services/sandbox/SandboxExecutionService.ts`
