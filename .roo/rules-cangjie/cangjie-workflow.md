# 仓颉语言开发工作流规则

## 1. 环境与工具链

### 1.1 前置条件检测

在执行任何仓颉构建操作前，先确认工具链可用：

```bash
cjpm --version
cjc --version
```

如果命令不存在，提示用户安装仓颉工具链并配置 `PATH` 环境变量。

### 1.2 工具链组件

| 工具 | 用途 | 关键命令 |
|------|------|----------|
| `cjpm` | 项目管理（构建/运行/测试/依赖） | `cjpm build`, `cjpm run`, `cjpm test` |
| `cjc` | 编译器 | `cjc file.cj -o output` |
| `cjlint` | 静态分析 | `cjpm build -l` 或直接 `cjlint` |
| `cjfmt` | 代码格式化 | `cjfmt -f file.cj` |
| `cjdb` | 调试器 | `cjdb ./target/debug/bin/main` |
| `cjcov` | 覆盖率分析 | `cjpm build --coverage && cjcov` |
| `cjprof` | 性能分析 | `cjprof record -p <pid>` |

---

## 2. 项目管理规则

### 2.1 项目初始化

- 始终通过 `cjpm init` 创建项目，不要手动创建 `cjpm.toml`
- 指定项目类型：`--type=executable`（可执行）、`--type=static`（静态库）、`--type=dynamic`（动态库）
- 项目名使用小写字母和下划线

```bash
cjpm init --name my_app --type=executable
```

### 2.2 cjpm.toml 配置

编辑 `cjpm.toml` 时遵守以下规则：
- `cjc-version`、`name`、`version`、`output-type` 为必填字段
- 依赖配置支持本地路径和 Git 仓库两种形式
- 使用 `[profile.build]` 配置构建选项（增量编译、LTO 等）
- 使用 `[profile.test]` 配置测试选项（过滤、超时、并行度等）

### 2.3 源码结构

```
project/
├── cjpm.toml
├── src/
│   ├── main.cj          # 可执行项目入口
│   ├── utils/            # 子包目录（须含 .cj 文件才是有效包）
│   │   └── helper.cj
│   └── utils_test.cj    # 测试文件（与被测文件同目录）
└── target/               # 构建输出（不要手动修改）
```

- 每个有效包目录必须直接包含至少一个 `.cj` 文件
- 测试文件命名为 `xxx_test.cj`，与被测源文件放在同一目录

### 2.4 多模块 Workspace 项目

#### 创建 Workspace

```bash
mkdir my_project && cd my_project
cjpm init --workspace
```

#### 添加模块

```bash
cjpm init --type=static --path lib_core
cjpm init --type=static --path lib_utils
cjpm init --type=executable --path app
```

#### 注册模块到 Workspace

编辑根目录 `cjpm.toml`，在 `[workspace]` 段的 `members` 中添加所有模块路径：

```toml
[workspace]
  members = ["./lib_core", "./lib_utils", "./app"]
  build-members = []
  test-members = []
  compile-option = ""
  target-dir = ""
```

#### 配置模块间依赖

在 `app/cjpm.toml` 中声明对库模块的依赖：

```toml
[package]
  cjc-version = "0.55.3"
  name = "app"
  version = "1.0.0"
  output-type = "executable"

[dependencies]
  lib_core = { path = "../lib_core" }
  lib_utils = { path = "../lib_utils" }
```

#### Workspace 目录结构

```
my_project/
├── cjpm.toml                    # workspace 配置
├── lib_core/
│   ├── cjpm.toml                # 模块配置 (static)
│   └── src/
│       └── core.cj              # package lib_core
├── lib_utils/
│   ├── cjpm.toml                # 模块配置 (static)
│   └── src/
│       └── utils.cj             # package lib_utils
└── app/
    ├── cjpm.toml                # 模块配置 (executable)
    └── src/
        └── main.cj              # import lib_core.*, import lib_utils.*
```

#### 构建与运行

```bash
cjpm build                       # 构建整个 workspace
cjpm run --name app              # 运行指定可执行模块
cjpm test                        # 测试所有模块
cjpm test lib_core/src           # 只测试 lib_core
```

#### Workspace 注意事项

- `[workspace]` 和 `[package]` 不能同时存在于同一个 `cjpm.toml`
- workspace 级别的 `compile-option` 和 `link-option` 会应用到所有成员模块
- 使用 `build-members` 可限制只构建部分模块，`test-members` 同理
- 模块间依赖路径使用相对路径（相对于依赖方的 `cjpm.toml` 所在目录）
- 每个模块必须有独立的 `cjpm.toml` 和 `src/` 目录

### 2.5 依赖管理最佳实践

- **本地依赖**：模块间依赖使用 `{ path = "../module_name" }`，路径相对于当前模块
- **Git 依赖**：外部库使用 `{ git = "https://...", tag = "v1.0.0" }`
  - 优先使用 `tag` 固定版本，其次 `commitId`
  - 避免使用 `branch`（内容可能变化，构建不可复现）
- **版本锁定**：`cjpm.lock` 记录依赖的精确版本，应提交到版本控制
  - 更新依赖后执行 `cjpm update` 刷新 lock 文件
- **依赖检查**：
  - `cjpm check` — 检查依赖关系是否有效，报告循环依赖
  - `cjpm tree` — 可视化完整依赖树
  - `cjpm tree -V --depth 3` — 限制显示深度的详细依赖树
- **依赖替换**：使用 `[replace]` 临时替换间接依赖（仅入口模块的 replace 生效）
- **测试依赖**：仅测试需要的依赖放在 `[test-dependencies]`，不污染正式依赖
- **构建脚本依赖**：`build.cj` 需要的依赖放在 `[script-dependencies]`

### 2.6 包组织规范

#### 包声明与目录匹配

- 文件中的 `package` 声明必须与相对于 `src/` 的目录路径匹配
- `src/` 根目录的文件默认属于 `default` 包（可省略声明）
- 示例：`src/network/http/client.cj` → `package default.network.http`

#### 访问修饰符使用

| 修饰符 | 可见范围 | 使用场景 |
|--------|---------|---------|
| `private` | 当前文件 | 文件内辅助函数/类型 |
| `internal`（默认） | 包及子包 | 包内共享的实现细节 |
| `protected` | 当前模块 | 模块内跨包共享 |
| `public` | 全局 | 对外暴露的 API |

#### 重新导出模式

库模块应在根包中使用 `public import` 重新导出子包的公共 API：

```cangjie
// src/lib.cj — 库的入口文件
package my_lib

public import my_lib.http.HttpClient
public import my_lib.http.HttpServer
public import my_lib.utils.StringHelper
```

#### 包嵌套深度

- 建议不超过 3 层嵌套（如 `pkg.sub1.sub2`）
- 过深的嵌套表明需要拆分为独立模块

#### 空目录处理

- 无 `.cj` 文件的目录不构成有效包，其子目录也会被忽略（cjpm 会发出警告）
- 如需创建子包，确保每层目录都至少有一个 `.cj` 文件

---

## 3. 构建规则

### 3.1 日常构建

```bash
cjpm build                    # Release 构建
cjpm build -g                 # Debug 构建（输出到 target/debug/bin/）
cjpm build -V                 # 显示详细编译日志
cjpm build -j 4               # 4 线程并行编译
cjpm build -i                 # 增量编译
```

### 3.2 构建错误处理

- 编译错误时仔细阅读 cjc 的错误输出，仓颉的错误信息包含行号和详细描述
- 使用 `--diagnostic-format=json` 获取结构化错误信息
- 循环依赖错误用 `cjpm check` 检查包依赖关系

### 3.3 清理构建

遇到奇怪的编译问题时，先清理再重建：

```bash
cjpm clean && cjpm build
```

---

## 4. 运行规则

```bash
cjpm run                              # 构建并运行
cjpm run --run-args "arg1 arg2"       # 传递命令行参数
cjpm run --skip-build                 # 跳过构建直接运行
cjpm run -g                           # Debug 模式运行
```

- `cjpm run` 会自动先执行 `build`
- 可执行文件位于 `target/release/bin/` 或 `target/debug/bin/`

---

## 5. 测试规则

### 5.1 编写测试

- 测试文件命名：`xxx_test.cj`
- 使用 `@Test` 注解标记测试用例
- 使用 `@BeforeAll`/`@AfterAll`/`@BeforeEach`/`@AfterEach` 管理生命周期
- 使用 `@Assert` 系列宏进行断言

### 5.2 运行测试

```bash
cjpm test                                   # 运行所有测试
cjpm test src src/utils                     # 测试指定包
cjpm test --filter "MyTest*.*"              # 按名称过滤
cjpm test --include-tags "unit"             # 按标签过滤
cjpm test --timeout-each 10s                # 设置单测超时
cjpm test --parallel 4                      # 并行执行
cjpm test --dry-run                         # 仅列出测试，不运行
cjpm test --report-path report --report-format json  # 生成测试报告
```

### 5.3 Mock 测试

```bash
cjpm test --mock                            # 启用 mock 支持
```

需在 `cjpm.toml` 中配置 `[profile.test.build] mock = "on"`。

---

## 6. 代码质量规则

### 6.1 静态分析（cjlint）

```bash
cjpm build -l                               # 构建时同步运行 lint
```

cjlint 检查涵盖：命名规范、格式规范、声明规范、函数规范、类/接口规范、操作符规范、枚举规范、变量规范、表达式规范、错误处理规范、包规范、并发规范、安全规范。

### 6.2 代码格式化（cjfmt）

```bash
cjfmt -f file.cj                            # 格式化单文件
cjfmt -f src/                               # 格式化整个目录
```

格式化规则可在 `cangjie-format.toml` 中自定义。

### 6.3 完整检查流程

执行代码质量检查时，按此顺序：

1. `cjfmt -f src/` — 先格式化
2. `cjpm build -l` — 编译 + lint
3. `cjpm test` — 运行测试

---

## 7. 调试规则

### 7.1 Debug 构建

调试前必须使用 Debug 模式编译：

```bash
cjpm build -g                               # -g 生成调试信息
```

### 7.2 使用 cjdb 调试

```bash
cjdb ./target/debug/bin/main                 # 启动调试
```

cjdb 常用命令：
- `b <file>:<line>` — 设置断点
- `r` — 运行程序
- `n` — 单步执行（不进入函数）
- `s` — 单步执行（进入函数）
- `p <expr>` — 打印表达式值
- `bt` — 查看调用栈
- `c` — 继续执行
- `q` — 退出调试

---

## 8. 覆盖率与性能分析

### 8.1 代码覆盖率

```bash
cjpm build --coverage                       # 编译启用覆盖率
cjpm test                                   # 运行测试生成覆盖率数据
cjcov                                       # 生成覆盖率报告
cjpm clean --coverage                       # 清理覆盖率数据
```

### 8.2 性能分析

```bash
cjprof record -o perf.data ./target/release/bin/main   # 采集性能数据
cjprof report -i perf.data                              # 生成文本报告
cjprof report -i perf.data --flamegraph                 # 生成火焰图
```

---

## 9. Skill 引用规则

当需要查阅仓颉语言特性或 API 详情时，按以下优先级引用 Skills：

1. **具体特性 Skill**：如 `cangjie-struct`、`cangjie-class`、`cangjie-function` 等
2. **标准库 Skill**：`cangjie-std`（std 库快速参考）、`cangjie-stdx`（扩展库）
3. **工具链 Skill**：`cangjie-toolchains`（cjc/cjdb/cjcov/cjfmt/cjlint/cjprof）
4. **原始文档 Skill**：`cangjie-full-docs`（当以上 Skill 信息不够时，查阅完整文档）

---

## 10. 仓颉编码规范要点

- 文件使用 UTF-8 编码
- 缩进使用 4 个空格
- 类型名使用 PascalCase（如 `MyStruct`、`HttpClient`）
- 函数和变量名使用 camelCase（如 `getUserName`、`isValid`）
- 常量使用 SCREAMING_SNAKE_CASE（如 `MAX_SIZE`）
- 包名使用 snake_case（如 `my_package`）
- 每个公开 API 应有注释
- 优先使用 `let` 声明不可变变量，仅在需要时使用 `var`
- 结构体优先于类（值语义 vs 引用语义的选择）
- 使用 Option 类型处理可能为空的值，避免 null
- 错误处理使用 try-catch，定义有意义的异常类型
