import { describe, it, expect, vi } from "vitest"
import { ServiceContainer } from "../ServiceContainer"

describe("ServiceContainer", () => {
	let container: ServiceContainer

	beforeEach(() => {
		container = new ServiceContainer()
	})

	describe("singleton registration", () => {
		it("creates instance once and returns same reference", () => {
			const factory = vi.fn(() => ({ value: 42 }))
			container.registerSingleton("myService", factory)
			const a = container.resolve("myService")
			const b = container.resolve("myService")
			expect(a).toBe(b)
			expect(a.value).toBe(42)
			expect(factory).toHaveBeenCalledTimes(1)
		})

		it("lazy-loads — factory not called until first resolve", () => {
			const factory = vi.fn(() => ({ x: 1 }))
			container.registerSingleton("lazy", factory)
			expect(factory).not.toHaveBeenCalled()
			container.resolve("lazy")
			expect(factory).toHaveBeenCalledTimes(1)
		})
	})

	describe("transient registration", () => {
		it("creates new instance on every resolve", () => {
			let counter = 0
			const factory = () => ({ id: ++counter })
			container.registerTransient("transient", factory)
			const a = container.resolve("transient")
			const b = container.resolve("transient")
			expect(a).not.toBe(b)
			expect(a.id).toBe(1)
			expect(b.id).toBe(2)
		})
	})

	describe("error handling", () => {
		it("throws for unregistered token", () => {
			expect(() => container.resolve("unknown")).toThrow(
				"ServiceContainer: unregistered token unknown",
			)
		})

		it("tryResolve returns undefined for unregistered token", () => {
			expect(container.tryResolve("unknown")).toBeUndefined()
		})

		it("tryResolve returns the service for registered token", () => {
			container.registerSingleton("present", () => "hello")
			expect(container.tryResolve("present")).toBe("hello")
		})
	})

	describe("multiple registrations", () => {
		it("supports registering multiple services", () => {
			container.registerSingleton("db", () => ({ connect: () => "ok" }))
			container.registerTransient("logger", () => ({ log: () => {} }))
			expect(container.resolve("db").connect()).toBe("ok")
			expect(container.resolve("logger")).toBeDefined()
		})

		it("overwrites previous registration for same token", () => {
			container.registerSingleton("svc", () => "first")
			container.registerSingleton("svc", () => "second")
			expect(container.resolve("svc")).toBe("second")
		})
	})

	describe("clear", () => {
		it("removes all registrations", () => {
			container.registerSingleton("svc", () => "value")
			container.clear()
			expect(() => container.resolve("svc")).toThrow()
		})
	})

	describe("token types", () => {
		it("supports Symbol tokens", () => {
			const TOKEN = Symbol("myToken")
			container.registerSingleton(TOKEN, () => "symbol-value")
			expect(container.resolve(TOKEN)).toBe("symbol-value")
		})

		it("supports class-based tokens", () => {
			class Logger { log() { return "log" } }
			container.registerSingleton(Logger, () => new Logger())
			const instance = container.resolve(Logger)
			expect(instance).toBeInstanceOf(Logger)
			expect(instance.log()).toBe("log")
		})
	})
})
