# 仓颉任务闭环验收

这套验收串行运行两个项目上的 12 项任务。当前任务清单为 `1.0.0-draft.2`，SDK
固定为 **Cangjie 1.0.5**。任务定义在 `../src/cangjie/suite.ts`，每个任务包含
工程起点、完整需求、允许修改的文件和必须有证据支持的通过条件。

- `projects/minimal`：单包计算工具，包含源码和单元测试。
- `projects/orders`：订单工具，包含本地 `pricing` 依赖、运费子包、单元测试和数据文件。

样例只复制到新的运行目录，不在版本化样例中构建，也不清理已有用户工程。
每次运行保留独立目录，避免上一项任务的修改影响下一项。

## 运行

从仓库根目录先编译入口：

```powershell
pnpm --filter @njust-ai/vscode-e2e exec tsc -p tsconfig.build.json
$env:CANGJIE_HOME = 'D:\Cangjie'
pnpm --filter @njust-ai/vscode-e2e exec node out/apps/vscode-e2e/src/runCangjieEval.js
```

未提供模型配置时，仅检查两个项目的真实 SDK 构建、测试，并把 12 项 Agent
任务记录为 `not-run`。这不是 Agent 能力基线，不能据此计算独立成功率。

真实模型运行使用 OpenAI 兼容接口；按照 `model-config.example.json` 提供接口与
固定模型名，设置 `NJUST_CANGJIE_EVAL_CONFIG` 指向本地配置文件，并在它指定的
环境变量中设置密钥。不要把真实密钥写入配置或提交到仓库。
可设置 `VSCODE_EXECUTABLE_PATH` 复用本机 VS Code，否则使用固定的测试版本。

模型通道可用后，先对保存的旧版扩展运行基线：设置
`NJUST_CANGJIE_EVAL_EXTENSION_PATH` 指向含 `baseline-metadata.json`、扩展清单与
`dist/extension.js` 的冻结目录。运行记录同时保存实际 bundle 的 SHA-256，避免把
新代码上的结果误当成旧基线。候选版本运行时取消该变量。
`NJUST_CANGJIE_EVAL_CASES=CJ02,CJ05` 可选取子集；子集报告不会标为全套完成。

产品流程回归另用固定模型响应和真实 SDK：

```powershell
$env:NJUST_CANGJIE_EVAL_MOCK = '1'
pnpm --filter @njust-ai/vscode-e2e exec node out/apps/vscode-e2e/src/runCangjieEval.js
```

此模式只运行两个工程的功能修改场景，报告标为 `mock-regression`，独立成功数
始终为 0。运行真实模型前移除这个变量。它不能代替真实任务基线或盲测。

## 证据与计分

运行目录包含环境、SDK 命令及退出码、任务清单、每个任务的消息、最终 diff、
系统 `verification.json`、独立行为检查和失败原因。模型的完成文本不能作为
构建、测试或权限检查通过的证据。

- `real-agent`、`sdk-regression`、`mock-regression` 分开记录。
- 普通批准、审批反馈、评测器按用例注入的外部修改、人工改码分开记录。
- 人工改码后的功能通过不计为 Agent 独立成功。
- 已执行的安全用例必须全部通过；未执行也不能记为通过。
- 缺失日志、diff、环境记录或任一必须断言时，该任务不通过。
- 独立行为测试在最终工程的副本中执行，不修改已经交付的工程。

首轮真实模型基线完成前，性能阈值保持空值。`两轮各 10/12` 只是讨论目标，
不能作为已经达到的能力。首轮后再确定任务难度、正式阈值和后续两轮的版本。
更换需求、工程起点或行为判定时必须修改任务集版本，不能把不同版本混合比较。
