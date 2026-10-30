import { describe, it, expect, vi, beforeEach } from "vitest"

const fsMocks = vi.hoisted(() => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
}))

vi.mock("fs/promises", () => ({ ...fsMocks, default: fsMocks }))

const windowMocks = vi.hoisted(() => ({
	showWarningMessage: vi.fn(),
}))

vi.mock("vscode", () => ({ window: windowMocks }))

import * as path from "path"

import { isWorkspaceTrusted, promptUserToTrustMcpServers, trustWorkspace } from "../McpWorkspaceTrust"

describe("McpWorkspaceTrust", () => {
	const filePath = path.join("/storage", "trusted_workspaces.json")

	beforeEach(() => {
		vi.clearAllMocks()
		fsMocks.writeFile.mockResolvedValue(undefined)
		fsMocks.mkdir.mockResolvedValue(undefined)
	})

	describe("isWorkspaceTrusted", () => {
		it("returns true when a normalized path matches", async () => {
			fsMocks.readFile.mockResolvedValue(
				JSON.stringify({ trustedWorkspaces: [path.join("/work", "..", "work", "repo")] }),
			)

			await expect(isWorkspaceTrusted(filePath, "/work/repo")).resolves.toBe(true)
		})

		it("returns false for a different workspace", async () => {
			fsMocks.readFile.mockResolvedValue(JSON.stringify({ trustedWorkspaces: ["/work/other"] }))

			await expect(isWorkspaceTrusted(filePath, "/work/repo")).resolves.toBe(false)
		})

		it("returns false when the file is missing", async () => {
			fsMocks.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }))

			await expect(isWorkspaceTrusted(filePath, "/work/repo")).resolves.toBe(false)
		})

		it("returns false for malformed JSON", async () => {
			fsMocks.readFile.mockResolvedValue("{not json")

			await expect(isWorkspaceTrusted(filePath, "/work/repo")).resolves.toBe(false)
		})

		it("returns false when the field is absent", async () => {
			fsMocks.readFile.mockResolvedValue("{}")

			await expect(isWorkspaceTrusted(filePath, "/work/repo")).resolves.toBe(false)
		})
	})

	describe("trustWorkspace", () => {
		it("creates the file when it does not exist", async () => {
			fsMocks.readFile.mockRejectedValue(new Error("missing"))

			await trustWorkspace(filePath, "/work/repo")

			expect(fsMocks.mkdir).toHaveBeenCalledWith(path.dirname(filePath), { recursive: true })
			const written = JSON.parse(fsMocks.writeFile.mock.calls[0][1] as string)
			expect(written.trustedWorkspaces).toEqual([path.normalize("/work/repo")])
		})

		it("appends to existing entries", async () => {
			fsMocks.readFile.mockResolvedValue(JSON.stringify({ trustedWorkspaces: ["/work/other"] }))

			await trustWorkspace(filePath, "/work/repo")

			const written = JSON.parse(fsMocks.writeFile.mock.calls[0][1] as string)
			expect(written.trustedWorkspaces).toEqual(["/work/other", path.normalize("/work/repo")])
		})

		it("does not duplicate an already trusted workspace", async () => {
			const normalized = path.normalize("/work/repo")
			fsMocks.readFile.mockResolvedValue(JSON.stringify({ trustedWorkspaces: [normalized] }))

			await trustWorkspace(filePath, "/work/repo")

			const written = JSON.parse(fsMocks.writeFile.mock.calls[0][1] as string)
			expect(written.trustedWorkspaces).toEqual([normalized])
		})

		it("recovers when the stored field is not an array", async () => {
			fsMocks.readFile.mockResolvedValue(JSON.stringify({ trustedWorkspaces: "oops" }))

			await trustWorkspace(filePath, "/work/repo")

			const written = JSON.parse(fsMocks.writeFile.mock.calls[0][1] as string)
			expect(written.trustedWorkspaces).toEqual([path.normalize("/work/repo")])
		})
	})

	describe("promptUserToTrustMcpServers", () => {
		it("returns true when the user enables servers", async () => {
			windowMocks.showWarningMessage.mockResolvedValue("Enable MCP Servers")

			await expect(promptUserToTrustMcpServers()).resolves.toBe(true)
		})

		it("returns false when the user skips", async () => {
			windowMocks.showWarningMessage.mockResolvedValue("Skip")

			await expect(promptUserToTrustMcpServers()).resolves.toBe(false)
		})

		it("returns false when the dialog is dismissed", async () => {
			windowMocks.showWarningMessage.mockResolvedValue(undefined)

			await expect(promptUserToTrustMcpServers()).resolves.toBe(false)
		})
	})
})
