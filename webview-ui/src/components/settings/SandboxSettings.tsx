import { useCallback, useEffect, useRef, useState } from "react"
import { Shield, ShieldCheck, ShieldAlert, RefreshCw, Trash2, Play } from "lucide-react"

import {
	SANDBOX_LIMITS,
	parseSandboxExtensionMessage,
	sandboxDockerImageSchema,
	type SandboxBackend,
	type SandboxDockerStatus,
	type SandboxNetworkMode,
	type SandboxSettings as SandboxConfiguration,
	type SandboxSettingsUpdate,
	type SandboxWebviewMessage,
	type SandboxWorkspaceAccess,
} from "@njust-ai/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button } from "@src/components/ui"
import { vscode } from "@src/utils/vscode"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

/**
 * Sandbox settings component for the SettingsView.
 *
 * Manages Docker sandbox configuration including backend selection,
 * Docker availability status, image management, and resource limits.
 *
 * All inputs bind to local state and only sync to the extension host
 * when the user clicks "Save" in the parent SettingsView.
 */

type SandboxStateField = keyof SandboxSettingsUpdate
type SandboxAction = SandboxWebviewMessage["type"]

const SANDBOX_ACTION_TIMEOUT_MS = 30_000
const SANDBOX_PULL_TIMEOUT_MS = 11 * 60_000

interface SandboxSettingsProps {
	settings: SandboxConfiguration
	initialDockerStatus: SandboxDockerStatus
	setCachedStateField: <K extends SandboxStateField>(field: K, value: SandboxSettingsUpdate[K]) => void
}

function createRequestId(action: SandboxWebviewMessage["type"]): string {
	const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
	return `${action}-${id}`
}

function numericInputValue(value: number): number | "" {
	return Number.isFinite(value) ? value : ""
}

export function SandboxSettings({ settings, initialDockerStatus, setCachedStateField }: SandboxSettingsProps) {
	const { t } = useAppTranslation()
	const [dockerStatus, setDockerStatus] = useState(initialDockerStatus)
	const [isTesting, setIsTesting] = useState(false)
	const [isCleaning, setIsCleaning] = useState(false)
	const [isPulling, setIsPulling] = useState(false)
	const [testResult, setTestResult] = useState<string | null>(null)
	const [pullLog, setPullLog] = useState<string | null>(null)
	const activeRequests = useRef<Partial<Record<SandboxAction, string>>>({})
	const requestTimers = useRef<Partial<Record<SandboxAction, ReturnType<typeof setTimeout>>>>({})

	const dockerImageValid = sandboxDockerImageSchema.safeParse(settings.dockerImage).success

	const numericError = useCallback(
		(value: number, limits: { min: number; max: number }, integer: boolean): string | undefined => {
			if (!Number.isFinite(value)) {
				return t("settings:sandbox.validation.numberRequired")
			}
			if (integer && !Number.isInteger(value)) {
				return t("settings:sandbox.validation.integerRequired")
			}
			if (value < limits.min || value > limits.max) {
				return t("settings:sandbox.validation.range", { min: limits.min, max: limits.max })
			}
			return undefined
		},
		[t],
	)

	const memoryError = numericError(settings.memoryMb, SANDBOX_LIMITS.memoryMb, true)
	const cpuError = numericError(settings.cpuLimit, SANDBOX_LIMITS.cpuLimit, false)
	const pidsError = numericError(settings.pidsLimit, SANDBOX_LIMITS.pidsLimit, true)
	const timeoutError = numericError(settings.timeoutSeconds, SANDBOX_LIMITS.timeoutSeconds, true)

	const setNumericField = useCallback(
		(
			field: "sandboxMemoryMb" | "sandboxCpuLimit" | "sandboxPidsLimit" | "sandboxTimeoutSeconds",
			rawValue: string,
		) => {
			setCachedStateField(field, rawValue === "" ? Number.NaN : Number(rawValue))
		},
		[setCachedStateField],
	)

	const clampNumericField = useCallback(
		(
			field: "sandboxMemoryMb" | "sandboxCpuLimit" | "sandboxPidsLimit" | "sandboxTimeoutSeconds",
			value: number,
			limits: { min: number; max: number; default: number },
			integer: boolean,
		) => {
			const finiteValue = Number.isFinite(value) ? value : limits.default
			const normalized = Math.min(
				limits.max,
				Math.max(limits.min, integer ? Math.round(finiteValue) : finiteValue),
			)
			setCachedStateField(field, normalized)
		},
		[setCachedStateField],
	)

	const clearRequest = useCallback((action: SandboxAction, requestId?: string): boolean => {
		if (requestId !== undefined && activeRequests.current[action] !== requestId) return false

		const timer = requestTimers.current[action]
		if (timer !== undefined) clearTimeout(timer)
		delete requestTimers.current[action]
		delete activeRequests.current[action]
		return true
	}, [])

	const startRequest = useCallback(
		(action: SandboxAction, requestId: string, timeoutMs: number, onTimeout: () => void) => {
			clearRequest(action)
			activeRequests.current[action] = requestId
			requestTimers.current[action] = setTimeout(() => {
				if (!clearRequest(action, requestId)) return
				onTimeout()
			}, timeoutMs)
		},
		[clearRequest],
	)

	useEffect(() => {
		setDockerStatus(initialDockerStatus)
	}, [initialDockerStatus])

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = parseSandboxExtensionMessage(event.data)
			if (!message) return

			switch (message.type) {
				case "sandboxTestResult":
					if (!clearRequest("sandboxTest", message.requestId)) return
					setDockerStatus(message.payload.status)
					setTestResult(message.payload.message)
					setIsTesting(false)
					break
				case "sandboxCleanupResult":
					if (!clearRequest("sandboxCleanup", message.requestId)) return
					setIsCleaning(false)
					setTestResult(message.payload.message)
					break
				case "sandboxPullProgress":
					if (activeRequests.current.sandboxPullImage !== message.requestId) return
					setPullLog(message.payload.line)
					break
				case "sandboxPullComplete":
					if (!clearRequest("sandboxPullImage", message.requestId)) return
					setIsPulling(false)
					setPullLog(message.payload.message)
					break
			}
		}
		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
			clearRequest("sandboxTest")
			clearRequest("sandboxCleanup")
			clearRequest("sandboxPullImage")
		}
	}, [clearRequest])

	const handleTestSandbox = useCallback(() => {
		const requestId = createRequestId("sandboxTest")
		startRequest("sandboxTest", requestId, SANDBOX_ACTION_TIMEOUT_MS, () => {
			setIsTesting(false)
			setDockerStatus("unknown")
			setTestResult(t("settings:sandbox.timeouts.test"))
		})
		setIsTesting(true)
		setDockerStatus("checking")
		setTestResult(null)
		const message: SandboxWebviewMessage = { type: "sandboxTest", requestId }
		vscode.postMessage(message)
	}, [startRequest, t])

	const handleCleanupContainers = useCallback(() => {
		const requestId = createRequestId("sandboxCleanup")
		startRequest("sandboxCleanup", requestId, SANDBOX_ACTION_TIMEOUT_MS, () => {
			setIsCleaning(false)
			setTestResult(t("settings:sandbox.timeouts.cleanup"))
		})
		setIsCleaning(true)
		setTestResult(null)
		const message: SandboxWebviewMessage = { type: "sandboxCleanup", requestId }
		vscode.postMessage(message)
	}, [startRequest, t])

	const handlePullImage = useCallback(() => {
		if (!dockerImageValid) return
		const requestId = createRequestId("sandboxPullImage")
		startRequest("sandboxPullImage", requestId, SANDBOX_PULL_TIMEOUT_MS, () => {
			setIsPulling(false)
			setPullLog(t("settings:sandbox.timeouts.pull"))
		})
		setIsPulling(true)
		setPullLog(null)
		const message: SandboxWebviewMessage = {
			type: "sandboxPullImage",
			requestId,
			image: settings.dockerImage,
		}
		vscode.postMessage(message)
	}, [dockerImageValid, settings.dockerImage, startRequest, t])

	// Docker status indicator
	const getStatusIcon = () => {
		switch (dockerStatus) {
			case "available":
				return <ShieldCheck className="w-4 h-4 text-green-500" />
			case "daemon-not-running":
				return <ShieldAlert className="w-4 h-4 text-yellow-500" />
			case "not-installed":
				return <ShieldAlert className="w-4 h-4 text-red-500" />
			default:
				return <Shield className="w-4 h-4 text-gray-400" />
		}
	}

	const getStatusText = () => {
		switch (dockerStatus) {
			case "available":
				return t("settings:sandbox.dockerStatus.available")
			case "daemon-not-running":
				return t("settings:sandbox.dockerStatus.daemonNotRunning")
			case "not-installed":
				return t("settings:sandbox.dockerStatus.notInstalled")
			case "checking":
				return t("settings:sandbox.dockerStatus.checking")
			default:
				return t("settings:sandbox.dockerStatus.unknown")
		}
	}

	return (
		<div>
			<SectionHeader>{t("settings:sandbox.title")}</SectionHeader>

			<Section>
				<div className="mb-4" data-setting-id="sandbox-backend">
					<label className="block text-vscode-foreground text-sm font-medium mb-1">
						{t("settings:sandbox.backend.label")}
					</label>
					<p className="text-vscode-descriptionForeground text-xs mb-2">
						{t("settings:sandbox.backend.description")}
					</p>
					<select
						value={settings.backend}
						onChange={(event) =>
							setCachedStateField("sandboxBackend", event.target.value as SandboxBackend)
						}
						className="w-full p-2 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded text-sm">
						<option value="guarded-host">{t("settings:sandbox.backend.guardedHost")}</option>
						<option value="docker">{t("settings:sandbox.backend.docker")}</option>
					</select>
					{settings.backend === "docker" && dockerStatus !== "available" && (
						<div className="mt-2 p-2 bg-vscode-inputValidation-warningBackground border border-vscode-inputValidation-warningBorder rounded text-xs">
							{t("settings:sandbox.backend.dockerUnavailable")}
						</div>
					)}
				</div>

				<div className="mb-4" data-setting-id="sandbox-docker-status">
					<label className="block text-vscode-foreground text-sm font-medium mb-1">
						{t("settings:sandbox.dockerStatus.label")}
					</label>
					<div className="flex items-center gap-2 text-sm">
						{getStatusIcon()}
						<span className="text-vscode-descriptionForeground">{getStatusText()}</span>
					</div>
				</div>

				{settings.backend === "docker" && (
					<div className="mb-4" data-setting-id="sandbox-docker-image">
						<label className="block text-vscode-foreground text-sm font-medium mb-1">
							{t("settings:sandbox.dockerImage.label")}
						</label>
						<p className="text-vscode-descriptionForeground text-xs mb-2">
							{t("settings:sandbox.dockerImage.description")}
						</p>
						<div className="flex gap-2">
							<input
								type="text"
								value={settings.dockerImage}
								onChange={(event) => setCachedStateField("sandboxDockerImage", event.target.value)}
								aria-invalid={!dockerImageValid}
								aria-describedby={!dockerImageValid ? "sandbox-docker-image-error" : undefined}
								className="flex-1 p-2 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded text-sm"
								placeholder={t("settings:sandbox.dockerImage.placeholder")}
							/>
							<Button
								variant="secondary"
								size="sm"
								onClick={handlePullImage}
								disabled={isPulling || !dockerImageValid}>
								<RefreshCw className={`w-3.5 h-3.5 mr-1 ${isPulling ? "animate-spin" : ""}`} />
								{t("settings:sandbox.actions.pull")}
							</Button>
						</div>
						{!dockerImageValid && (
							<p
								id="sandbox-docker-image-error"
								role="alert"
								className="mt-1 text-vscode-errorForeground text-xs">
								{t("settings:sandbox.validation.imageInvalid")}
							</p>
						)}
						{pullLog && <p className="mt-1 text-vscode-descriptionForeground text-xs">{pullLog}</p>}
					</div>
				)}

				{settings.backend === "docker" && (
					<div className="mb-4" data-setting-id="sandbox-network-mode">
						<label className="block text-vscode-foreground text-sm font-medium mb-1">
							{t("settings:sandbox.networkMode.label")}
						</label>
						<p className="text-vscode-descriptionForeground text-xs mb-2">
							{t("settings:sandbox.networkMode.description")}
						</p>
						<select
							value={settings.networkMode}
							onChange={(event) =>
								setCachedStateField("sandboxNetworkMode", event.target.value as SandboxNetworkMode)
							}
							className="w-full p-2 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded text-sm">
							<option value="none">{t("settings:sandbox.networkMode.none")}</option>
							<option value="bridge">{t("settings:sandbox.networkMode.bridge")}</option>
						</select>
					</div>
				)}

				{settings.backend === "docker" && (
					<div className="mb-4" data-setting-id="sandbox-workspace-access">
						<label className="block text-vscode-foreground text-sm font-medium mb-1">
							{t("settings:sandbox.workspaceAccess.label")}
						</label>
						<select
							value={settings.workspaceAccess}
							onChange={(event) =>
								setCachedStateField(
									"sandboxWorkspaceAccess",
									event.target.value as SandboxWorkspaceAccess,
								)
							}
							className="w-full p-2 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded text-sm">
							<option value="read-write">{t("settings:sandbox.workspaceAccess.readWrite")}</option>
							<option value="read-only">{t("settings:sandbox.workspaceAccess.readOnly")}</option>
						</select>
					</div>
				)}

				{settings.backend === "docker" && (
					<>
						<div className="mb-4" data-setting-id="sandbox-memory">
							<label className="block text-vscode-foreground text-sm font-medium mb-1">
								{t("settings:sandbox.limits.memory.label")}
							</label>
							<p className="text-vscode-descriptionForeground text-xs mb-2">
								{t("settings:sandbox.limits.memory.description", SANDBOX_LIMITS.memoryMb)}
							</p>
							<input
								type="number"
								min={SANDBOX_LIMITS.memoryMb.min}
								max={SANDBOX_LIMITS.memoryMb.max}
								step={SANDBOX_LIMITS.memoryMb.step}
								value={numericInputValue(settings.memoryMb)}
								onChange={(event) => setNumericField("sandboxMemoryMb", event.target.value)}
								onBlur={() =>
									clampNumericField(
										"sandboxMemoryMb",
										settings.memoryMb,
										SANDBOX_LIMITS.memoryMb,
										true,
									)
								}
								aria-invalid={Boolean(memoryError)}
								className="w-32 p-2 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded text-sm"
							/>
							{memoryError && <p className="mt-1 text-vscode-errorForeground text-xs">{memoryError}</p>}
						</div>

						<div className="mb-4" data-setting-id="sandbox-cpu">
							<label className="block text-vscode-foreground text-sm font-medium mb-1">
								{t("settings:sandbox.limits.cpu.label")}
							</label>
							<p className="text-vscode-descriptionForeground text-xs mb-2">
								{t("settings:sandbox.limits.cpu.description", SANDBOX_LIMITS.cpuLimit)}
							</p>
							<input
								type="number"
								min={SANDBOX_LIMITS.cpuLimit.min}
								max={SANDBOX_LIMITS.cpuLimit.max}
								step={SANDBOX_LIMITS.cpuLimit.step}
								value={numericInputValue(settings.cpuLimit)}
								onChange={(event) => setNumericField("sandboxCpuLimit", event.target.value)}
								onBlur={() =>
									clampNumericField(
										"sandboxCpuLimit",
										settings.cpuLimit,
										SANDBOX_LIMITS.cpuLimit,
										false,
									)
								}
								aria-invalid={Boolean(cpuError)}
								className="w-32 p-2 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded text-sm"
							/>
							{cpuError && <p className="mt-1 text-vscode-errorForeground text-xs">{cpuError}</p>}
						</div>

						<div className="mb-4" data-setting-id="sandbox-pids">
							<label className="block text-vscode-foreground text-sm font-medium mb-1">
								{t("settings:sandbox.limits.pids.label")}
							</label>
							<p className="text-vscode-descriptionForeground text-xs mb-2">
								{t("settings:sandbox.limits.pids.description", SANDBOX_LIMITS.pidsLimit)}
							</p>
							<input
								type="number"
								min={SANDBOX_LIMITS.pidsLimit.min}
								max={SANDBOX_LIMITS.pidsLimit.max}
								step={SANDBOX_LIMITS.pidsLimit.step}
								value={numericInputValue(settings.pidsLimit)}
								onChange={(event) => setNumericField("sandboxPidsLimit", event.target.value)}
								onBlur={() =>
									clampNumericField(
										"sandboxPidsLimit",
										settings.pidsLimit,
										SANDBOX_LIMITS.pidsLimit,
										true,
									)
								}
								aria-invalid={Boolean(pidsError)}
								className="w-32 p-2 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded text-sm"
							/>
							{pidsError && <p className="mt-1 text-vscode-errorForeground text-xs">{pidsError}</p>}
						</div>

						<div className="mb-4" data-setting-id="sandbox-timeout">
							<label className="block text-vscode-foreground text-sm font-medium mb-1">
								{t("settings:sandbox.limits.timeout.label")}
							</label>
							<p className="text-vscode-descriptionForeground text-xs mb-2">
								{t("settings:sandbox.limits.timeout.description", SANDBOX_LIMITS.timeoutSeconds)}
							</p>
							<input
								type="number"
								min={SANDBOX_LIMITS.timeoutSeconds.min}
								max={SANDBOX_LIMITS.timeoutSeconds.max}
								step={SANDBOX_LIMITS.timeoutSeconds.step}
								value={numericInputValue(settings.timeoutSeconds)}
								onChange={(event) => setNumericField("sandboxTimeoutSeconds", event.target.value)}
								onBlur={() =>
									clampNumericField(
										"sandboxTimeoutSeconds",
										settings.timeoutSeconds,
										SANDBOX_LIMITS.timeoutSeconds,
										true,
									)
								}
								aria-invalid={Boolean(timeoutError)}
								className="w-32 p-2 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded text-sm"
							/>
							{timeoutError && <p className="mt-1 text-vscode-errorForeground text-xs">{timeoutError}</p>}
						</div>

						<div className="mb-4" data-setting-id="sandbox-task-scoped">
							<label className="flex items-center gap-2 text-sm">
								<input
									type="checkbox"
									checked={settings.taskScopedContainer}
									onChange={(event) =>
										setCachedStateField("sandboxTaskScopedContainer", event.target.checked)
									}
									className="accent-vscode-focusBorder"
								/>
								<span className="text-vscode-foreground font-medium">
									{t("settings:sandbox.taskScoped.label")}
								</span>
							</label>
							<p className="text-vscode-descriptionForeground text-xs mt-1 ml-6">
								{t("settings:sandbox.taskScoped.description")}
							</p>
						</div>
					</>
				)}

				{settings.backend === "docker" && (
					<div className="mb-4 p-3 bg-vscode-badge-background rounded border border-vscode-panel-border">
						<h4 className="text-vscode-foreground text-sm font-medium mb-2">
							{t("settings:sandbox.security.title")}
						</h4>
						<ul className="text-vscode-descriptionForeground text-xs space-y-1">
							<li>- {t("settings:sandbox.security.readOnlyRoot")}</li>
							<li>- {t("settings:sandbox.security.dropCapabilities")}</li>
							<li>- {t("settings:sandbox.security.noNewPrivileges")}</li>
							<li>- {t("settings:sandbox.security.nonRoot")}</li>
							<li>- {t("settings:sandbox.security.noDockerSocket")}</li>
							<li>- {t("settings:sandbox.security.noPrivilegedMode")}</li>
							<li>- {t("settings:sandbox.security.noHostNamespaces")}</li>
							<li>- {t("settings:sandbox.security.noHostEnvironment")}</li>
							<li>- {t("settings:sandbox.security.noHostFallback")}</li>
						</ul>
					</div>
				)}

				<div className="flex gap-2 mt-4">
					<Button variant="secondary" size="sm" onClick={handleTestSandbox} disabled={isTesting}>
						<Play className={`w-3.5 h-3.5 mr-1 ${isTesting ? "animate-pulse" : ""}`} />
						{t("settings:sandbox.actions.checkDocker")}
					</Button>
					{settings.backend === "docker" && (
						<Button variant="secondary" size="sm" onClick={handleCleanupContainers} disabled={isCleaning}>
							<Trash2 className={`w-3.5 h-3.5 mr-1 ${isCleaning ? "animate-pulse" : ""}`} />
							{t("settings:sandbox.actions.cleanupStale")}
						</Button>
					)}
				</div>
				{testResult && <p className="mt-2 text-vscode-descriptionForeground text-xs">{testResult}</p>}
			</Section>
		</div>
	)
}
