// Real Cangjie SDK smoke test. Opt-in because it spawns cjpm and takes tens of seconds:
//   NJUST_CANGJIE_SDK_SMOKE=1 npx vitest run core/verification/__tests__/CangjieVerificationRunner.sdk.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { createDefaultCangjieCheckDeps, runCangjieVerification } from "../CangjieVerificationRunner"
import { evaluateVerification } from "../verdict"
import { loadVerificationRecord } from "../VerificationStore"

const enabled = process.env.NJUST_CANGJIE_SDK_SMOKE === "1" && Boolean(process.env.CANGJIE_HOME)

const CALC = (body: string) => `package demo

public func add(a: Int64, b: Int64): Int64 {
    ${body}
}
`

const CALC_TEST = `package demo

import std.unittest.*
import std.unittest.testmacro.*

@Test
class CalcTest {
    @TestCase
    func addsSmallNumbers(): Unit {
        @Expect(add(1, 2), 3)
    }
    @TestCase
    func addsNegatives(): Unit {
        @Expect(add(-1, -1), -2)
    }
}
`

describe.skipIf(!enabled)("Cangjie verification with a real SDK", () => {
	let base: string
	let projectRoot: string
	let taskDir: string

	beforeAll(async () => {
		base = await fs.mkdtemp(path.join(os.tmpdir(), "cj-sdk-smoke-"))
		projectRoot = path.join(base, "demo")
		taskDir = path.join(base, "task")
		await fs.mkdir(path.join(projectRoot, "src"), { recursive: true })
		await fs.writeFile(
			path.join(projectRoot, "cjpm.toml"),
			[
				"[package]",
				'  cjc-version = "1.0.0"',
				'  name = "demo"',
				'  version = "1.0.0"',
				'  output-type = "executable"',
				"",
			].join("\n"),
			"utf8",
		)
		await fs.writeFile(path.join(projectRoot, "src", "main.cj"), "package demo\n\nmain(): Int64 {\n    0\n}\n")
		await fs.writeFile(path.join(projectRoot, "src", "calc_test.cj"), CALC_TEST, "utf8")
	})

	afterAll(async () => {
		// Windows can hold file locks briefly after a killed process tree exits.
		await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
	})

	async function verify(signal = new AbortController().signal) {
		const deps = createDefaultCangjieCheckDeps()
		const result = await runCangjieVerification(
			{ taskId: "smoke", taskDir, projectRoot, signal, phase: "delivery", approve: async () => true },
			deps,
		)
		const fingerprint = await deps.fingerprint(projectRoot)
		return { result, verdict: evaluateVerification(await loadVerificationRecord(taskDir, "smoke"), fingerprint) }
	}

	it("records a passing build and a real failing test", async () => {
		await fs.writeFile(path.join(projectRoot, "src", "calc.cj"), CALC("a + b + 1"), "utf8")

		const { result, verdict } = await verify()

		expect(result.build).toMatchObject({ status: "passed", exitCode: 0 })
		expect(result.test).toMatchObject({ status: "failed" })
		expect(result.test?.testScope).toMatchObject({ executed: 2, failed: 2 })
		expect(verdict.overall).toBe("failed")
		expect(result.build.sdk?.version).toMatch(/Cangjie/i)
	}, 240_000)

	it("verifies the fixed code and marks the old failure stale", async () => {
		await fs.writeFile(path.join(projectRoot, "src", "calc.cj"), CALC("a + b"), "utf8")

		const { verdict } = await verify()

		expect(verdict.overall).toBe("verified")
		expect(verdict.test.state).toBe("passed")
	}, 240_000)

	it("records a cancelled build when the task is cancelled", async () => {
		await fs.writeFile(path.join(projectRoot, "src", "calc.cj"), CALC("a + b + 0"), "utf8")
		const controller = new AbortController()
		setTimeout(() => controller.abort(), 300)

		const { result } = await verify(controller.signal)

		expect(result.build.status).toBe("cancelled")
		expect(result.test).toBeUndefined()
	}, 240_000)
})
