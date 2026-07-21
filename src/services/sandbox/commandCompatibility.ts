const POWERSHELL_ENV_RE = /\$env:/i

const POWERSHELL_PIPE_CMDLET_RE =
	/\|\s*(out|where|select|foreach|format|sort|group|measure|compare|write|test|invoke|import|export)-/i

const POWERSHELL_STANDALONE_CMDLET_RE =
	/^\s*(get|set|new|remove|start|stop|invoke|import|export|write|test|read|copy|move|clear|enable|disable|convert|convertto|convertfrom|select|where|foreach|sort|group|measure|compare|format|out|update|register|unregister|add|rename|split|join|send|receive|enter|exit|push|pop|use|open|close|find|grant|revoke|lock|unlock|protect|unprotect|assert|debug|trace|wait|complete|approve|deny|confirm|checkpoint|restore|save|merge|publish|unpublish|install|uninstall|repair|reset|sync|optimize|repair|expand|compress|block|unblock|unprotect|watch|trace)-\w+/im

const WINDOWS_PATH_RE = /[A-Za-z]:\\/

const WINDOWS_EXECUTABLE_RE = /\.(exe|cmd|bat)\b/i

const POWERSHELL_ASSIGNMENT_RE = /\$\w+\s*=\s*/

export interface WindowsDetectionResult {
	incompatible: boolean
	reason?: string
}

export function detectWindowsSpecificCommand(command: string): WindowsDetectionResult {
	if (POWERSHELL_ENV_RE.test(command)) {
		return { incompatible: true, reason: "PowerShell $env: syntax is not supported in Linux containers" }
	}

	if (POWERSHELL_PIPE_CMDLET_RE.test(command)) {
		return { incompatible: true, reason: "PowerShell pipeline cmdlet detected (e.g. Out-*, Where-*, Select-*)" }
	}

	if (POWERSHELL_STANDALONE_CMDLET_RE.test(command)) {
		return { incompatible: true, reason: "PowerShell cmdlet detected (e.g. Get-*, Set-*, New-*, Remove-*)" }
	}

	if (WINDOWS_PATH_RE.test(command) && !command.includes("\\\\")) {
		return { incompatible: true, reason: "Windows drive path (e.g. C:\\) detected" }
	}

	if (WINDOWS_EXECUTABLE_RE.test(command)) {
		return { incompatible: true, reason: "Windows executable extension (.exe/.cmd/.bat) detected" }
	}

	if (POWERSHELL_ASSIGNMENT_RE.test(command) && /\$(env:|error|true|false|null|host|pwd|home|args)/i.test(command)) {
		return { incompatible: true, reason: "PowerShell variable assignment with automatic variable detected" }
	}

	return { incompatible: false }
}
