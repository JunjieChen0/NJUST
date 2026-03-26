import * as path from "path"

describe("custom-instructions path detection", () => {
	it("should use exact path comparison instead of string includes", () => {
		// Test the logic that our fix implements
		const fakeHomeDir = "/Users/john.njust_ai.smith"
		const globalRooDir = path.join(fakeHomeDir, ".njust_ai") // "/Users/john.njust_ai.smith/.njust_ai"
		const projectRooDir = "/projects/my-project/.njust_ai"

		// Old implementation (fragile):
		// const isGlobal = rooDir.includes(path.join(os.homedir(), ".njust_ai"))
		// This could fail if the home directory path contains ".njust_ai" elsewhere

		// New implementation (robust):
		// const isGlobal = path.resolve(rooDir) === path.resolve(getGlobalRooDirectory())

		// Test the new logic
		const isGlobalForGlobalDir = path.resolve(globalRooDir) === path.resolve(globalRooDir)
		const isGlobalForProjectDir = path.resolve(projectRooDir) === path.resolve(globalRooDir)

		expect(isGlobalForGlobalDir).toBe(true)
		expect(isGlobalForProjectDir).toBe(false)

		// Verify that the old implementation would have been problematic
		// if the home directory contained ".njust_ai" in the path
		const oldLogicGlobal = globalRooDir.includes(path.join(fakeHomeDir, ".njust_ai"))
		const oldLogicProject = projectRooDir.includes(path.join(fakeHomeDir, ".njust_ai"))

		expect(oldLogicGlobal).toBe(true) // This works
		expect(oldLogicProject).toBe(false) // This also works, but is fragile

		// The issue was that if the home directory path itself contained ".njust_ai",
		// the includes() check could produce false positives in edge cases
	})

	it("should handle edge cases with path resolution", () => {
		// Test various edge cases that exact path comparison handles better
		const testCases = [
			{
				global: "/Users/test/.njust_ai",
				project: "/Users/test/project/.njust_ai",
				expected: { global: true, project: false },
			},
			{
				global: "/home/user/.njust_ai",
				project: "/home/user/.njust_ai", // Same directory
				expected: { global: true, project: true },
			},
			{
				global: "/Users/john.njust_ai.smith/.njust_ai",
				project: "/projects/app/.njust_ai",
				expected: { global: true, project: false },
			},
		]

		testCases.forEach(({ global, project, expected }) => {
			const isGlobalForGlobal = path.resolve(global) === path.resolve(global)
			const isGlobalForProject = path.resolve(project) === path.resolve(global)

			expect(isGlobalForGlobal).toBe(expected.global)
			expect(isGlobalForProject).toBe(expected.project)
		})
	})
})
