import { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { WebviewMessage } from "@njust-ai/types"

import { useCLIStore } from "../../store.js"
import * as theme from "../../theme.js"
import { SettingsPanel, SettingsSection, ToggleSetting } from "./SettingsPanel.js"

/**
 * Returns the auto-approve flags from the current CLI state.
 */
function useAutoApproveState() {
	const {
		autoApprovalEnabled,
		alwaysAllowReadOnly,
		alwaysAllowWrite,
		alwaysAllowExecute,
		alwaysAllowMcp,
		alwaysAllowModeSwitch,
		alwaysAllowSubtasks,
		alwaysAllowFollowupQuestions,
	} = useCLIStore()

	return useMemo(
		() => ({
			autoApprovalEnabled,
			alwaysAllowReadOnly,
			alwaysAllowWrite,
			alwaysAllowExecute,
			alwaysAllowMcp,
			alwaysAllowModeSwitch,
			alwaysAllowSubtasks,
			alwaysAllowFollowupQuestions,
		}),
		[
			autoApprovalEnabled,
			alwaysAllowReadOnly,
			alwaysAllowWrite,
			alwaysAllowExecute,
			alwaysAllowMcp,
			alwaysAllowModeSwitch,
			alwaysAllowSubtasks,
			alwaysAllowFollowupQuestions,
		],
	)
}

interface AutoApproveSettingsProps {
	sendToExtension: ((msg: WebviewMessage) => void) | null
}

const toggles: Array<{ key: keyof ReturnType<typeof useAutoApproveState>; label: string }> = [
	{ key: "autoApprovalEnabled", label: "Enable auto-approval globally" },
	{ key: "alwaysAllowReadOnly", label: "Read-only file operations" },
	{ key: "alwaysAllowWrite", label: "Write file operations" },
	{ key: "alwaysAllowExecute", label: "Execute commands" },
	{ key: "alwaysAllowMcp", label: "MCP tools" },
	{ key: "alwaysAllowModeSwitch", label: "Mode switches" },
	{ key: "alwaysAllowSubtasks", label: "Subtasks" },
	{ key: "alwaysAllowFollowupQuestions", label: "Follow-up questions" },
]

export function AutoApproveSettings({ sendToExtension }: AutoApproveSettingsProps) {
	const flags = useAutoApproveState()

	const handleToggle = (key: keyof typeof flags) => {
		if (!sendToExtension) {
			return
		}

		const newValue = !flags[key]

		if (key === "autoApprovalEnabled") {
			sendToExtension({ type: "autoApprovalEnabled", bool: newValue })
		} else {
			sendToExtension({ type: "updateSettings", settings: { [key]: newValue } })
		}
	}

	return (
		<SettingsSection title="Auto-Approve Categories">
			{toggles.map((toggle) => (
				<ToggleSetting
					key={toggle.key}
					label={toggle.label}
					enabled={flags[toggle.key]}
					onToggle={() => handleToggle(toggle.key)}
				/>
			))}
		</SettingsSection>
	)
}

interface McpServerListProps {
	sendToExtension: ((msg: WebviewMessage) => void) | null
}

export function McpServerList({ sendToExtension }: McpServerListProps) {
	const { mcpServers } = useCLIStore()
	const [selectedIndex, setSelectedIndex] = useState(0)

	useInput(
		(_input, key) => {
			if (key.downArrow) {
				setSelectedIndex((prev) => (prev < mcpServers.length - 1 ? prev + 1 : 0))
				return
			}
			if (key.upArrow) {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, mcpServers.length - 1)))
				return
			}
			if (key.return) {
				const server = mcpServers[selectedIndex]
				if (server && sendToExtension) {
					sendToExtension({
						type: "toggleMcpServer",
						serverName: server.name,
						isEnabled: server.disabled === true,
					})
				}
				return
			}
			if ((_input === "r" || _input === "R") && sendToExtension) {
				const server = mcpServers[selectedIndex]
				if (server) {
					sendToExtension({ type: "restartMcpServer", serverName: server.name })
				}
				return
			}
		},
		{ isActive: true },
	)

	if (mcpServers.length === 0) {
		return (
			<SettingsSection title="MCP Servers">
				<Text color={theme.dimText}>No MCP servers configured.</Text>
			</SettingsSection>
		)
	}

	return (
		<SettingsSection title="MCP Servers">
			{mcpServers.map((server, index) => {
				const isSelected = index === selectedIndex
				const isEnabled = server.disabled !== true

				return (
					<Box key={server.name} flexDirection="column" marginBottom={1}>
						<Text color={isSelected ? "cyan" : theme.text}>
							{isSelected ? "> " : "  "}
							{server.name}
							<Text color={isEnabled ? theme.successColor : theme.errorColor}>
								{" "}
								{isEnabled ? "enabled" : "disabled"}
							</Text>
						</Text>
						{isSelected && (
							<Box flexDirection="column" marginLeft={2}>
								<Text color={theme.dimText}>Status: {server.status || "unknown"}</Text>
								{server.error && <Text color={theme.errorColor}>Error: {server.error}</Text>}
								<Text color={theme.dimText}>
									Press Enter to {isEnabled ? "disable" : "enable"} • R to restart
								</Text>
							</Box>
						)}
					</Box>
				)
			})}
		</SettingsSection>
	)
}

export interface SettingsOverlayProps {
	sendToExtension: ((msg: WebviewMessage) => void) | null
	onClose: () => void
}

export function SettingsOverlay({ sendToExtension, onClose }: SettingsOverlayProps) {
	const [activeTab, setActiveTab] = useState<"autoApprove" | "mcp">("autoApprove")

	return (
		<SettingsPanel activeTab={activeTab} setActiveTab={setActiveTab} onClose={onClose}>
			{activeTab === "autoApprove" && <AutoApproveSettings sendToExtension={sendToExtension} />}
			{activeTab === "mcp" && <McpServerList sendToExtension={sendToExtension} />}
		</SettingsPanel>
	)
}

export default SettingsOverlay
