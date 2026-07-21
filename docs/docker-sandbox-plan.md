# Docker 沙盒添加计划

> 状态: 历史提案（未按本文方案实施）
> 创建日期: 2026-06-04
> 最后更新: 2026-07-20

> [!IMPORTANT]
> 本文仅保留早期设计背景，不是当前实现规范。实际代码采用 `SandboxExecutionService` +
> `DockerSandboxRunner` 和 Docker CLI，没有引入 `dockerode` / `DockerTerminal` / `SandboxManager`。
> Docker 不可用或配置非法时 fail closed，绝不自动降级到宿主执行；容器取消/超时通过
> `docker rm -f` 清理，也不会在容器内 kill PID 1。当前行为以 `docs/sandbox.md` 与测试为准。

## 一、目标

为 Roo-Code 添加基于 Docker 容器的安全沙盒，将 AI 执行的命令限制在隔离容器内运行，防止对宿主机造成破坏。文件操作通过 bind mount 保持原有体验。Docker 不可用时优雅降级到非沙盒模式。

## 二、行业背景

| 产品                   | 沙盒类型          | 隔离级别                | 已知问题                                                      |
| ---------------------- | ----------------- | ----------------------- | ------------------------------------------------------------- |
| Cursor                 | 无（黑名单+审批） | 无                      | 拒绝列表可绕过（Base64/子shell/引号混淆），CVE-2025-54135 RCE |
| Trae                   | 无                | 无                      | 无执行隔离                                                    |
| Deno Sandbox           | MicroVM           | 强（内核级）            | 仅 JS/TS/Python，云服务                                       |
| Docker Sandbox（官方） | 容器              | 中（namespace+cgroups） | 需安装 Docker                                                 |
| **本方案**             | Docker 容器       | 中                      | 需安装 Docker                                                 |

## 三、设计决策

| 决策项   | 选择                      | 理由                                                |
| -------- | ------------------------- | --------------------------------------------------- |
| 沙盒目的 | 安全隔离                  | 防止 AI 生成命令破坏宿主机                          |
| 技术方案 | Docker 容器               | 成熟稳定、跨平台、Docker 官方已推出 AI Sandbox 产品 |
| 沙盒范围 | 命令执行 + 文件操作       | 文件操作通过 bind mount 无需额外改动                |
| 文件策略 | bind mount（策略 A）      | 零延迟、无需同步、DiffView 正常工作                 |
| 平台支持 | Windows + Linux + macOS   | Docker Desktop 跨平台可用                           |
| 降级策略 | Docker 不可用时回退非沙盒 | 不强求用户安装 Docker                               |
| 安装引导 | 自动检测 + 引导安装       | 降低用户门槛                                        |
| 默认状态 | 关闭                      | 用户主动启用                                        |

## 四、架构设计

```
┌─────────────────────────────────────────────────────┐
│                  现有工具执行管道                      │
│                                                       │
│  LLM 响应 → ToolRegistry → BaseTool.handle()         │
│    ↓                                                  │
│    ├─ validateInput / checkPermissions / hooks        │
│    ↓                                                  │
│    └─ execute()                                       │
│         ├─ sandbox=false ──→ 现有逻辑（ExecaTerminal） │
│         └─ sandbox=true  ──→ DockerTerminal           │
│                                    ↓                  │
│                            docker exec <container>    │
│                            ┌─────────────────┐        │
│                            │  Docker 容器     │        │
│                            │  /workspace ←→ 宿主机     │
│                            │  (bind mount)    │        │
│                            │  网络: none      │        │
│                            │  cap-drop: ALL   │        │
│                            └─────────────────┘        │
└─────────────────────────────────────────────────────┘
```

核心思路：在现有 `RooTerminalProvider` 体系中新增 `"docker"` 类型，通过 `SandboxManager` 管理 Docker 容器生命周期，对 `BaseTool` 管道和权限系统透明无侵入。

### 现有代码切入点

| 组件         | 文件路径                                        | 切入方式                                          |
| ------------ | ----------------------------------------------- | ------------------------------------------------- |
| 终端类型     | `src/integrations/terminal/types.ts`            | 添加 `"docker"` 到 `RooTerminalProvider` 联合类型 |
| 终端注册     | `src/integrations/terminal/TerminalRegistry.ts` | `createTerminal()` 新增 docker 分支               |
| 命令执行     | `src/core/tools/ExecuteCommandTool.ts`          | 沙盒路由逻辑                                      |
| 任务生命周期 | `src/core/task/Task.ts`                         | 沙盒容器创建/销毁绑定                             |
| 配置读取     | `src/core/config/ContextProxy.ts`               | 读取沙盒配置                                      |
| 配置定义     | `src/package.json`                              | `contributes.configuration` 新增配置项            |
| 设置界面     | webview `SettingsView`                          | 沙盒设置面板                                      |

## 五、分步实施计划

### Phase 1: 基础设施 — Sandbox 核心模块

| #   | 文件                                     | 说明                                             |
| --- | ---------------------------------------- | ------------------------------------------------ |
| 1.1 | `src/services/sandbox/SandboxConfig.ts`  | 沙盒配置类型定义（Zod schema + TypeScript 接口） |
| 1.2 | `src/services/sandbox/DockerClient.ts`   | Docker API 封装（基于 `dockerode` 库）           |
| 1.3 | `src/services/sandbox/SandboxManager.ts` | 容器生命周期管理：创建/启动/停止/销毁            |
| 1.4 | `src/services/sandbox/index.ts`          | 模块统一导出                                     |

#### 1.1 SandboxConfig.ts — 配置类型

```typescript
interface SandboxConfig {
	enabled: boolean
	provider: "docker"
	docker: DockerSandboxConfig
}

interface DockerSandboxConfig {
	image: string // 默认 "ubuntu:22.04"
	memoryMB: number // 默认 512
	cpuCount: number // 默认 1
	networkMode: "none" | "bridge" | "host" // 默认 "none"
	pidsLimit: number // 默认 256
	mountWorkspace: "rw" | "ro" // 默认 "rw"
	readonlyRootfs: boolean // 默认 false
	autoRemove: boolean // 默认 true
	containerTimeoutMinutes: number // 默认 30
	capDrop: string[] // 默认 ["ALL"]
	capAdd: string[] // 默认 []
	extraMounts: Array<{ host: string; container: string; mode: "rw" | "ro" }>
}
```

#### 1.2 DockerClient.ts — Docker API 封装

职责：

- 封装 `dockerode`，屏蔽 socket 路径差异（Windows named pipe vs Unix socket）
- `getDockerSocketPath()` — 按平台返回连接参数
- `ping()` — 检测 Docker 守护进程是否运行
- `pullImageIfNeeded(image)` — 拉取/缓存镜像
- `createContainer(opts)` — 创建容器（资源限制 + 安全参数）
- `execInContainer(containerId, command, cwd)` — 容器内执行命令
- `removeContainer(containerId)` — 销毁容器

#### 1.3 SandboxManager.ts — 生命周期管理

职责：

- `initialize(config)` — 初始化 Docker 客户端
- `createSandbox(workspacePath, config)` — 创建沙盒容器
- `getContainer(taskId)` — 获取任务的容器
- `removeSandbox(taskId)` — 销毁容器
- `cleanup()` — 清理所有沙盒容器

容器创建参数：

```yaml
Image: ubuntu:22.04
WorkDir: /workspace
Name: roo-sandbox-{taskId}
Mounts:
    - Source: ${workspacePath}
      Target: /workspace
      Mode: rw
Tmpfs:
    /tmp: "rw,size=512m"
NetworkMode: none
HostConfig:
    Memory: 536870912 # 512MB
    NanoCpus: 1000000000 # 1 CPU
    PidsLimit: 256
    AutoRemove: true
    ReadonlyRootfs: false
    CapDrop: ["ALL"]
    SecurityOpt: ["no-new-privileges"]
    # Linux only:
    User: "1000:1000" # $(id -u):$(id -g)
Env:
    - LANG=en_US.UTF-8
    - LC_ALL=en_US.UTF-8
```

### Phase 2: 新终端 Provider — DockerTerminal

| #   | 文件                                                 | 说明                                                   |
| --- | ---------------------------------------------------- | ------------------------------------------------------ |
| 2.1 | `src/integrations/terminal/DockerTerminal.ts`        | 实现 `RooTerminal` 接口                                |
| 2.2 | `src/integrations/terminal/DockerTerminalProcess.ts` | 实现 `RooTerminalProcess`，通过 `docker exec` 执行命令 |
| 2.3 | 修改 `src/integrations/terminal/types.ts`            | 添加 `"docker"` 到 `RooTerminalProvider` 联合类型      |
| 2.4 | 修改 `src/integrations/terminal/TerminalRegistry.ts` | 添加 `DockerTerminal` 创建分支                         |

#### 2.1 DockerTerminal.ts

```typescript
class DockerTerminal implements RooTerminal {
	provider: "docker"
	// 复用 BaseTerminal 模式
	// 持有 containerId + SandboxManager 引用
	// runCommand() → 创建 DockerTerminalProcess
	// getCurrentWorkingDirectory() → 返回 /workspace（容器内路径）
}
```

#### 2.2 DockerTerminalProcess.ts

核心执行逻辑：

```typescript
// 通过 execa 调用 docker exec
this.subprocess = execa({
	shell: false,
	cwd: hostWorkspacePath,
})`docker exec -i ${containerId} sh -c "cd ${containerCwd} && ${command}"`
```

- 复用 `ExecaTerminalProcess` 的流式输出、abort、超时模式
- 额外处理：容器不存在时自动重建

#### 2.3 types.ts 修改

```typescript
// 修改前
export type RooTerminalProvider = "vscode" | "execa"
// 修改后
export type RooTerminalProvider = "vscode" | "execa" | "docker"
```

#### 2.4 TerminalRegistry.ts 修改

```typescript
// createTerminal() 新增分支
if (provider === "docker") {
	newTerminal = new DockerTerminal(this.nextTerminalId++, containerId, cwd, sandboxManager)
}
```

### Phase 3: Docker 可用性检测与安装引导

| #   | 文件                                     | 说明                           |
| --- | ---------------------------------------- | ------------------------------ |
| 3.1 | `src/services/sandbox/DockerDetector.ts` | 检测 Docker 安装/运行/权限状态 |
| 3.2 | `src/services/sandbox/InstallGuide.ts`   | 平台相关安装指引数据           |
| 3.3 | 修改 webview UI                          | 沙盒设置面板 + 安装引导弹窗    |

#### 3.1 DockerDetector.ts

```typescript
interface DockerStatus {
	installed: boolean
	running: boolean
	hasPermission: boolean
	version?: string
	socketPath: string
	error?: string
}

class DockerDetector {
	static async detect(): Promise<DockerStatus>
	static getDockerSocketPath(): string
	static getInstallGuide(): InstallGuideInfo
}
```

检测逻辑：

| 平台    | Socket 路径              | 检测命令       | 权限检查                |
| ------- | ------------------------ | -------------- | ----------------------- |
| Windows | `//./pipe/docker_engine` | `where docker` | Docker Desktop 自动处理 |
| Linux   | `/var/run/docker.sock`   | `which docker` | 用户是否在 `docker` 组  |
| macOS   | `/var/run/docker.sock`   | `which docker` | Docker Desktop 自动处理 |

#### 3.2 InstallGuide.ts — 安装指引

| 平台    | 安装方式                                                                     |
| ------- | ---------------------------------------------------------------------------- |
| Windows | Docker Desktop 下载链接（https://www.docker.com/products/docker-desktop）    |
| Linux   | `curl -fsSL https://get.docker.com \| sh` 或 `sudo apt install docker.io` 等 |
| macOS   | Docker Desktop 下载链接                                                      |

#### 3.3 Webview 引导 UI

沙盒启用但 Docker 不可用时，弹窗提示：

- "Docker 未安装" → 显示平台安装命令/链接 + "继续非沙盒模式"按钮
- "Docker 未运行" → "请启动 Docker Desktop" + 重试按钮
- "权限不足(Linux)" → `sudo usermod -aG docker $USER` 提示

设置面板增加"检测 Docker"按钮，实时显示状态。

### Phase 4: 配置系统

| #   | 文件                                   | 说明              |
| --- | -------------------------------------- | ----------------- |
| 4.1 | 修改 `src/package.json`                | 添加沙盒配置项    |
| 4.2 | 修改 `src/core/config/ContextProxy.ts` | 读取/缓存沙盒配置 |
| 4.3 | 修改 webview `SettingsView`            | 沙盒设置面板 UI   |

#### 4.1 package.json 新增配置项

```jsonc
"njust-ai.sandbox.enabled": {
  "type": "boolean",
  "default": false,
  "description": "启用 Docker 沙盒隔离 AI 执行的命令"
},
"njust-ai.sandbox.docker.image": {
  "type": "string",
  "default": "ubuntu:22.04",
  "description": "沙盒容器基础镜像"
},
"njust-ai.sandbox.docker.memoryMB": {
  "type": "number",
  "default": 512,
  "minimum": 128,
  "maximum": 8192
},
"njust-ai.sandbox.docker.cpuCount": {
  "type": "number",
  "default": 1,
  "minimum": 0.25,
  "maximum": 16
},
"njust-ai.sandbox.docker.networkMode": {
  "type": "string",
  "enum": ["none", "bridge", "host"],
  "default": "none"
},
"njust-ai.sandbox.docker.pidsLimit": {
  "type": "number",
  "default": 256,
  "minimum": 16,
  "maximum": 4096
},
"njust-ai.sandbox.docker.mountWorkspace": {
  "type": "string",
  "enum": ["rw", "ro"],
  "default": "rw"
},
"njust-ai.sandbox.docker.containerTimeoutMinutes": {
  "type": "number",
  "default": 30,
  "minimum": 5,
  "maximum": 480
}
```

### Phase 5: 任务级生命周期集成

| #   | 文件                                        | 说明                                     |
| --- | ------------------------------------------- | ---------------------------------------- |
| 5.1 | 修改 `src/core/task/Task.ts`                | 任务启动时创建沙盒，任务结束时销毁       |
| 5.2 | 修改 `src/core/tools/ExecuteCommandTool.ts` | 沙盒启用时路由到 DockerTerminal          |
| 5.3 | 修改 `src/core/tools/ReadFileTool.ts`       | 路径映射提示（容器内路径 vs 宿主机路径） |
| 5.4 | 修改 `src/core/tools/WriteToFileTool.ts`    | 同上                                     |

#### 5.1 Task.ts 集成

```
taskStart()
  → sandboxEnabled ? sandboxManager.createSandbox(workspace, config) → containerId
  → task.sandboxContainerId = containerId

taskEnd() / taskAbort()
  → sandboxManager.removeSandbox(taskId)
  → task.sandboxContainerId = undefined
```

#### 5.2 ExecuteCommandTool.ts 路由逻辑

```typescript
// 当前逻辑
const provider = terminalShellIntegrationDisabled ? "execa" : "vscode"

// 沙盒逻辑
const sandboxEnabled = task.sandboxContainerId !== undefined
const provider: RooTerminalProvider = sandboxEnabled ? "docker" : terminalShellIntegrationDisabled ? "execa" : "vscode"
```

#### 5.3/5.4 文件操作路径

由于采用 bind mount 策略（`/workspace` ↔ 宿主机工作区），文件操作直接在宿主机路径执行，无需路径映射。`ReadFileTool` 和 `WriteToFileTool` 几乎不需要改动。

唯一需处理：`execute_command` 返回的路径是容器内路径（如 `/workspace/src/foo.ts`），需要映射回宿主机路径用于后续的文件操作工具。解决方案：

- 在 Task 上记录 `workspaceHostPath` 和 `workspaceContainerPath` 的映射关系
- 在工具返回结果的后处理中替换路径前缀

### Phase 6: 降级与错误处理

| #   | 文件                     | 说明                      |
| --- | ------------------------ | ------------------------- |
| 6.1 | 修改 `SandboxManager.ts` | Docker 不可用时的降级逻辑 |
| 6.2 | 修改 `Task.ts`           | 沙盒创建失败的回退        |

降级策略：

```
用户启用沙盒 → DockerDetector.detect()
  ├─ 全部通过 → 创建容器 → DockerTerminal
  ├─ 未安装 → 弹窗提示安装 → 用户选择:
  │    ├─ "安装 Docker" → 打开安装指引
  │    └─ "继续非沙盒模式" → 回退到 ExecaTerminal
  ├─ 未运行 → 弹窗提示启动 → 用户选择:
  │    ├─ "重试" → 重新检测
  │    └─ "继续非沙盒模式" → 回退
  └─ 权限不足 → 弹窗提示修复 → 回退
```

容器运行时错误处理：

- 容器崩溃/消失 → 自动重建（最多 3 次）
- `docker exec` 超时 → kill 容器内进程
- Docker 守护进程中途停止 → 回退到非沙盒模式 + 警告

### Phase 7: 测试

| #   | 文件                                                                | 说明                               |
| --- | ------------------------------------------------------------------- | ---------------------------------- |
| 7.1 | `src/services/sandbox/__tests__/SandboxManager.test.ts`             | 容器生命周期测试（mock dockerode） |
| 7.2 | `src/services/sandbox/__tests__/DockerClient.test.ts`               | Docker API 封装测试                |
| 7.3 | `src/services/sandbox/__tests__/DockerDetector.test.ts`             | 跨平台检测逻辑测试                 |
| 7.4 | `src/integrations/terminal/__tests__/DockerTerminal.test.ts`        | DockerTerminal 单元测试            |
| 7.5 | `src/integrations/terminal/__tests__/DockerTerminalProcess.test.ts` | 进程执行测试                       |

#### E2E 手动测试清单

| #   | 场景                | 验证项                                 |
| --- | ------------------- | -------------------------------------- |
| 1   | Docker 已安装且运行 | 沙盒容器创建成功，命令在容器内执行     |
| 2   | Docker 未安装       | 弹窗提示安装，可回退到非沙盒模式       |
| 3   | Docker 未运行       | 弹窗提示启动 Docker Desktop            |
| 4   | Linux 权限不足      | 提示加入 docker 组                     |
| 5   | 命令执行            | `ls`、`pwd`、`cat` 等在容器内正确执行  |
| 6   | 文件操作            | bind mount 双向同步正常                |
| 7   | 网络隔离            | `curl google.com` 在 `none` 模式下失败 |
| 8   | 资源限制            | 内存超限被 OOM kill                    |
| 9   | 容器超时            | 30分钟后容器自动销毁                   |
| 10  | 任务结束            | 容器正确清理                           |
| 11  | 跨平台              | Windows + Linux + macOS 行为一致       |
| 12  | 路径映射            | 容器内 `/workspace` ↔ 宿主机路径正确  |
| 13  | 中文路径            | 工作区路径含中文时正常挂载             |
| 14  | 大输出              | 命令输出 >1MB 时流式传输正常           |
| 15  | 并发任务            | 多个任务各自独立容器                   |

## 六、文件清单

### 新建文件

```
src/services/sandbox/
├── index.ts                        # 模块导出
├── SandboxConfig.ts                # 配置类型 + Zod schema
├── DockerClient.ts                 # Docker API 封装 (dockerode)
├── SandboxManager.ts               # 容器生命周期管理
├── DockerDetector.ts               # Docker 可用性检测
├── InstallGuide.ts                 # 安装指引数据
└── __tests__/
    ├── SandboxManager.test.ts
    ├── DockerClient.test.ts
    ├── DockerDetector.test.ts
    └── sandbox.test.ts             # 集成测试

src/integrations/terminal/
├── DockerTerminal.ts               # Docker 终端实现
├── DockerTerminalProcess.ts        # Docker 终端进程
└── __tests__/
    ├── DockerTerminal.test.ts
    └── DockerTerminalProcess.test.ts
```

### 修改文件

| 文件                                            | 改动范围 | 说明                                |
| ----------------------------------------------- | -------- | ----------------------------------- |
| `src/integrations/terminal/types.ts`            | 1 行     | 添加 `"docker"` 到联合类型          |
| `src/integrations/terminal/TerminalRegistry.ts` | ~5 行    | `createTerminal()` 新增 docker 分支 |
| `src/core/task/Task.ts`                         | ~20 行   | 沙盒容器生命周期绑定                |
| `src/core/tools/ExecuteCommandTool.ts`          | ~10 行   | 沙盒路由逻辑                        |
| `src/core/config/ContextProxy.ts`               | ~5 行    | 读取沙盒配置                        |
| `src/package.json`                              | ~60 行   | 配置项定义 + `dockerode` 依赖       |
| webview `SettingsView`                          | ~50 行   | 沙盒设置面板                        |
| webview 消息类型                                | ~10 行   | 新增沙盒相关消息                    |

## 七、依赖项

| 依赖        | 版本 | 说明                      |
| ----------- | ---- | ------------------------- |
| `dockerode` | ^5.x | Node.js Docker API 客户端 |

选择 dockerode 而非直接 CLI 调用的原因：通过 socket/pipe 通信更可靠，流式输出支持更好，跨平台 socket 路径已内置处理。

## 八、实施优先级与里程碑

```
Milestone 1（核心可用）: Phase 1 + 2 + 3 部分
  → SandboxManager + DockerTerminal + DockerDetector
  → 命令可在容器内执行
  → 预计新增 ~800 行，修改 ~40 行

Milestone 2（可配置）: Phase 4
  → package.json 配置项 + SettingsView UI
  → 用户可通过设置启用/配置沙盒
  → 预计修改 ~120 行

Milestone 3（完整集成）: Phase 5 + 6
  → Task 生命周期 + 降级处理 + 错误恢复
  → 预计修改 ~50 行

Milestone 4（质量保证）: Phase 7
  → 单元测试 + E2E 测试
  → 预计新增 ~600 行测试代码
```

## 九、风险与缓解

| 风险                      | 影响            | 缓解措施                                                     |
| ------------------------- | --------------- | ------------------------------------------------------------ |
| Windows bind mount 性能差 | 大项目 I/O 慢   | 默认关闭沙盒；提供配置项让用户选择                           |
| Linux 容器内文件权限问题  | 写入文件属 root | 传入 `User: "${uid}:${gid}"`                                 |
| dockerode 连接失败        | 沙盒不可用      | DockerDetector 预检 + 优雅降级                               |
| 容器逃逸（极端情况）      | 宿主机被影响    | `cap-drop ALL` + `no-new-privileges` + 网络隔离 + 非特权用户 |
| 大项目首次拉取镜像慢      | 用户体验差      | 镜像拉取进度提示 + 缓存已拉取镜像                            |
| 中文/空格路径挂载失败     | Windows 特定    | 路径规范化 + E2E 测试覆盖                                    |

## 十、跨平台兼容性

### Docker 本身

| 平台    | Docker 支持                | 注意事项                                    |
| ------- | -------------------------- | ------------------------------------------- |
| Windows | Docker Desktop (WSL2 后端) | 需安装 Docker Desktop，依赖 WSL2            |
| Linux   | Docker Engine 原生         | 最佳体验，但需用户在 `docker` 组或有 `sudo` |
| macOS   | Docker Desktop             | 需安装 Docker Desktop，基于 Linux VM        |

### 关键兼容性处理

| 问题                       | 处理方式                                          |
| -------------------------- | ------------------------------------------------- |
| Socket 路径差异            | `DockerDetector.getDockerSocketPath()` 按平台返回 |
| 文件权限（Linux）          | 容器创建时传入 `User: "${uid}:${gid}"`            |
| bind mount 路径（Windows） | dockerode/docker CLI 自动处理盘符映射             |
| 中文/空格路径              | 路径规范化 + E2E 测试覆盖                         |
| Docker Desktop 启动检测    | `docker info` / `docker ping` 检测守护进程状态    |
