## HashMap

To use the HashMap type, the collection package needs to be imported:

```
import std.collection.*
```

Keys of a `HashMap` must be hashable. Hashable types include numbers, strings, but not
tuples, `Array`, or `ArrayList`. There are no constraints on values of `HashMap`.

### Initialization

Ways to initialize an `HashMap` include:

```
var a = HashMap<String, Int64>()  // empty HashMap whose key type is String and value is Int64
var b = HashMap<String, Int64>([("a", 0), ("b", 1), ("c", 2)])  // creates map {"a": 0, "b": 1, "c": 2}
var c = HashMap<String, Int64>(b)  // use another Collection to initialize a HashMap
var d = HashMap<String, Int64>(10)  // creates a HashMap whose key type is String and value is Int64 and capacity is 10
var e = HashMap<Int64, Int64>(10, {x: Int64 => (x, x * x)})  // creates map {1: 1, ..., 10: 100}

```

### Access elements

When we want to access the element corresponding to the specified key, we can use the subscript syntax
to access it (the type of the subscript must be the key type). Using a non-existent key as an index will
trigger a runtime exception.

```
var map = HashMap<String, Int64>([("a", 0), ("b", 1), ("c", 2)])
let a = map["a"]  // a == 0
let b = map["b"]  // a == 1
let c = map["d"]  // Runtime exceptions
```

To access elements while allowing for the possibility of non-existent key, one suggested way is using 'get'
together with `getOrDefault` on the option, for example:

```
var m = HashMap(("a", 1), ("b", 2))
println(m.get("a").getOrDefault({ => 0}))  // 1
println(m.get("c").getOrDefault({ => 0}))  // 0
```

### Iteration

To iterate over a HashMap, use for-loop as follows:

```
var map = HashMap<String, Int64>([("a", 0), ("b", 1), ("c", 2)])
for ((k, v) in map) {
    println("The key is ${k}, the value is ${v}")
}
```

To get the size of a HashMap mp, use `mp.size`

### Basic operations

To determine whether a key `K` is included in the HashMap, we can use the contains function: `mp.contains(K)`, Returns true if the key exists, false otherwise.

If you need to add a single key-value pair to the end of your HashMap, use the `add` function with the signature

```
public func add(key: K, value: V): Option<V>
```

The documented signature is `public func add(...)`. Do not infer or report any let/var binding rule from examples, from the absence/presence of a `mut` word in this card, from manual snippets that use `let`, or from text that calls HashMap a reference type. For implementation examples, use `var map` as a conservative sample style. For evidence-only reports, say only: "var follows the samples; no let/var semantic conclusion is made here." Do not include a separate "whether add requires var" section unless the answer is exactly that sentence. Do not say that `HashMap.add` requires `var`, that `let` cannot call `add`, that `let` can call `add`, that `let` is enough, that `let` is recommended, that `var` is unnecessary, or that `add` is/is not a mut method unless a compiler diagnostic or API signature explicitly proves that exact claim.

中文注意：即使所有 HashMap 样例都使用 `var map`，或者文档说 HashMap 是引用类型，也只能说明“按样例写可保守使用 var”。不能推出“可以断言 add 必须 var”、“HashMap.add 必须 var”、“let 不能调用 add”、“let 可以调用 add”、“let 可调 add”、“let 就足够”、“let 也可行”、“let 更推荐”、“不需要 var”或“add 是 mut 方法”。只有编译器诊断或 API 签名明确支持时，才可以下这类结论。

If you want to add multiple key-value pairs at the same time, you can also use the `add` function with the signature

```
public func add(all!: Collection<(K, V)>): Unit
```

When the key does not exist, the `add` function inserts a new key-value pair. When the key exists, `add` overwrites the old value with the new value and returns the old value as `Option<V>`. It is fine to ignore the returned `Option<V>` when only updating counts; bind it only if the replaced value matters:

```
var map = HashMap<String, Int64>()
map.add("a", 0)  // map contains the element ("a", 0)
map.add("b", 1)  // map contains the elements ("a", 0), ("b", 1)
let map2 = HashMap<String, Int64>([("c", 2), ("d", 3)])
map.add(all: map2)  // map contains the elements ("a", 0), ("b", 1), ("c", 2), ("d", 3)
```

For count-update examples based on `get`, prefer `add` unless you have also cited the subscript assignment operator:

```
var map = HashMap<String, Int64>()
let previous = map.get("a").getOrDefault({ => 0 })
map.add("a", previous + 1)
```

Subscript assignment is also supported by `operator [](key: K, value!: V): Unit`; cite that signature before using `map[key] = value` in an evidence report.

Way to delete elements in a HashMap:

```
var map = HashMap<String, Int64>([("a", 0), ("b", 1), ("c", 2), ("d", 3)])
map.remove("d")  // map contains the elements ("a", 0), ("b", 1), ("c", 2)
```
