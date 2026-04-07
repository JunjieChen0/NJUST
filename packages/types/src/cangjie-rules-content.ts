// Auto-generated from .njust_ai/rules-cangjie/ markdown files.
// Inlined to prevent ENOENT errors when these files do not exist in user projects.

export const CANGJIE_SYNTAX_REFERENCE =
`# 仓颉语法速查手册

本文件在 Cangjie Dev 模式下自动注入 AI 上下文，提供完整的仓颉语言语法参考。

## 1. 基础类型

\`\`\`
整数:   Int8  Int16  Int32  Int64  IntNative  UInt8  UInt16  UInt32  UInt64  UIntNative
浮点:   Float16  Float32  Float64
布尔:   Bool (true / false)
字符:   Rune ('A', '\\n', '\\u{1F600}')
字符串: String ("hello", "interpolation: \${expr}")
单元:   Unit (无返回值)
底类型: Nothing (永不返回, 如 throw)
\`\`\`

## 2. 复合类型

\`\`\`
元组:     (Int64, String, Bool)          // 访问: t[0], t[1]
数组:     Array<Int64>([1, 2, 3])        // 字面量: [1, 2, 3]
Option:   ?Int64                         // Some(42) 或 None
函数类型: (Int64, String) -> Bool
VArray:   VArray<Int64, $3>              // 固定长度值类型数组(FFI用)
\`\`\`

## 3. 变量声明

\`\`\`cangjie
let x: Int64 = 42          // 不可变绑定(优先使用)
var y: Int64 = 0            // 可变绑定
const Z: Int64 = 100        // 编译期常量
let z = 42                  // 类型推断
\`\`\`

## 4. 函数声明

\`\`\`cangjie
// 基本函数
func add(a: Int64, b: Int64): Int64 { return a + b }

// 命名参数(调用时必须带名)
func connect(host!: String, port!: Int64 = 8080): Unit { ... }
// 调用: connect(host: "localhost", port: 3000)

// 泛型函数 + where 约束
func max<T>(a: T, b: T): T where T <: Comparable<T> { ... }

// Lambda 表达式
let f = { a: Int64, b: Int64 => a + b }
let g: (Int64) -> Int64 = { x => x * 2 }

// main 函数(程序入口, 必须返回 Int64)
main(): Int64 {
    println("Hello")
    return 0
}
\`\`\`

## 5. 类型声明

### struct (值类型, 优先使用)

\`\`\`cangjie
struct Point {
    let x: Float64
    let y: Float64

    public init(x: Float64, y: Float64) {
        this.x = x; this.y = y
    }

    public func distanceTo(other: Point): Float64 { ... }
    public mut func reset(): Unit { this = Point(0.0, 0.0) }
}
\`\`\`

注意: struct 不能继承, 不能自引用(递归), mut 方法只能在 var 绑定上调用

### class (引用类型)

\`\`\`cangjie
abstract class Shape {
    private let color: String
    public init(color: String) { this.color = color }
    public open func area(): Float64     // 可被子类 override
    public func describe(): String { ... }
}

class Circle <: Shape {
    let radius: Float64
    public init(radius: Float64) { super("red"); this.radius = radius }
    public override func area(): Float64 { 3.14159 * radius * radius }
}
\`\`\`

修饰符: public / protected / private / internal / open / abstract / static / sealed

### interface

\`\`\`cangjie
interface Printable {
    func display(): String
    func debugInfo(): String { "default impl" }   // 可有默认实现
}

class Foo <: Printable {
    public func display(): String { "Foo" }
    // debugInfo 使用默认实现
}
\`\`\`

### enum

\`\`\`cangjie
enum Color {
    Red | Green | Blue                              // 无参构造器
    Custom(r: Int64, g: Int64, b: Int64)            // 有参构造器

    public func isCustom(): Bool {
        match (this) {
            case Custom(_, _, _) => true
            case _ => false
        }
    }
}
let c = Color.Red
let c2 = Color.Custom(255, 128, 0)
\`\`\`

### type alias

\`\`\`cangjie
type StringList = ArrayList<String>
type Handler = (String) -> Unit
\`\`\`

## 6. 泛型

\`\`\`cangjie
class Container<T> {
    var items: ArrayList<T> = ArrayList<T>()
    public func add(item: T): Unit { items.append(item) }
}

// 泛型约束
class SortedList<T> where T <: Comparable<T> { ... }

// 多约束
func process<T>(x: T): Unit where T <: Printable & Hashable { ... }
\`\`\`

## 7. 扩展(extend)

\`\`\`cangjie
// 直接扩展
extend String {
    public func reversed(): String { ... }
}

// 接口扩展
extend Int64 <: Printable {
    public func display(): String { "\${this}" }
}
\`\`\`

## 8. 控制流

\`\`\`cangjie
// if-else (是表达式, 有返回值)
let max = if (a > b) { a } else { b }

// match (模式匹配, 替代 switch)
match (value) {
    case 0 => println("zero")
    case n where n > 0 => println("positive: \${n}")
    case _ => println("negative")
}

// for-in
for (i in 0..10) { ... }          // 0 到 9 (左闭右开)
for (i in 0..=10) { ... }         // 0 到 10 (左闭右闭)
for (i in 0..10 : 2) { ... }      // 步长 2
for ((k, v) in map) { ... }       // 解构迭代

// while
while (cond) { ... }
do { ... } while (cond)           // 至少执行一次

// break / continue 可带标签
@label for (...) { break @label }
\`\`\`

## 9. 错误处理

\`\`\`cangjie
// try-catch-finally
try {
    riskyOperation()
} catch (e: IOException) {
    println("IO error: \${e.message}")
} catch (e: Exception) {
    println("Error: \${e.message}")
} finally {
    cleanup()
}

// try-with-resources (自动关闭 Resource)
try (file = openFile("data.txt")) {
    file.read()
}   // 自动调用 file.close()

// 自定义异常
class AppError <: Exception {
    public init(msg: String) { super(msg) }
}
throw AppError("something went wrong")

// Option 处理
let v: ?Int64 = findValue()
let result = v ?? 0                // 合并运算符
let name = user?.profile?.name     // 可选链
let x = opt.getOrThrow()           // None 时抛 NoneValueException
\`\`\`

## 10. 并发

\`\`\`cangjie
import std.sync.*

// 创建协程
let future = spawn { heavyWork() }
let result = future.get()         // 阻塞等待结果

// 互斥锁
let mutex = Mutex()
mutex.lock()
try { sharedData++ } finally { mutex.unlock() }

// synchronized 块
let obj = Object()
synchronized (obj) { sharedData++ }
\`\`\`

## 11. 包与导入

\`\`\`cangjie
package my_app.utils               // 包声明(每个文件顶部)

import std.collection.*            // 导入包中所有公开成员
import std.io.{InputStream, OutputStream}  // 选择性导入

// 访问修饰符
// public    - 所有包可见
// internal  - 同模块内可见(默认)
// protected - 子类可见
// private   - 当前作用域可见
\`\`\`

## 12. 属性(prop)

\`\`\`cangjie
class Temperature {
    private var _celsius: Float64

    public prop celsius: Float64 {
        get() { _celsius }
        set(value) { _celsius = value }
    }

    public prop fahrenheit: Float64 {
        get() { _celsius * 9.0 / 5.0 + 32.0 }
    }
}
\`\`\`

## 13. 操作符优先级(从高到低)

\`\`\`
0  @         宏调用
1  . [] ()   成员访问/索引/调用
2  ++ -- ?   自增自减/可选链
3  ! -       逻辑非/一元负号
4  **        幂运算(右结合)
5  * / %     乘除取模
6  + -       加减
7  << >>     位移
8  .. ..=    区间
9  < <= > >= is as   比较/类型检查
10 == !=     判等
11 &         按位与
12 ^         按位异或
13 |         按位或
14 &&        逻辑与
15 ||        逻辑或
16 ??        合并运算符(右结合)
17 |> ~>     管道/组合
18 = += -= *= /= 等  赋值
\`\`\`

## 14. 关键字速查

\`\`\`
声明:  func class struct enum interface extend type let var const prop
修饰:  public private protected internal open abstract static sealed mut override redef
控制:  if else match case for in while do break continue return
异常:  try catch finally throw
类型:  Bool Int8-64 UInt8-64 Float16-64 Rune String Unit Nothing
其他:  import package main init this super is as where true false spawn synchronized unsafe foreign macro quote
\`\`\`
`

export const CANGJIE_CODING_RULES =
`# 仓颉语言编码规则

## 1. 项目文件模板

### 1.1 可执行项目 main.cj

\`\`\`cangjie
package my_app

import std.console.*

main(): Int64 {
    println("Hello, Cangjie!")
    return 0
}
\`\`\`

### 1.2 库项目入口

\`\`\`cangjie
package my_lib

public func greet(name: String): String {
    return "Hello, \${name}!"
}
\`\`\`

### 1.3 测试文件模板 (xxx_test.cj)

\`\`\`cangjie
package my_app

import std.unittest.*
import std.unittest.testmacro.*

@Test
class MyTest {
    @TestCase
    func testBasic() {
        @Assert(1 + 1 == 2)
    }

    @TestCase
    func testString() {
        let s = "hello"
        @Assert(s.size == 5)
    }
}
\`\`\`

---

## 2. 常用语言模式

### 2.1 错误处理

\`\`\`cangjie
try {
    let result = riskyOperation()
    println(result)
} catch (e: FileNotFoundException) {
    println("文件未找到: \${e.message}")
} catch (e: Exception) {
    println("未知错误: \${e.message}")
} finally {
    cleanup()
}
\`\`\`

### 2.2 Option 类型

\`\`\`cangjie
func findUser(id: Int64): ?User {
    if (id > 0) {
        return Some(User(id))
    }
    return None
}

let user = findUser(1) ?? defaultUser
\`\`\`

### 2.3 模式匹配

\`\`\`cangjie
match (value) {
    case 0 => println("zero")
    case n where n > 0 => println("positive: \${n}")
    case _ => println("negative")
}
\`\`\`

### 2.4 并发

\`\`\`cangjie
import std.sync.*
import std.time.*

let future = spawn {
    // 异步任务
    heavyComputation()
}
let result = future.get()
\`\`\`

---

## 3. 常见编译错误处理

| 错误类型 | 常见原因 | 解决方案 |
|----------|----------|----------|
| 未找到符号 | 缺少 import 或包依赖 | 检查 import 语句和 cjpm.toml 依赖 |
| 类型不匹配 | 赋值或传参类型错误 | 检查类型声明和转换 |
| 循环依赖 | 包之间互相引用 | 使用 \`cjpm check\` 查看依赖关系，重构 |
| let 变量赋值 | 尝试修改不可变变量 | 改用 \`var\` 声明 |
| mut 函数限制 | let 变量调用 mut 函数 | 改用 \`var\` 声明变量 |
| 递归结构体 | struct 直接或间接自引用 | 改用 class（引用类型）或 Option 包装 |

## 4. 常见反例与推荐写法（对照）

### 4.1 mut 方法与 let 绑定

❌ 在 \`let\` 绑定的 struct 上调用 \`mut\` 方法（编译器会拒绝）。

\`\`\`cangjie
struct Counter { var n: Int64 = 0; public mut func inc(): Unit { n += 1 } }
func demo(): Unit {
    let c = Counter()
    c.inc()
}
\`\`\`

✅ 对需要就地修改的对象使用 \`var\`，或提供非 \`mut\` 的 API。

\`\`\`cangjie
var c = Counter()
c.inc()
\`\`\`

### 4.2 struct 自引用

❌ struct 字段直接或间接指向自身类型（值类型不能自引用）。

\`\`\`cangjie
struct Node { let next: Node }  // 错误
\`\`\`

✅ 使用 \`class\`、\`?\`（Option）或间接包装打破循环。

\`\`\`cangjie
class Node { let next: ?Node = None }
\`\`\`

### 4.3 match 穷尽性

❌ 遗漏枚举分支导致非穷尽 match。

\`\`\`cangjie
enum Color { case Red | Blue | Green }
match (c) { case Red => 0 case Blue => 1 }  // 缺 Green
\`\`\`

✅ 补全所有 case，或增加 \`case _ =>\` 作为兜底。

### 4.4 Option 粗暴解包

❌ 对可能为 \`None\` 的值直接 \`unwrap\` 或未处理就使用。

✅ 使用 \`??\` 默认值、\`if-let\` / \`match\` 安全解包。

`

export const CANGJIE_WORKFLOW_RULES =
`# 仓颉语言开发工作流规则

## 1. 环境与工具链

### 1.1 前置条件检测

在执行任何仓颉构建操作前，先确认工具链可用：

\`\`\`bash
cjpm --version
cjc --version
\`\`\`

如果命令不存在，提示用户安装仓颉工具链并配置 \`PATH\` 环境变量。

### 1.2 工具链组件

| 工具 | 用途 | 关键命令 |
|------|------|----------|
| \`cjpm\` | 项目管理（构建/运行/测试/依赖） | \`cjpm build\`, \`cjpm run\`, \`cjpm test\` |
| \`cjc\` | 编译器 | \`cjc file.cj -o output\` |
| \`cjlint\` | 静态分析 | \`cjpm build -l\` 或直接 \`cjlint\` |
| \`cjfmt\` | 代码格式化 | \`cjfmt -f file.cj\` |
| \`cjdb\` | 调试器 | \`cjdb ./target/debug/bin/main\` |
| \`cjcov\` | 覆盖率分析 | \`cjpm build --coverage && cjcov\` |
| \`cjprof\` | 性能分析 | \`cjprof record -p <pid>\` |

---

## 2. 项目管理规则

### 2.1 项目初始化

- 始终通过 \`cjpm init\` 创建项目，不要手动创建 \`cjpm.toml\`
- **禁止** \`cjpm init <裸名称>\`（如 \`cjpm init helloworld\`）：当前 CLI 会报 unknown command，必须使用 \`--name\` / \`--path\` / \`--type\` 等参数
- 指定项目类型：\`--type=executable\`（可执行）、\`--type=static\`（静态库）、\`--type=dynamic\`（动态库）
- 项目名使用小写字母和下划线

\`\`\`bash
cjpm init --name my_app --type=executable
\`\`\`

### 2.2 cjpm.toml 配置

编辑 \`cjpm.toml\` 时遵守以下规则：
- \`cjc-version\`、\`name\`、\`version\`、\`output-type\` 为必填字段
- 依赖配置支持本地路径和 Git 仓库两种形式
- 使用 \`[profile.build]\` 配置构建选项（增量编译、LTO 等）
- 使用 \`[profile.test]\` 配置测试选项（过滤、超时、并行度等）

### 2.3 源码结构

\`\`\`
project/
├── cjpm.toml
├── src/
│   ├── main.cj          # 可执行项目入口
│   ├── utils/            # 子包目录（须含 .cj 文件才是有效包）
│   │   └── helper.cj
│   └── utils_test.cj    # 测试文件（与被测文件同目录）
└── target/               # 构建输出（不要手动修改）
\`\`\`

- 每个有效包目录必须直接包含至少一个 \`.cj\` 文件
- 测试文件命名为 \`xxx_test.cj\`，与被测源文件放在同一目录

### 2.4 多模块 Workspace 项目

#### 创建 Workspace

\`\`\`bash
mkdir my_project && cd my_project
cjpm init --workspace
\`\`\`

#### 添加模块

\`\`\`bash
cjpm init --type=static --path lib_core
cjpm init --type=static --path lib_utils
cjpm init --type=executable --path app
\`\`\`

#### 注册模块到 Workspace

编辑根目录 \`cjpm.toml\`，在 \`[workspace]\` 段的 \`members\` 中添加所有模块路径：

\`\`\`toml
[workspace]
  members = ["./lib_core", "./lib_utils", "./app"]
  build-members = []
  test-members = []
  compile-option = ""
  target-dir = ""
\`\`\`

#### 配置模块间依赖

在 \`app/cjpm.toml\` 中声明对库模块的依赖：

\`\`\`toml
[package]
  cjc-version = "0.55.3"
  name = "app"
  version = "1.0.0"
  output-type = "executable"

[dependencies]
  lib_core = { path = "../lib_core" }
  lib_utils = { path = "../lib_utils" }
\`\`\`

#### Workspace 目录结构

\`\`\`
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
\`\`\`

#### 构建与运行

\`\`\`bash
cjpm build                       # 构建整个 workspace
cjpm run --name app              # 运行指定可执行模块
cjpm test                        # 测试所有模块
cjpm test lib_core/src           # 只测试 lib_core
\`\`\`

#### Workspace 注意事项

- \`[workspace]\` 和 \`[package]\` 不能同时存在于同一个 \`cjpm.toml\`
- workspace 级别的 \`compile-option\` 和 \`link-option\` 会应用到所有成员模块
- 使用 \`build-members\` 可限制只构建部分模块，\`test-members\` 同理
- 模块间依赖路径使用相对路径（相对于依赖方的 \`cjpm.toml\` 所在目录）
- 每个模块必须有独立的 \`cjpm.toml\` 和 \`src/\` 目录

### 2.5 依赖管理最佳实践

- **本地依赖**：模块间依赖使用 \`{ path = "../module_name" }\`，路径相对于当前模块
- **Git 依赖**：外部库使用 \`{ git = "https://...", tag = "v1.0.0" }\`
  - 优先使用 \`tag\` 固定版本，其次 \`commitId\`
  - 避免使用 \`branch\`（内容可能变化，构建不可复现）
- **版本锁定**：\`cjpm.lock\` 记录依赖的精确版本，应提交到版本控制
  - 更新依赖后执行 \`cjpm update\` 刷新 lock 文件
- **依赖检查**：
  - \`cjpm check\` — 检查依赖关系是否有效，报告循环依赖
  - \`cjpm tree\` — 可视化完整依赖树
  - \`cjpm tree -V --depth 3\` — 限制显示深度的详细依赖树
- **依赖替换**：使用 \`[replace]\` 临时替换间接依赖（仅入口模块的 replace 生效）
- **测试依赖**：仅测试需要的依赖放在 \`[test-dependencies]\`，不污染正式依赖
- **构建脚本依赖**：\`build.cj\` 需要的依赖放在 \`[script-dependencies]\`

### 2.6 包组织规范

#### 包声明与目录匹配

- 文件中的 \`package\` 声明必须与相对于 \`src/\` 的目录路径匹配
- \`src/\` 根目录的文件默认属于 \`default\` 包（可省略声明）
- 示例：\`src/network/http/client.cj\` → \`package default.network.http\`

#### 访问修饰符使用

| 修饰符 | 可见范围 | 使用场景 |
|--------|---------|---------|
| \`private\` | 当前文件 | 文件内辅助函数/类型 |
| \`internal\`（默认） | 包及子包 | 包内共享的实现细节 |
| \`protected\` | 当前模块 | 模块内跨包共享 |
| \`public\` | 全局 | 对外暴露的 API |

#### 重新导出模式

库模块应在根包中使用 \`public import\` 重新导出子包的公共 API：

\`\`\`cangjie
// src/lib.cj — 库的入口文件
package my_lib

public import my_lib.http.HttpClient
public import my_lib.http.HttpServer
public import my_lib.utils.StringHelper
\`\`\`

#### 包嵌套深度

- 建议不超过 3 层嵌套（如 \`pkg.sub1.sub2\`）
- 过深的嵌套表明需要拆分为独立模块

#### 空目录处理

- 无 \`.cj\` 文件的目录不构成有效包，其子目录也会被忽略（cjpm 会发出警告）
- 如需创建子包，确保每层目录都至少有一个 \`.cj\` 文件

---

## 3. 构建规则

### 3.1 日常构建

\`\`\`bash
cjpm build                    # Release 构建
cjpm build -g                 # Debug 构建（输出到 target/debug/bin/）
cjpm build -V                 # 显示详细编译日志
cjpm build -j 4               # 4 线程并行编译
cjpm build -i                 # 增量编译
\`\`\`

### 3.2 构建错误处理

- 编译错误时仔细阅读 cjc 的错误输出，仓颉的错误信息包含行号和详细描述
- 使用 \`--diagnostic-format=json\` 获取结构化错误信息
- 循环依赖错误用 \`cjpm check\` 检查包依赖关系

### 3.3 清理构建

遇到奇怪的编译问题时，先清理再重建：

\`\`\`bash
cjpm clean && cjpm build
\`\`\`

---

## 4. 运行规则

\`\`\`bash
cjpm run                              # 构建并运行
cjpm run --run-args "arg1 arg2"       # 传递命令行参数
cjpm run --skip-build                 # 跳过构建直接运行
cjpm run -g                           # Debug 模式运行
\`\`\`

- \`cjpm run\` 会自动先执行 \`build\`
- 可执行文件位于 \`target/release/bin/\` 或 \`target/debug/bin/\`

---

## 5. 测试规则

### 5.1 编写测试

- 测试文件命名：\`xxx_test.cj\`
- 使用 \`@Test\` 注解标记测试用例
- 使用 \`@BeforeAll\`/\`@AfterAll\`/\`@BeforeEach\`/\`@AfterEach\` 管理生命周期
- 使用 \`@Assert\` 系列宏进行断言

### 5.2 运行测试

\`\`\`bash
cjpm test                                   # 运行所有测试
cjpm test src src/utils                     # 测试指定包
cjpm test --filter "MyTest*.*"              # 按名称过滤
cjpm test --include-tags "unit"             # 按标签过滤
cjpm test --timeout-each 10s                # 设置单测超时
cjpm test --parallel 4                      # 并行执行
cjpm test --dry-run                         # 仅列出测试，不运行
cjpm test --report-path report --report-format json  # 生成测试报告
\`\`\`

### 5.3 Mock 测试

\`\`\`bash
cjpm test --mock                            # 启用 mock 支持
\`\`\`

需在 \`cjpm.toml\` 中配置 \`[profile.test.build] mock = "on"\`。

---

## 6. 代码质量规则

### 6.1 静态分析（cjlint）

\`\`\`bash
cjpm build -l                               # 构建时同步运行 lint
\`\`\`

cjlint 检查涵盖：命名规范、格式规范、声明规范、函数规范、类/接口规范、操作符规范、枚举规范、变量规范、表达式规范、错误处理规范、包规范、并发规范、安全规范。

### 6.2 代码格式化（cjfmt）

\`\`\`bash
cjfmt -f file.cj                            # 格式化单文件（推荐；多数版本仅支持单文件）
# 若 SDK 支持目录再使用目录；否则对每个 .cj 执行 cjfmt -f 或使用编辑器格式化
\`\`\`

格式化规则可在 \`cangjie-format.toml\` 中自定义。

### 6.3 完整检查流程

执行代码质量检查时，按此顺序：

1. **格式化**：对每个改动的 \`.cj\` 执行 \`cjfmt -f <文件>\`（勿写 \`cjfmt <文件>\` 省略 \`-f\`）；或全选使用编辑器「Format Document」
2. \`cjpm build -l\` — 编译 + lint（需 \`cjpm\` 在 PATH 或配置扩展的 cjpm 路径）
3. \`cjpm test\` — 运行测试

---

## 7. 调试规则

### 7.1 Debug 构建

调试前必须使用 Debug 模式编译：

\`\`\`bash
cjpm build -g                               # -g 生成调试信息
\`\`\`

### 7.2 使用 cjdb 调试

\`\`\`bash
cjdb ./target/debug/bin/main                 # 启动调试
\`\`\`

cjdb 常用命令：
- \`b <file>:<line>\` — 设置断点
- \`r\` — 运行程序
- \`n\` — 单步执行（不进入函数）
- \`s\` — 单步执行（进入函数）
- \`p <expr>\` — 打印表达式值
- \`bt\` — 查看调用栈
- \`c\` — 继续执行
- \`q\` — 退出调试

---

## 8. 覆盖率与性能分析

### 8.1 代码覆盖率

\`\`\`bash
cjpm build --coverage                       # 编译启用覆盖率
cjpm test                                   # 运行测试生成覆盖率数据
cjcov                                       # 生成覆盖率报告
cjpm clean --coverage                       # 清理覆盖率数据
\`\`\`

### 8.2 性能分析

\`\`\`bash
cjprof record -o perf.data ./target/release/bin/main   # 采集性能数据
cjprof report -i perf.data                              # 生成文本报告
cjprof report -i perf.data --flamegraph                 # 生成火焰图
\`\`\`

---

## 9. Skill 引用规则

当需要查阅仓颉语言特性或 API 详情时，按以下优先级引用 Skills：

1. **具体特性 Skill**：如 \`cangjie-struct\`、\`cangjie-class\`、\`cangjie-function\` 等
2. **标准库 Skill**：\`cangjie-std\`（std 库快速参考）、\`cangjie-stdx\`（扩展库）
3. **工具链 Skill**：\`cangjie-toolchains\`（cjc/cjdb/cjcov/cjfmt/cjlint/cjprof）
4. **原始文档 Skill**：\`cangjie-full-docs\`（当以上 Skill 信息不够时，查阅完整文档）

---

## 10. 仓颉编码规范要点

- 文件使用 UTF-8 编码
- 缩进使用 4 个空格
- 类型名使用 PascalCase（如 \`MyStruct\`、\`HttpClient\`）
- 函数和变量名使用 camelCase（如 \`getUserName\`、\`isValid\`）
- 常量使用 SCREAMING_SNAKE_CASE（如 \`MAX_SIZE\`）
- 包名使用 snake_case（如 \`my_package\`）
- 每个公开 API 应有注释
- 优先使用 \`let\` 声明不可变变量，仅在需要时使用 \`var\`
- 结构体优先于类（值语义 vs 引用语义的选择）
- 使用 Option 类型处理可能为空的值，避免 null
- 错误处理使用 try-catch，定义有意义的异常类型
`

