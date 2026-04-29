import { describe, expect, it } from "vitest"

import {
	CJC_DIAGNOSTIC_CODE_MAP,
	getMatchingCjcPatternsByCategory,
	matchCjcErrorPattern,
} from "../../cangjie-lsp/CangjieErrorAnalyzer"

describe("matchCjcErrorPattern", () => {
	it("returns highest priority match for simple type mismatch", () => {
		const result = matchCjcErrorPattern("incompatible types: String cannot be assigned to Int64")
		expect(result).toBeDefined()
		expect(result!.category).toBe("类型不匹配")
	})

	it("returns null for plain English text without error patterns", () => {
		const result = matchCjcErrorPattern("everything compiled successfully")
		expect(result).toBeNull()
	})

	it("matches FFI errors with higher priority than general not-found", () => {
		const result = matchCjcErrorPattern("foreign function 'malloc' not found in linked library")
		expect(result).toBeDefined()
		expect(result!.category).toBe("FFI 链接/声明")
	})
})

describe("getMatchingCjcPatternsByCategory deduplication", () => {
	it("returns only '接口未实现（精确）', suppressing general '接口未实现' and 'Resource 接口未实现'", () => {
		const text = "class MyFile does not implement interface Closeable. close method not implemented."
		const results = getMatchingCjcPatternsByCategory(text)
		const categories = results.map((r) => r.category)

		// The exact pattern should subsume the general ones
		expect(categories).toContain("接口未实现（精确）")
		expect(categories).not.toContain("接口未实现")
		expect(categories).not.toContain("Resource 接口未实现")
	})

	it("returns only '访问控制（精确）', suppressing '访问权限错误'", () => {
		const text = "cannot access private member 'x' from outside class"
		const results = getMatchingCjcPatternsByCategory(text)
		const categories = results.map((r) => r.category)

		expect(categories).toContain("访问控制（精确）")
		expect(categories).not.toContain("访问权限错误")
	})

	it("returns only '并发共享可变', suppressing 'spawn 捕获可变引用'", () => {
		const text = "data race detected in shared mutable state across threads"
		const results = getMatchingCjcPatternsByCategory(text)
		const categories = results.map((r) => r.category)

		expect(categories).toContain("并发共享可变")
		expect(categories).not.toContain("spawn 捕获可变引用")
	})

	it("returns only 'FFI 链接/声明', suppressing '未找到符号'", () => {
		const text = "ffi symbol 'SDL_Init' not found during linkage"
		const results = getMatchingCjcPatternsByCategory(text)
		const categories = results.map((r) => r.category)

		expect(categories).toContain("FFI 链接/声明")
		expect(categories).not.toContain("未找到符号")
	})

	it("returns generic '未找到符号' when no FFI pattern also matches", () => {
		const text = "undeclared identifier: ArrayList"
		const results = getMatchingCjcPatternsByCategory(text)
		const categories = results.map((r) => r.category)

		expect(categories).toContain("未找到符号")
		// No FFI pattern should match this
		expect(categories).not.toContain("FFI 链接/声明")
	})

	it("returns 'spawn 捕获可变引用' when not suppressed by '并发共享可变'", () => {
		const text = "capture mutable reference in spawn block is forbidden"
		const results = getMatchingCjcPatternsByCategory(text)
		const categories = results.map((r) => r.category)

		// "并发共享可变" pattern requires "shared.*mutable" or "data race" etc.
		// which this text doesn't contain. So "spawn 捕获可变引用" should survive.
		expect(categories).toContain("spawn 捕获可变引用")
	})

	it("returns multiple unrelated categories when no subsumes relationships apply", () => {
		const text = "type mismatch: expected Int64, found String. also: undeclared identifier foo"
		const results = getMatchingCjcPatternsByCategory(text)
		const categories = results.map((r) => r.category)

		expect(categories).toContain("类型不匹配")
		expect(categories).toContain("未找到符号")
	})
})

describe("CJC_DIAGNOSTIC_CODE_MAP", () => {
	it("maps E0308 to 类型不匹配", () => {
		const p = CJC_DIAGNOSTIC_CODE_MAP.get("E0308")
		expect(p).toBeDefined()
		expect(p!.category).toBe("类型不匹配")
	})

	it("maps E0384 to 不可变变量赋值", () => {
		const p = CJC_DIAGNOSTIC_CODE_MAP.get("E0384")
		expect(p).toBeDefined()
		expect(p!.category).toBe("不可变变量赋值")
	})

	it("maps E0004 to match 不穷尽", () => {
		const p = CJC_DIAGNOSTIC_CODE_MAP.get("E0004")
		expect(p).toBeDefined()
		expect(p!.category).toBe("match 不穷尽")
	})
})
