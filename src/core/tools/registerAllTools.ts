/**
 * Central tool registration module.
 *
 * Imports all tool singletons and registers them with the ToolRegistry.
 * This module is imported once at startup (side-effect import) to populate
 * the registry before any tool dispatch occurs.
 *
 * Adding a new tool requires only adding the import and register() call here.
 *
 * Tools can be registered in two ways:
 *   - Unconditional: always available (toolRegistry.register)
 *   - Conditional: available only when a runtime condition is met
 *     (toolRegistry.registerConditional) — e.g., platform checks, feature flags
 */
import { toolRegistry } from "./ToolRegistry"

// Tool singletons
import { listFilesTool } from "./ListFilesTool"
import { readFileTool } from "./ReadFileTool"
import { readCommandOutputTool } from "./ReadCommandOutputTool"
import { writeToFileTool } from "./WriteToFileTool"
import { editTool } from "./EditTool"
import { searchReplaceTool } from "./SearchReplaceTool"
import { editFileTool } from "./EditFileTool"
import { applyPatchTool } from "./ApplyPatchTool"
import { applyDiffTool } from "./ApplyDiffTool"
import { searchFilesTool } from "./SearchFilesTool"
import { executeCommandTool } from "./ExecuteCommandTool"
import { useMcpToolTool } from "./UseMcpToolTool"
import { accessMcpResourceTool } from "./accessMcpResourceTool"
import { askFollowupQuestionTool } from "./AskFollowupQuestionTool"
import { switchModeTool } from "./SwitchModeTool"
import { attemptCompletionTool } from "./AttemptCompletionTool"
import { newTaskTool } from "./NewTaskTool"
import { updateTodoListTool } from "./UpdateTodoListTool"
import { runSlashCommandTool } from "./RunSlashCommandTool"
import { skillTool } from "./SkillTool"
import { generateImageTool } from "./GenerateImageTool"
import { webSearchTool } from "./WebSearchTool"
import { webFetchTool } from "./WebFetchTool"
import { codebaseSearchTool } from "./CodebaseSearchTool"
import { grepTool } from "./GrepTool"
import { globTool } from "./GlobTool"
import { lspTool } from "./LSPTool"
import { sleepTool } from "./SleepTool"
import { notebookEditTool } from "./NotebookEditTool"
import { taskCreateTool } from "./TaskCreateTool"
import { taskUpdateTool } from "./TaskUpdateTool"
import { taskListTool } from "./TaskListTool"
import { taskGetTool } from "./TaskGetTool"
import { taskStopTool } from "./TaskStopTool"
import { taskOutputTool } from "./TaskOutputTool"
import { toolSearchTool } from "./ToolSearchTool"
import { agentTool } from "./AgentTool"
import { sendMessageTool } from "./SendMessageTool"
import { briefTool } from "./BriefTool"
import { configTool } from "./ConfigTool"

// Conditional tools
import { PowerShellTool } from "./PowerShellTool"
import { WorktreeTool } from "./WorktreeTool"

// Register all tools with the central registry
const allTools = [
	listFilesTool,
	readFileTool,
	readCommandOutputTool,
	writeToFileTool,
	editTool,
	searchReplaceTool,
	editFileTool,
	applyPatchTool,
	applyDiffTool,
	searchFilesTool,
	executeCommandTool,
	useMcpToolTool,
	accessMcpResourceTool,
	askFollowupQuestionTool,
	switchModeTool,
	attemptCompletionTool,
	newTaskTool,
	updateTodoListTool,
	runSlashCommandTool,
	skillTool,
	generateImageTool,
	webSearchTool,
	webFetchTool,
	codebaseSearchTool,
	grepTool,
	globTool,
	lspTool,
	sleepTool,
	notebookEditTool,
	taskCreateTool,
	taskUpdateTool,
	taskListTool,
	taskGetTool,
	taskStopTool,
	taskOutputTool,
	toolSearchTool,
	agentTool,
	sendMessageTool,
	briefTool,
	configTool,
] as const

for (const tool of allTools) {
	toolRegistry.register(tool)
}

// Wire up ToolSearchTool with the registry (it implements the ToolRegistry interface)
toolSearchTool.setToolRegistry(toolRegistry)

// ── Conditional tool registration ────────────────────────────────────
// These tools are only available when their runtime conditions are met.
// They don't appear in the initial tool list; ToolSearchTool can discover them.

// PowerShellTool: only on Windows
toolRegistry.registerConditional(
	new PowerShellTool(),
	() => PowerShellTool.isAvailable(),
)

// WorktreeTool: available when git is present (deferred, discovered via ToolSearchTool)
toolRegistry.registerConditional(
	new WorktreeTool(),
	() => WorktreeTool.isAvailable(),
)