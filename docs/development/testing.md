# 测试指南

本文档介绍如何为 NJUST_AI 项目编写和运行测试。

命令从仓库根目录执行。依赖安装使用 `pnpm install`；脚本以各包的 `package.json` 和 `.github/workflows/code-qa.yml` 为准。覆盖率快照和固定测试数量只代表对应代码版本。

## 目录

- [测试架构](#测试架构)
- [运行测试](#运行测试)
- [编写测试](#编写测试)
- [覆盖率](#覆盖率)
- [E2E 测试](#e2e-测试)

## 测试架构

```
NJUST_AI (Monorepo - pnpm + turbo)
│
├── src/                              # VS Code 扩展主包
│   ├── vitest.config.ts              # Vitest 配置
│   ├── vitest.setup.ts               # 全局 setup (nock 禁网)
│   ├── __mocks__/                    # VS Code API mock
│   └── **/*.test.ts                  # 新单元测试；兼容已有 .spec.ts
│
├── webview-ui/                       # React Webview UI
│   ├── vitest.config.ts              # Vitest 配置 (jsdom)
│   ├── vitest.setup.ts               # 全局 setup (jest-dom)
│   ├── src/__mocks__/                # 组件 mock
│   └── src/**/*.test.tsx             # 新 UI 测试；兼容已有 .spec.tsx
│
├── packages/                         # 共享包
│   ├── core/                         # 核心逻辑
│   ├── types/                        # 类型定义
│   └── vscode-shim/                  # VS Code shim
│
└── apps/
    └── vscode-e2e/                   # E2E 测试 (Mocha + @vscode/test-electron)
```

### 测试框架

| 包                 | 测试框架                      | 环境         |
| ------------------ | ----------------------------- | ------------ |
| `src/`             | Vitest                        | Node.js      |
| `webview-ui/`      | Vitest + jsdom                | 浏览器模拟   |
| `packages/*`       | Vitest                        | Node.js      |
| `apps/vscode-e2e/` | Mocha + @vscode/test-electron | VS Code 实例 |

## 运行测试

### 运行所有测试

```bash
pnpm test
```

这是 Turborepo 的各包测试任务，**不包含真实 VS Code Extension Host E2E**；E2E 和 VSIX 冒烟需要单独运行。

### 运行特定包的测试

```bash
# src 包
pnpm --dir src test

# webview-ui 包
pnpm --filter @njust-ai/vscode-webview test

# packages/core 包
pnpm --filter @njust-ai/core test
```

### 运行覆盖率报告

```bash
# src 覆盖率
pnpm test:coverage

# webview-ui 覆盖率
pnpm --filter @njust-ai/vscode-webview test:coverage
```

### 运行单个测试文件

```bash
pnpm --dir src exec vitest run core/task/__tests__/Task.verificationSummary.test.ts
```

### 监听模式

```bash
pnpm --dir src exec vitest watch
```

## 编写测试

### 文件命名规范

- 新测试文件：`*.test.ts` 或 `*.test.tsx`；已有 `*.spec.ts` / `*.spec.tsx` 继续兼容，不要求批量重命名。
- 测试目录：`__tests__/`
- Mock 文件：`__mocks__/`

详细约定见[测试命名规范](../compose/task-lists/test-naming-convention.md)。`vi.mock()` 路径相对于测试文件计算，必须与被测代码导入指向同一文件。

### 基本结构

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

describe("MyFunction", () => {
	beforeEach(() => {
		// 清理 mock
		vi.clearAllMocks()
	})

	it("should do something", () => {
		// Arrange
		const input = "test"

		// Act
		const result = myFunction(input)

		// Assert
		expect(result).toBe("expected")
	})

	it("should handle errors", () => {
		expect(() => myFunction(null)).toThrow("Invalid input")
	})
})
```

### Mock VS Code API

```typescript
// 使用自动 mock
import { vscode } from "../__mocks__/vscode"

// 或者手动 mock
vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	workspace: {
		getConfiguration: vi.fn(),
	},
}))
```

### Mock 文件系统

```typescript
import { vol } from "memfs"

vi.mock("fs/promises", async () => {
	const memfs = await vi.importActual("memfs")
	return memfs.fs.promises
})

beforeEach(() => {
	vol.reset()
	vol.writeFileSync("/test/file.txt", "content")
})
```

### 测试 React 组件

```typescript
import { render, screen, fireEvent } from "@testing-library/react"
import { MyComponent } from "./MyComponent"

describe("MyComponent", () => {
  it("renders correctly", () => {
    render(<MyComponent />)
    expect(screen.getByText("Hello")).toBeInTheDocument()
  })

  it("handles click", () => {
    const onClick = vi.fn()
    render(<MyComponent onClick={onClick} />)
    fireEvent.click(screen.getByRole("button"))
    expect(onClick).toHaveBeenCalled()
  })
})
```

## 覆盖率

### 查看覆盖率报告

```bash
# 生成 HTML 报告
pnpm test:coverage

# 报告目录以各包 Vitest 配置中的 coverage.reportsDirectory 和实际输出为准
```

### 覆盖率门槛

| 包            | 行覆盖 | 函数覆盖 | 分支覆盖 | 语句覆盖 |
| ------------- | ------ | -------- | -------- | -------- |
| `src/`        | 68.9%  | 69%      | 60%      | 68%      |
| `webview-ui/` | 55%    | 50%      | 47%      | 55%      |

以上为本次核对的全局门槛；`src/vitest.config.ts` 对沙盒、Cloud Agent、任务和 MCP 等路径还有独立门槛。修改阈值时同步更新本文，以配置文件为准。

### Codecov 集成

Code QA 在 Ubuntu 上分别运行后端、提示词引擎和 Webview 覆盖率任务，并尝试上传到 Codecov。上传步骤配置为 `fail_ci_if_error: false`，上传成功与覆盖率测试通过需要分别判断。

访问 https://codecov.io 查看详细报告。

## E2E 测试

### 运行 E2E 测试

```bash
pnpm --filter @njust-ai/vscode-e2e test:ci
```

该脚本构建扩展和 Webview 后，再编译并启动测试。已经完成构建时可用 `pnpm --filter @njust-ai/vscode-e2e test:run`。Linux 无桌面环境时，在命令前加 `xvfb-run -a`。

CI 使用 VS Code `1.144.0` 和最低支持版本 `1.95.3`。`VSCODE_VERSION` 可选择下载版本；`VSCODE_EXECUTABLE_PATH` 可指定本机可执行文件。`TEST_GREP` / `TEST_FILE` 用于筛选测试。

测试工作区、用户数据和扩展目录均使用系统临时目录。运行时打印 `Test profile (retained for logs)`，该用户目录在测试后保留供诊断；`.vscode-test/` 用作 VS Code 下载缓存，不再存放新测试的用户数据。

### Mock API 模式

启动器自动在动态端口启动 Mock API，并通过 `MOCK_API_URL` 传给测试，结束时关闭。常规 E2E 不依赖真实 LLM API；仓颉验证场景使用测试工具 fixture，不能把这些结果当作真实 SDK 或真实模型任务的验收。

```typescript
// 启动器实现：apps/vscode-e2e/src/runTest.ts
// 场景实现：apps/vscode-e2e/src/suite/verification.test.ts
const mockApiUrl = process.env.MOCK_API_URL
```

### 已打包 Nightly 的冒烟测试

```bash
pnpm vsix:nightly
pnpm --filter @njust-ai/vscode-e2e exec tsc -p tsconfig.build.json
node apps/vscode-e2e/out/apps/vscode-e2e/src/runNightlySmoke.js bin/njust-ai-nightly-<version>.vsix
```

最后一条命令需传入实际文件名；Linux 无桌面环境时加 `xvfb-run -a`。测试在隔离目录安装 VSIX，校验清单声明、语言资源、激活、Webview 就绪及设置命令，并输出安装包 SHA-256。Nightly CI 在该测试通过后上传产物；开发态 E2E 通过不等于安装包已验证。

### 真实仓颉任务评测

按[固定任务说明](../../packages/evals/cangjie/README.md)和[阶段验收规范](../../packages/evals/cangjie/ACCEPTANCE.md)准备 SDK、项目起点与任务运行配置。保留命令、工作目录、退出码、最终 diff、代码状态、人工介入和失败原因。零测试、环境不可用、用户拒绝或取消必须分别记录；人工改代码完成的任务不计为 Agent 独立成功。

## 最佳实践

1. **测试命名**: 使用描述性的测试名称，说明预期行为
2. **AAA 模式**: Arrange（准备）、Act（执行）、Assert（断言）
3. **隔离测试**: 每个测试应该独立，不依赖其他测试的状态
4. **Mock 策略**: 只 mock 必要的依赖，避免过度 mock
5. **边界条件**: 测试正常路径、错误路径和边界条件
6. **避免硬编码**: 使用变量存储测试数据，便于维护

## 常见问题

### Q: 测试运行缓慢怎么办？

A: 使用 `vi.mock()` mock 掉慢速依赖（如文件系统、网络请求），或使用 `--reporter=dot` 减少输出。

### Q: 如何调试测试？

A: 先只运行失败文件，并启用详细报告：

```bash
pnpm --dir src exec vitest run core/task/__tests__/Task.verificationSummary.test.ts --reporter=verbose
```

### Q: 覆盖率报告不准确？

A: 检查 `vitest.config.ts` 中的 `coverage.include` 和 `coverage.exclude` 配置。

## 相关文档

- [Vitest 文档](https://vitest.dev/)
- [Testing Library 文档](https://testing-library.com/)
- [Codecov 文档](https://docs.codecov.io/)
- [文档导航](../README.md)
