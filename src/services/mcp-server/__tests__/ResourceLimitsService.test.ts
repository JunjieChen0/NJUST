import { describe, it, expect } from "vitest"

import {
	ResourceLimitsService,
	DEFAULT_RESOURCE_LIMITS,
	createPerRequestResourceLimits,
} from "../ResourceLimitsService"

describe("ResourceLimitsService", () => {
	it("starts with zero usage", () => {
		const svc = new ResourceLimitsService()
		const usage = svc.getUsage()
		expect(usage.readBytes).toBe(0)
		expect(usage.writeBytes).toBe(0)
		expect(usage.openFileHandles).toBe(0)
	})

	it("acquires read bytes up to the limit", () => {
		const svc = new ResourceLimitsService({ maxReadBytes: 100 })
		expect(svc.acquireReadBytes(60)).toBe(60)
		expect(svc.acquireReadBytes(50)).toBe(40)
		expect(svc.acquireReadBytes(10)).toBe(0)
	})

	it("acquires write bytes up to the limit", () => {
		const svc = new ResourceLimitsService({ maxWriteBytes: 100 })
		expect(svc.acquireWriteBytes(60)).toBe(60)
		expect(svc.acquireWriteBytes(50)).toBe(40)
		expect(svc.acquireWriteBytes(10)).toBe(0)
	})

	it("acquires file handles up to the limit", () => {
		const svc = new ResourceLimitsService({ maxOpenFileHandles: 2 })
		expect(svc.acquireFileHandle()).toBe(true)
		expect(svc.acquireFileHandle()).toBe(true)
		expect(svc.acquireFileHandle()).toBe(false)
	})

	it("releases file handles", () => {
		const svc = new ResourceLimitsService({ maxOpenFileHandles: 1 })
		expect(svc.acquireFileHandle()).toBe(true)
		svc.releaseFileHandle()
		expect(svc.acquireFileHandle()).toBe(true)
	})

	it("releases read bytes", () => {
		const svc = new ResourceLimitsService({ maxReadBytes: 100 })
		svc.acquireReadBytes(80)
		svc.releaseReadBytes(30)
		expect(svc.getUsage().readBytes).toBe(50)
		expect(svc.acquireReadBytes(60)).toBe(50)
	})

	it("releases write bytes", () => {
		const svc = new ResourceLimitsService({ maxWriteBytes: 100 })
		svc.acquireWriteBytes(80)
		svc.releaseWriteBytes(30)
		expect(svc.getUsage().writeBytes).toBe(50)
		expect(svc.acquireWriteBytes(60)).toBe(50)
	})

	it("dispose blocks all future acquisitions", () => {
		const svc = new ResourceLimitsService()
		svc.dispose()
		expect(svc.isDisposed()).toBe(true)
		expect(svc.acquireReadBytes(10)).toBe(0)
		expect(svc.acquireWriteBytes(10)).toBe(0)
		expect(svc.acquireFileHandle()).toBe(false)
	})

	it("uses default limits when no config provided", () => {
		const svc = new ResourceLimitsService()
		expect(svc.acquireReadBytes(DEFAULT_RESOURCE_LIMITS.maxReadBytes)).toBe(DEFAULT_RESOURCE_LIMITS.maxReadBytes)
		expect(svc.acquireReadBytes(1)).toBe(0)
	})

	it("handles zero and negative requests gracefully", () => {
		const svc = new ResourceLimitsService()
		expect(svc.acquireReadBytes(0)).toBe(0)
		expect(svc.acquireReadBytes(-1)).toBe(0)
		expect(svc.acquireWriteBytes(0)).toBe(0)
		expect(svc.acquireWriteBytes(-1)).toBe(0)
	})

	it("release does not go negative", () => {
		const svc = new ResourceLimitsService()
		svc.releaseReadBytes(100)
		svc.releaseWriteBytes(100)
		svc.releaseFileHandle()
		expect(svc.getUsage().readBytes).toBe(0)
		expect(svc.getUsage().writeBytes).toBe(0)
		expect(svc.getUsage().openFileHandles).toBe(0)
	})
})

describe("createPerRequestResourceLimits", () => {
	it("creates an independent service instance", () => {
		const svc1 = createPerRequestResourceLimits({ maxReadBytes: 100 })
		const svc2 = createPerRequestResourceLimits({ maxReadBytes: 200 })
		svc1.acquireReadBytes(50)
		expect(svc1.getUsage().readBytes).toBe(50)
		expect(svc2.getUsage().readBytes).toBe(0)
	})
})
