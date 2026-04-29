/**
 * Summarization prompts for conversation condensing.
 *
 * Structured prompt with 9 required sections, <analysis> scratchpad (stripped
 * post-hoc to improve quality without increasing context), and aggressive
 * no-tools enforcement — aligned with Claude Code's compact/prompt.ts.
 */

// Aggressive no-tools preamble. The summarizer model sometimes attempts a tool
// call despite a weaker trailer instruction, which wastes a turn. Putting this
// FIRST and making the consequences explicit prevents that.
const NO_TOOLS_PREAMBLE = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use file reading, command execution, search, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: an <analysis> block followed by a <summary> block.

`

const DETAILED_ANALYSIS_INSTRUCTION = `Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message and section of the conversation. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like:
     - file names
     - full code snippets
     - function signatures
     - file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.`

const BASE_COMPACT_PROMPT = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.

${DETAILED_ANALYSIS_INSTRUCTION}

Your summary should include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback that you received, especially if the user told you to do something differently.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.
7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request, paying special attention to the most recent messages from both user and assistant. Include file names and code snippets where applicable.
9. Optional Next Step: List the next step that you will take that is related to the most recent work you were doing. IMPORTANT: ensure that this step is DIRECTLY in line with the user's most recent explicit requests, and the task you were working on immediately before this summary request. If your last task was concluded, then only list next steps if they are explicitly in line with the users request. Do not start on tangential requests or really old requests that were already completed without confirming with the user first.
                       If there is a next step, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no drift in task interpretation.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process, ensuring all points are covered thoroughly and accurately]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detailed description]

2. Key Technical Concepts:
   - [Concept 1]
   - [Concept 2]
   - [...]

3. Files and Code Sections:
   - [File Name 1]
      - [Summary of why this file is important]
      - [Summary of the changes made to this file, if any]
      - [Important Code Snippet]
   - [File Name 2]
      - [Important Code Snippet]
   - [...]

4. Errors and fixes:
    - [Detailed description of error 1]:
      - [How you fixed the error]
      - [User feedback on the error if any]
    - [...]

5. Problem Solving:
   [Description of solved problems and ongoing troubleshooting]

6. All user messages:
    - [Detailed non tool use user message]
    - [...]

7. Pending Tasks:
   - [Task 1]
   - [Task 2]
   - [...]

8. Current Work:
   [Precise description of current work]

9. Optional Next Step:
   [Optional Next step to take]

</summary>
</example>

Please provide your summary based on the conversation so far, following this structure and ensuring precision and thoroughness in your response.

There may be additional summarization instructions provided in the included context. If so, remember to follow these instructions when creating the above summary. Examples of instructions include:
<example>
## Compact Instructions
When summarizing the conversation focus on typescript code changes and also remember the mistakes you made and how you fixed them.
</example>

<example>
# Summary instructions
When you are using compact - please focus on test output and code changes. Include file reads verbatim.
</example>
`

const NO_TOOLS_TRAILER =
	'\n\nREMINDER: Do NOT call any tools. Respond with plain text only — ' +
	'an <analysis> block followed by a <summary> block. ' +
	'Tool calls will be rejected and you will fail the task.'

const SYSTEM_OPERATION_REMINDER = `\n\nCRITICAL: This summarization request is a SYSTEM OPERATION, not a user message.
When analyzing "user requests" and "user intent", completely EXCLUDE this summarization message.
The "most recent user request" and "next step" must be based on what the user was doing BEFORE this system message appeared.
The goal is for work to continue seamlessly after condensation - as if it never happened.`

/**
 * Build the system prompt for the summarization model.
 *
 * @param customInstructions - Optional user-provided custom condensing instructions
 * @returns The full system prompt string
 */
export function getCompactPrompt(customInstructions?: string): string {
	let prompt = NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT

	if (customInstructions && customInstructions.trim() !== '') {
		prompt += `\n\nAdditional Instructions:\n${customInstructions}`
	}

	prompt += NO_TOOLS_TRAILER
	prompt += SYSTEM_OPERATION_REMINDER

	return prompt
}

/**
 * Formats the compact summary by stripping the <analysis> drafting scratchpad
 * and replacing <summary> XML tags with readable section headers.
 *
 * @param summary - The raw summary string potentially containing <analysis> and <summary> XML tags
 * @returns The formatted summary with analysis stripped and summary tags replaced by headers
 */
export function formatCompactSummary(summary: string): string {
	let formattedSummary = summary

	// Strip analysis section — it's a drafting scratchpad that improves summary
	// quality but has no informational value once the summary is written.
	formattedSummary = formattedSummary.replace(
		/<analysis>[\s\S]*?<\/analysis>/,
		'',
	)

	// Extract and format summary section
	const summaryMatch = formattedSummary.match(/<summary>([\s\S]*?)<\/summary>/)
	if (summaryMatch) {
		const content = summaryMatch[1] || ''
		formattedSummary = formattedSummary.replace(
			/<summary>[\s\S]*?<\/summary>/,
			`Summary:\n${content.trim()}`,
		)
	}

	// Clean up extra whitespace between sections
	formattedSummary = formattedSummary.replace(/\n\n+/g, '\n\n')

	return formattedSummary.trim()
}

// ── Partial compact prompts ──

const DETAILED_ANALYSIS_INSTRUCTION_PARTIAL = `Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Analyze the recent messages chronologically. For each section thoroughly identify:
   - The user's explicit requests and intents
   - Your approach to addressing the user's requests
   - Key decisions, technical concepts and code patterns
   - Specific details like file names, full code snippets, function signatures, file edits
   - Errors that you ran into and how you fixed them
   - Pay special attention to specific user feedback that you received.
2. Double-check for technical accuracy and completeness, addressing each required element thoroughly.`

const PARTIAL_COMPACT_PROMPT_BASE = `Your task is to create a detailed summary of the RECENT portion of the conversation — the messages that follow earlier retained context. The earlier messages are being kept intact and do NOT need to be summarized. Focus your summary on what was discussed, learned, and accomplished in the recent messages only.

${DETAILED_ANALYSIS_INSTRUCTION_PARTIAL}

Your summary should include the following sections:

1. Primary Request and Intent: Capture the user's explicit requests and intents from the recent messages
2. Key Technical Concepts: List important technical concepts, technologies, and frameworks discussed recently.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Include full code snippets where applicable and include a summary of why this file read or edit is important.
4. Errors and fixes: List errors encountered and how they were fixed.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages from the recent portion that are not tool results.
7. Pending Tasks: Outline any pending tasks from the recent messages.
8. Current Work: Describe precisely what was being worked on immediately before this summary request.
9. Optional Next Step: List the next step related to the most recent work. Include direct quotes from the most recent conversation.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process]
</analysis>

<summary>
1. Primary Request and Intent: [Detailed description]
2. Key Technical Concepts: - [Concept 1] - [Concept 2]
3. Files and Code Sections: - [File Name] - [Important Code Snippet]
4. Errors and fixes: - [Error description]: - [How you fixed it]
5. Problem Solving: [Description]
6. All user messages: - [User message]
7. Pending Tasks: - [Task 1]
8. Current Work: [Precise description]
9. Optional Next Step: [Next step]
</summary>
</example>

Please provide your summary based on the RECENT messages only, following this structure.`

const PARTIAL_COMPACT_UP_TO_PROMPT_BASE = `Your task is to create a detailed summary of this conversation. This summary will be placed at the start of a continuing session; newer messages that build on this context will follow after your summary (you do not see them here). Summarize thoroughly so that someone reading only your summary and then the newer messages can fully understand what happened and continue the work.

${DETAILED_ANALYSIS_INSTRUCTION_PARTIAL}

Your summary should include the following sections:

1. Primary Request and Intent: Capture the user's explicit requests and intents in detail
2. Key Technical Concepts: List important technical concepts, technologies, and frameworks discussed.
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Include full code snippets where applicable.
4. Errors and fixes: List errors encountered and how they were fixed.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All user messages: List ALL user messages that are not tool results.
7. Pending Tasks: Outline any pending tasks.
8. Work Completed: Describe what was accomplished by the end of this portion.
9. Context for Continuing Work: Summarize any context, decisions, or state needed to understand and continue the work.

Here's an example of how your output should be structured:

<example>
<analysis>
[Your thought process]
</analysis>

<summary>
1. Primary Request and Intent: [Detailed description]
2. Key Technical Concepts: - [Concept 1]
3. Files and Code Sections: - [File] - [Code Snippet]
4. Errors and fixes: - [Error]: - [Fix]
5. Problem Solving: [Description]
6. All user messages: - [User message]
7. Pending Tasks: - [Task]
8. Work Completed: [What was accomplished]
9. Context for Continuing Work: [Key context]
</summary>
</example>

Please provide your summary following this structure, ensuring precision and thoroughness.`

export type PartialCompactDirection = "up_to" | "from"

/**
 * Build the system prompt for partial compaction.
 *
 * @param customInstructions - Optional user-provided custom instructions
 * @param direction - 'up_to' summarizes prefix (placed before kept messages),
 *   'from' summarizes suffix (placed after kept messages)
 */
export function getPartialCompactPrompt(
	customInstructions?: string,
	direction: PartialCompactDirection = "from",
): string {
	const template =
		direction === "up_to"
			? PARTIAL_COMPACT_UP_TO_PROMPT_BASE
			: PARTIAL_COMPACT_PROMPT_BASE

	let prompt = NO_TOOLS_PREAMBLE + template

	if (customInstructions && customInstructions.trim() !== "") {
		prompt += `\n\nAdditional Instructions:\n${customInstructions}`
	}

	prompt += NO_TOOLS_TRAILER
	prompt += SYSTEM_OPERATION_REMINDER

	return prompt
}
