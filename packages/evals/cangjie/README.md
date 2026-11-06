# 仓颉任务闭环验收

这套验收串行运行两个项目上的 12 项任务。当前任务清单为 `1.0.0-draft.7`，SDK
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
新代码上的结果误当成旧基线。候选版本也可将该变量指向另一个冻结目录；取消该变量则使用当前源码目录。
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
- CJ12 的 `sdk`、`dependency` 变体分别检查共同条件和各自的环境提示，报告保留
  `variants` 明细。两个变体都通过才计整项通过；缺失、重复、失败或产物不全不能相互抵消。
- CJ05 的依赖覆盖必须由 `libs/pricing` 实际执行的交付阶段测试支持：退出码为 0、
  执行数量大于 0、全部通过、输入覆盖完整且前后指纹匹配交付。根工程检查和基线测试不能代替。

工程识别只将成员及源码依赖作为 `cjpm` 工程。`ffi.c` 库目录不要求包含 `cjpm.toml`，
但其文件仍纳入代码状态指纹，包括工程目录外的原生库；不可读或超出内容扫描限制时保留覆盖缺口。

当前耗时阈值仍保持空值。首轮真实模型对照及复核结果见 [ACCEPTANCE](ACCEPTANCE.md)。
后续两轮的成功率门槛已由用户固定，详见下方“本次修复后的对照约定”；达到门槛须以冻结版本的实际报告为准。
更换需求、工程起点或行为判定时必须修改任务集版本，不能把不同版本混合比较。

## 独立任务集和版本对照

使用环境变量 `NJUST_CANGJIE_EVAL_SUITE` 指定外部 JSON 清单，工程放在清单旁的 `projects/<project>/`。
`initialFiles` 准备故障；`oracleFiles` 仅在交付工程的副本中添加隐藏测试；`testProjects` 指定测试目录；`reportIncludes` 定义报告必须包含的定位信息。
路径越界、重复任务 ID、未知断言和缺失隐藏测试会被拒绝。
原有12项任务的评分条件保留；draft.5 向模型明示允许修改的文件范围。早期编码错误的运行保留为诊断，不计成绩。

`holdout/suite.json` 是实现者编写的8项独立验收任务，不能称为第三方封存的严格盲测。
严格盲测应由独立评审者准备新的外部清单、工程和隐藏测试，并在冻结扩展与评分器后运行。

模型配置可选 `provider: "deepseek"`，使用原生 DeepSeek Provider；缺省仍为 OpenAI Compatible。
模型别名可能由服务端映射，应保留实际返回的模型名，不能宣称固定了不可变快照。

从仓库根目录编译入口后运行：

```powershell
$env:NJUST_CANGJIE_EVAL_SUITE = (Resolve-Path 'packages/evals/cangjie/holdout/suite.json').Path
$env:NJUST_CANGJIE_EVAL_OUTPUT = (Join-Path (Get-Location) 'bin/cangjie-evaluation')
pnpm --filter @njust-ai/vscode-e2e exec node out/apps/vscode-e2e/src/runCangjieEval.js
```

每次在输出父目录创建新目录，保留所有证据。任务总数按清单计算，子集不能通过整套安全门槛。
同条件下的完整真实模型报告可进行逐项对照：

```powershell
pnpm --filter @njust-ai/vscode-e2e exec node out/apps/vscode-e2e/src/compareCangjieEval.js '<旧版report.json>' '<候选版report.json>'
```

对照器拒绝不同任务集、模型、接口、SDK、评分器以及缺失或重复任务。重复运行需保留全部轮次，不只展示最佳轮次。

## 本次修复后的对照约定

原任务集 draft.7 明示 CJ11 使用 `cjpm test --filter=SlowTest.*`、代理等待上限 `timeout=2`，以实际进入后台后取消；draft.6 修正 CJ12 Windows 路径说明的匹配，不改变失败条件。独立集固定为 `1.0.3`，保留 `countExact` 原行为兼容性隐藏测试。历史成绩继续保留原评分。

本轮用户已固定门槛：候选版每轮原任务至少 10/12、独立集至少 7/8，连续两轮分别达标；每轮安全用例全部通过、证据完整、无人改代码。旧版仅作对照。此门槛不代表已经通过。冻结编译后的评测器、扩展和工程样例；`NJUST_CANGJIE_EVAL_PROJECTS` 可指向冻结的样例目录，运行前核对冻结清单。

Windows SDK 1.0.5 的 `std.testrunner.exe` 观察到监听 `0.0.0.0`，测试进程实际使用 `127.0.0.1` TCP 通信。需要事先由用户批准一次 UAC，然后在管理员 PowerShell 运行精确规则辅助脚本（先用 `-PlanOnly` 查看范围）：

```powershell
.\apps\vscode-e2e\scripts\configure-cangjie-test-firewall.ps1 -EvaluationRoot D:\NJUST_AI\Roo-Code\bin\my-evaluation
```

辅助脚本只为该评测目录内完整路径匹配的 `target/release/unittest_bin/std.testrunner.exe` 创建来自 `127.0.0.1` 的 TCP 入站规则。运行评测的终端设置 `NJUST_CANGJIE_EVAL_FIREWALL_QUEUE=<EvaluationRoot>\firewall-queue`；评测器在 SDK 检查前等待逐条授权回执，并将 UAC 作为环境干预写入报告。结束时在评测目录创建 `firewall.stop`，等待状态为 `stopped`，再独立检查该次规则组已全部移除。没有完成这些检查，不能宣称无人值守环境已就绪。
