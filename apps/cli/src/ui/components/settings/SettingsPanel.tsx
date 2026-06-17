import { Box, Text } from "ink"

import * as theme from "../../theme.js"

export interface ToggleSettingProps {
	label: string
	enabled: boolean
	onToggle: () => void
}

/**
 * Simple toggle row for settings panels.
 */
export function ToggleSetting({ label, enabled, onToggle: _onToggle }: ToggleSettingProps) {
	return (
		<Box>
			<Text color={enabled ? theme.successColor : theme.dimText}>
				{enabled ? "[x]" : "[ ]"} {label}
			</Text>
		</Box>
	)
}

export interface SettingsSectionProps {
	title: string
	children: React.ReactNode
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={theme.rooHeader} bold>
				{title}
			</Text>
			<Box flexDirection="column" marginLeft={1}>
				{children}
			</Box>
		</Box>
	)
}

export interface SettingsPanelProps {
	activeTab: "autoApprove" | "mcp"
	setActiveTab: (tab: "autoApprove" | "mcp") => void
	children: React.ReactNode
	onClose: () => void
}

export function SettingsPanel({
	activeTab,
	setActiveTab: _setActiveTab,
	children,
	onClose: _onClose,
}: SettingsPanelProps) {
	return (
		<Box flexDirection="column" padding={1}>
			<Box flexDirection="row">
				<Text color={theme.rooHeader} bold>
					Settings
				</Text>
				<Text color={theme.dimText}>{"  "}Esc to close</Text>
			</Box>
			<Box flexDirection="row" marginTop={1} marginBottom={1}>
				<Text
					color={activeTab === "autoApprove" ? "cyan" : theme.dimText}
					underline={activeTab === "autoApprove"}
					bold={activeTab === "autoApprove"}>
					Auto-Approve
				</Text>
				<Text color={theme.dimText}>{" | "}</Text>
				<Text
					color={activeTab === "mcp" ? "cyan" : theme.dimText}
					underline={activeTab === "mcp"}
					bold={activeTab === "mcp"}>
					MCP Servers
				</Text>
			</Box>
			{children}
			<Box marginTop={1}>
				<Text color={theme.dimText}>Press Esc to close</Text>
			</Box>
		</Box>
	)
}
