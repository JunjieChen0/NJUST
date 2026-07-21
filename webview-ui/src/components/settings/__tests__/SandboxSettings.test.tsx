import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach } from "vitest"

import {
	DEFAULT_SANDBOX_SETTINGS,
	type SandboxExtensionMessage,
	type SandboxSettingsUpdate,
	type SandboxWebviewMessage,
} from "@njust-ai/types"

import { vscode } from "@src/utils/vscode"

import { SandboxSettings } from "../SandboxSettings"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

const postMessage = vi.mocked(vscode.postMessage)

const dockerSettings = { ...DEFAULT_SANDBOX_SETTINGS, backend: "docker" as const }

function renderSandbox(settings = dockerSettings) {
	const setCachedStateField = vi.fn(
		(_field: keyof SandboxSettingsUpdate, _value: SandboxSettingsUpdate[keyof SandboxSettingsUpdate]) => undefined,
	)
	const result = render(
		<SandboxSettings settings={settings} initialDockerStatus="unknown" setCachedStateField={setCachedStateField} />,
	)
	return { ...result, setCachedStateField }
}

function dispatchExtensionMessage(message: SandboxExtensionMessage) {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: message }))
	})
}

describe("SandboxSettings", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		postMessage.mockClear()
	})

	afterEach(() => {
		vi.clearAllTimers()
		vi.useRealTimers()
	})

	it("posts correlated action requests and uses image for pull", () => {
		renderSandbox()

		fireEvent.click(screen.getByRole("button", { name: "settings:sandbox.actions.checkDocker" }))
		fireEvent.click(screen.getByRole("button", { name: "settings:sandbox.actions.cleanupStale" }))
		fireEvent.click(screen.getByRole("button", { name: "settings:sandbox.actions.pull" }))

		const messages = postMessage.mock.calls.map(([message]) => message as SandboxWebviewMessage)
		expect(messages[0]).toEqual({ type: "sandboxTest", requestId: expect.any(String) })
		expect(messages[1]).toEqual({ type: "sandboxCleanup", requestId: expect.any(String) })
		expect(messages[2]).toEqual({
			type: "sandboxPullImage",
			requestId: expect.any(String),
			image: dockerSettings.dockerImage,
		})
		expect(messages[2]).not.toHaveProperty("text")
		expect(new Set(messages.map((message) => message.requestId)).size).toBe(3)
	})

	it("ignores stale responses and updates Docker status locally for the matching request", () => {
		const { setCachedStateField } = renderSandbox()
		fireEvent.click(screen.getByRole("button", { name: "settings:sandbox.actions.checkDocker" }))
		const request = postMessage.mock.calls[0]?.[0] as SandboxWebviewMessage

		dispatchExtensionMessage({
			type: "sandboxTestResult",
			requestId: "stale-request",
			payload: { success: true, status: "available", message: "stale result" },
		})
		expect(screen.queryByText("stale result")).not.toBeInTheDocument()
		expect(screen.getByText("settings:sandbox.dockerStatus.checking")).toBeInTheDocument()

		dispatchExtensionMessage({
			type: "sandboxTestResult",
			requestId: request.requestId,
			payload: { success: true, status: "available", message: "Docker ready" },
		})
		expect(screen.getByText("Docker ready")).toBeInTheDocument()
		expect(screen.getByText("settings:sandbox.dockerStatus.available")).toBeInTheDocument()
		expect(setCachedStateField).not.toHaveBeenCalled()
	})

	it("shows cleanup failures without reporting a successful zero-count cleanup", () => {
		renderSandbox()
		fireEvent.click(screen.getByRole("button", { name: "settings:sandbox.actions.cleanupStale" }))
		const request = postMessage.mock.calls[0]?.[0] as SandboxWebviewMessage

		dispatchExtensionMessage({
			type: "sandboxCleanupResult",
			requestId: request.requestId,
			payload: { success: false, message: "Cleanup failed: Docker unavailable" },
		})

		expect(screen.getByText("Cleanup failed: Docker unavailable")).toBeInTheDocument()
		expect(screen.queryByText(/Cleaned up 0/)).not.toBeInTheDocument()
	})

	it("blocks pulling an invalid image and shows an inline error", () => {
		renderSandbox({ ...dockerSettings, dockerImage: "docker:dind" })
		const pullButton = screen.getByRole("button", { name: "settings:sandbox.actions.pull" })

		expect(pullButton).toBeDisabled()
		expect(screen.getByRole("alert")).toHaveTextContent("settings:sandbox.validation.imageInvalid")
		fireEvent.click(pullButton)
		expect(postMessage).not.toHaveBeenCalled()
	})

	it("reports invalid numeric values and clamps them on blur", () => {
		const { container, setCachedStateField } = renderSandbox({ ...dockerSettings, memoryMb: 12 })
		const memoryInput = container.querySelector<HTMLInputElement>('[data-setting-id="sandbox-memory"] input')

		expect(memoryInput).not.toBeNull()
		expect(screen.getByText("settings:sandbox.validation.range")).toBeInTheDocument()
		fireEvent.blur(memoryInput!)
		expect(setCachedStateField).toHaveBeenCalledWith("sandboxMemoryMb", 64)
	})

	it("writes editable fields only through the cached-state setter", () => {
		const { container, setCachedStateField } = renderSandbox()
		const imageInput = container.querySelector<HTMLInputElement>('[data-setting-id="sandbox-docker-image"] input')
		const networkSelect = container.querySelector<HTMLSelectElement>(
			'[data-setting-id="sandbox-network-mode"] select',
		)

		fireEvent.change(imageInput!, { target: { value: "node:20-alpine" } })
		fireEvent.change(networkSelect!, { target: { value: "bridge" } })

		expect(setCachedStateField).toHaveBeenCalledWith("sandboxDockerImage", "node:20-alpine")
		expect(setCachedStateField).toHaveBeenCalledWith("sandboxNetworkMode", "bridge")
	})

	it("times out Docker checks and ignores a late matching response", () => {
		renderSandbox()
		const checkButton = screen.getByRole("button", { name: "settings:sandbox.actions.checkDocker" })
		fireEvent.click(checkButton)
		const request = postMessage.mock.calls[0]?.[0] as SandboxWebviewMessage

		act(() => vi.advanceTimersToNextTimer())

		expect(checkButton).toBeEnabled()
		expect(screen.getByText("settings:sandbox.timeouts.test")).toBeInTheDocument()
		expect(screen.getByText("settings:sandbox.dockerStatus.unknown")).toBeInTheDocument()

		dispatchExtensionMessage({
			type: "sandboxTestResult",
			requestId: request.requestId,
			payload: { success: true, status: "available", message: "late result" },
		})

		expect(screen.queryByText("late result")).not.toBeInTheDocument()
		expect(screen.getByText("settings:sandbox.timeouts.test")).toBeInTheDocument()
	})

	it("times out cleanup independently", () => {
		renderSandbox()
		const cleanupButton = screen.getByRole("button", { name: "settings:sandbox.actions.cleanupStale" })
		fireEvent.click(cleanupButton)

		act(() => vi.advanceTimersToNextTimer())

		expect(cleanupButton).toBeEnabled()
		expect(screen.getByText("settings:sandbox.timeouts.cleanup")).toBeInTheDocument()
	})

	it("keeps image pulls active longer than regular actions before timing out", () => {
		renderSandbox()
		const checkButton = screen.getByRole("button", { name: "settings:sandbox.actions.checkDocker" })
		const pullButton = screen.getByRole("button", { name: "settings:sandbox.actions.pull" })
		fireEvent.click(checkButton)
		fireEvent.click(pullButton)

		act(() => vi.advanceTimersToNextTimer())

		expect(checkButton).toBeEnabled()
		expect(pullButton).toBeDisabled()
		expect(screen.queryByText("settings:sandbox.timeouts.pull")).not.toBeInTheDocument()

		act(() => vi.advanceTimersToNextTimer())

		expect(pullButton).toBeEnabled()
		expect(screen.getByText("settings:sandbox.timeouts.pull")).toBeInTheDocument()
	})

	it("clears each timer as soon as its matching terminal response arrives", () => {
		renderSandbox()
		fireEvent.click(screen.getByRole("button", { name: "settings:sandbox.actions.checkDocker" }))
		fireEvent.click(screen.getByRole("button", { name: "settings:sandbox.actions.cleanupStale" }))
		fireEvent.click(screen.getByRole("button", { name: "settings:sandbox.actions.pull" }))
		const [testRequest, cleanupRequest, pullRequest] = postMessage.mock.calls.map(
			([message]) => message as SandboxWebviewMessage,
		)
		expect(vi.getTimerCount()).toBe(3)

		dispatchExtensionMessage({
			type: "sandboxTestResult",
			requestId: testRequest!.requestId,
			payload: { success: true, status: "available", message: "Docker ready" },
		})
		expect(vi.getTimerCount()).toBe(2)

		dispatchExtensionMessage({
			type: "sandboxCleanupResult",
			requestId: cleanupRequest!.requestId,
			payload: { success: true, count: 1, message: "Cleanup complete" },
		})
		expect(vi.getTimerCount()).toBe(1)

		dispatchExtensionMessage({
			type: "sandboxPullComplete",
			requestId: pullRequest!.requestId,
			payload: { success: true, image: dockerSettings.dockerImage, message: "Pull complete" },
		})
		expect(vi.getTimerCount()).toBe(0)
	})

	it("clears all pending request timers on unmount", () => {
		const { unmount } = renderSandbox()
		fireEvent.click(screen.getByRole("button", { name: "settings:sandbox.actions.checkDocker" }))
		fireEvent.click(screen.getByRole("button", { name: "settings:sandbox.actions.cleanupStale" }))
		fireEvent.click(screen.getByRole("button", { name: "settings:sandbox.actions.pull" }))
		expect(vi.getTimerCount()).toBe(3)

		unmount()

		expect(vi.getTimerCount()).toBe(0)
	})
})
