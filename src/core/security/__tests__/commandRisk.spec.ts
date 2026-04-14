import { describe, expect, it } from "vitest"
import { assessCommandRisk } from "../commandRisk"

describe("assessCommandRisk", () => {
	it("flags high-risk destructive command", () => {
		const r = assessCommandRisk("rm -rf /tmp/demo")
		expect(r.level).toBe("high")
	})

	it("flags medium-risk compositional command", () => {
		const r = assessCommandRisk("npm install axios && npm test")
		expect(r.level).toBe("medium")
	})

	it("flags low-risk read command", () => {
		const r = assessCommandRisk("git status")
		expect(r.level).toBe("low")
	})

	it("flags powershell policy mutation as high risk", () => {
		const r = assessCommandRisk("Set-ExecutionPolicy Bypass -Scope Process -Force")
		expect(r.level).toBe("high")
	})

	it("flags service control as medium risk", () => {
		const r = assessCommandRisk("Restart-Service Spooler")
		expect(r.level).toBe("medium")
	})
})
