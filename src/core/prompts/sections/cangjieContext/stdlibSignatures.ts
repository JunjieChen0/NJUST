// Agent-facing prompt templates — Chinese strings are intentionally kept in Chinese
// to match Cangjie compiler error output and provide context to the LLM.
// Do NOT i18n these strings; they target the AI agent, not the VS Code UI.
/** Pre-baked one-line API hints for std roots — avoids extra corpus hits for common imports. */
export const STDLIB_API_SIGNATURE_HINTS: Record<string, string> = {
	"std.collection":
		"ArrayList<T>, HashMap<K,V>, HashSet<T>, TreeMap<K,V>; HashMap 常要求 K <: Hashable & Equatable<K>，TreeMap 常要求 K <: Comparable<K>",
	"std.io": "InputStream, OutputStream, 读写与缓冲",
	"std.fs": "路径与文件系统遍历",
	"std.net": "TCP/UDP、HTTP、Socket",
	"std.sync": "Mutex, ReentrantMutex, Atomic*, synchronized",
	"std.time": "日期时间与 Duration",
	"std.math": "常用数学函数与常量",
	"std.regex": "Regex 构造与匹配",
	"std.console": "println, readLine",
	"std.convert": "ToString 与各类型解析",
	"std.unittest": "@Test, @TestCase, @Assert",
	"std.objectpool": "对象池借还与复用策略",
	"std.unicode": "Unicode 字符分类、规范化与编码处理",
	"std.log": "日志记录器、级别与格式化输出",
	"std.ffi": "foreign/@C 声明、跨语言类型映射",
	"std.format": "字符串与数值格式化输出",
	"std.random": "随机数与采样",
	"std.process": "子进程与参数",
	"std.env": "环境变量读写",
	"std.reflect": "反射与 Annotation",
	"std.sort": "排序算法",
	"std.binary": "字节与Endian",
	"std.ast": "宏与 AST 构造",
	"std.crypto": "摘要与对称算法入口",
	"std.database": "SQL 访问抽象",
	"std.core": "自动导入核心类型",
	"std.deriving": "派生宏（如 Equatable）",
	"std.overflow": "防溢出算术",
}

/**
 * Parameter-level API signatures for the top-20 highest-misuse stdlib APIs.
 * These are injected when the corresponding import is detected.
 * Modules covered here are also exempt from search gate warnings.
 */
export const STDLIB_CRITICAL_SIGNATURES: Record<string, string> = {
	"std.collection": [
		"class ArrayList<T> { init(); init(capacity: Int64); func add(T): Unit; func add(T, at!: Int64): Unit; func get(Int64): T; func set(Int64, T): Unit; prop size: Int64; func remove(at!: Int64): T; func iterator(): Iterator<T> }",
		"For ArrayList mutation, use add(element) or add(element, at: index); do not borrow append/insert from another language.",
		"class HashMap<K, V> where K <: Hashable & Equatable<K> { init(); func add(K, V): Option<V>; func get(K): ?V; func contains(K): Bool; func remove(K): Option<V>; operator [](K): V; operator [](K, value!: V): Unit; prop size: Int64 }",
		"For HashMap count-update examples, prefer get(...) plus add(...) after reading add/get evidence; use map[key] = value only when operator [](K, value!: V) evidence is explicitly cited.",
		"For HashMap.get, missing-key defaults, ??, Some, None, or getOrDefault, cite std.core Option evidence together with std.collection evidence before reporting.",
		"HashMap.add evidence reports must not evaluate let/var mutability semantics from examples, reference-type text, or the absence/presence of a mut word. Say only: var follows the samples; no let/var semantic conclusion is made here.",
		"中文注意：HashMap 样例使用 var 或 HashMap 是引用类型，都不能推出任何 let/var 必然结论。不能推出 `可以断言 add 必须 var`、`HashMap 变量必须用 var`、`let 不能调用 add`、`let 可以调用 add`、`let 可调 add`、`let 就足够`、`let 也可行`、`let 更推荐`、`不需要 var` 或 `add 是 mut 方法`；只能说 var follows samples unless a compiler diagnostic or API signature proves more.",
		"class HashSet<T> where T <: Hashable & Equatable<T> { init(); func put(T): Bool; func contains(T): Bool; func remove(T): Bool; prop size: Int64 }",
		"class TreeMap<K, V> where K <: Comparable<K> { init(); func put(K, V): Unit; func get(K): ?V; prop size: Int64 }",
	].join("\n"),
	"std.io": [
		"class InputStream { func read(Array<Byte>): Int64; func close(): Unit }",
		"class OutputStream { func write(Array<Byte>): Unit; func flush(): Unit; func close(): Unit }",
		"class BufferedReader { init(InputStream); func readLine(): ?String; func close(): Unit }",
		"class StringReader <: InputStream { init(String) }",
		"class StringWriter <: OutputStream { init(); func toString(): String }",
	].join("\n"),
	"std.fs": [
		"class File { static func readFrom(path: String): Array<Byte>; static func readFrom(path: Path): Array<Byte>; static func writeTo(path: String, bytes: Array<Byte>): Unit; static func writeTo(path: Path, bytes: Array<Byte>): Unit; init(path: String, mode: OpenMode); init(path: Path, mode: OpenMode); func close(): Unit }",
		"class Path { init(String); func toString(): String }",
		"Text file pattern: let bytes = File.readFrom(path); let text = String.fromUtf8(bytes).",
	].join("\n"),
	"std.sync": [
		"class Mutex<T> { init(T); func lock(): MutexGuard<T>; func tryLock(): ?MutexGuard<T> }",
		"class ReentrantMutex { init(); func lock(): Unit; func unlock(): Unit; func tryLock(): Bool }",
		"class AtomicInt64 { init(Int64); func load(): Int64; func store(Int64): Unit; func fetchAdd(Int64): Int64 }",
		"class AtomicBool { init(Bool); func load(): Bool; func store(Bool): Unit }",
		"func synchronized<T>(lock: ReentrantMutex, body: () -> T): T",
	].join("\n"),
	"std.regex": [
		"class Regex { init(pattern: String); init(pattern: String, flags: Array<RegexFlag>); func matches(input: String): Bool; func find(input: String, group!: Bool = false): Option<MatchData>; func findAll(input: String, group!: Bool = false): Array<MatchData>; func replaceAll(input: String, replacement: String): String; func split(input: String): Array<String> }",
		"struct MatchData { func matchString(): String; func matchPosition(): Position; func groupCount(): Int64 }",
		'Use raw string patterns like #"\\d+"# and match on Some(md)/None before calling md.matchString().',
		"Do not invent a default MatchData constructor for Regex.find defaults; return a default String or other domain value via match/?? instead.",
	].join("\n"),
	"std.console": "func println(String): Unit\nfunc print(String): Unit\nfunc readLine(): String",
	"std.convert": [
		"interface ToString { func toString(): String }",
		"func Int64.parse(String): ?Int64",
		"func Float64.parse(String): ?Float64",
		"func Bool.parse(String): ?Bool",
	].join("\n"),
	"std.unittest": [
		"@Test — 标记测试类",
		"@TestCase — 标记测试方法",
		"@Assert(condition) — 断言宏",
		"@Expect(condition) — 非致命断言",
		"@Timeout(ms: Int64) — 超时限制",
	].join("\n"),
	"std.format": [
		"func format(fmt: String, args: Array<ToString>): String",
		'字符串插值: "value = ${expr}" — expr 须实现 ToString',
	].join("\n"),
	"std.random": [
		"class Random { init(); init(seed: Int64); func nextInt64(): Int64; func nextInt64(bound: Int64): Int64; func nextFloat64(): Float64; func nextBool(): Bool }",
	].join("\n"),
	"std.math": [
		"func abs(Int64): Int64; func abs(Float64): Float64",
		"func min<T>(T, T): T where T <: Comparable<T>; func max<T>(T, T): T where T <: Comparable<T>",
		"func sqrt(Float64): Float64; func pow(Float64, Float64): Float64",
		"const PI: Float64; const E: Float64",
	].join("\n"),
	"std.time": [
		"struct DateTime { static func now(timeZone!: TimeZone = TimeZone.Local): DateTime; static func nowUTC(): DateTime; static func parse(value: String): DateTime; static func parse(value: String, format: String): DateTime; func format(pattern: String): String; prop year: Int64; prop month: Int64; prop dayOfMonth: Int64; prop hour: Int64; prop minute: Int64; prop second: Int64; prop nanosecond: Int64 }",
		"class TimeZone { static func load(name: String): TimeZone }",
		"struct MonoTime { static func now(): MonoTime }",
		"Use DateTime.nowUTC() for UTC time and TimeZone.load(name) before DateTime.now(timeZone!: zone).",
	].join("\n"),
	"std.process": [
		"func execute(command: String, args: Array<String>): Int64",
		"func executeWithOutput(command: String, args: Array<String>): (Int64, Array<Byte>, Array<Byte>)",
		"func launch(command: String, args: Array<String>): SubProcess",
		"class SubProcess { func wait(timeout!: ?Duration = None): Int64; func waitOutput(): (Int64, Array<Byte>, Array<Byte>) }",
		"Stdout/stderr are bytes; convert with String.fromUtf8(bytes). Avoid POSIX-only sample commands such as sleep on Windows.",
	].join("\n"),
	"std.core": [
		"enum Option<T> { Some(T) | None }; ?T is equivalent to Option<T>.",
		"Option<T>.getOrDefault(other: () -> T): T",
		"Option<T>.getOrThrow(): T; throws NoneValueException when the value is None.",
		"Option<T>.getOrThrow(exception: () -> Exception): T",
		"Option<T>.isNone(): Bool; Option<T>.isSome(): Bool",
		"Prefer match (opt) { case Some(v) => ...; case None => ... } when absence is expected.",
	].join("\n"),
	"std.env": ["func getEnv(String): ?String", "func setEnv(String, String): Unit", "func currentDir(): String"].join(
		"\n",
	),
	"std.log": [
		"class Logger { static func getLogger(name: String): Logger; func info(String): Unit; func warn(String): Unit; func error(String): Unit; func debug(String): Unit }",
		"enum LogLevel { case DEBUG | INFO | WARN | ERROR }",
	].join("\n"),
}
