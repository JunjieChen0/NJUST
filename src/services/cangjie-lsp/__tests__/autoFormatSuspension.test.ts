import { describe, it, expect } from "vitest"

import * as path from "path"

import { isCangjieAutoFormatSuspended, suspendCangjieAutoFormat } from "../autoFormatSuspension"

describe("Cangjie auto-format suspension", () => {
	const root = path.resolve("/ws/app")

	it("suspends formatting for files under a root until released", () => {
		const release = suspendCangjieAutoFormat(root)

		expect(isCangjieAutoFormatSuspended(path.join(root, "src", "main.cj"))).toBe(true)
		expect(isCangjieAutoFormatSuspended(path.resolve("/ws/application/src/main.cj"))).toBe(false)

		release()
		expect(isCangjieAutoFormatSuspended(path.join(root, "src", "main.cj"))).toBe(false)
	})

	it("keeps formatting suspended while another holder remains and ignores double release", () => {
		const first = suspendCangjieAutoFormat(root)
		const second = suspendCangjieAutoFormat(root)

		first()
		first()
		expect(isCangjieAutoFormatSuspended(path.join(root, "a.cj"))).toBe(true)

		second()
		expect(isCangjieAutoFormatSuspended(path.join(root, "a.cj"))).toBe(false)
	})
})
