import type OpenAI from "openai"

const NOTEBOOK_EDIT_DESCRIPTION = `Edit Jupyter notebook (.ipynb) files by inserting, editing, or deleting cells. Use this tool to manipulate notebook cells programmatically.

Parameters:
- path: (required) The path to the notebook file (.ipynb)
- action: (required) The action to perform: "insert" (add a new cell), "edit" (modify an existing cell), or "delete" (remove a cell)
- cellIndex: (required) The zero-based index of the cell to operate on. For insert, this is the position where the new cell will be inserted.
- content: (required for insert and edit) The content of the cell
- cellType: (optional, default: "code") The type of cell: "code" or "markdown"

Example: Insert a code cell at the beginning
{ "path": "notebook.ipynb", "action": "insert", "cellIndex": 0, "content": "import pandas as pd\\ndf = pd.read_csv('data.csv')", "cellType": "code" }

Example: Edit an existing cell
{ "path": "notebook.ipynb", "action": "edit", "cellIndex": 2, "content": "# Updated Analysis\\nresults = model.fit(X, y)" }

Example: Delete a cell
{ "path": "notebook.ipynb", "action": "delete", "cellIndex": 3 }`

const PATH_DESCRIPTION = `Path to the Jupyter notebook file (.ipynb)`

const ACTION_DESCRIPTION = `Action to perform on the notebook cell: "insert" to add a new cell, "edit" to modify an existing cell, or "delete" to remove a cell`

const CELL_INDEX_DESCRIPTION = `Zero-based index of the cell. For insert, this is the position where the new cell will be placed`

const CONTENT_DESCRIPTION = `The content of the cell. Required for insert and edit actions`

const CELL_TYPE_DESCRIPTION = `Type of the notebook cell: "code" for executable code cells, "markdown" for documentation cells. Defaults to "code"`

export default {
	type: "function",
	function: {
		name: "notebook_edit",
		description: NOTEBOOK_EDIT_DESCRIPTION,
		strict: false,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: PATH_DESCRIPTION,
				},
				action: {
					type: "string",
					enum: ["insert", "edit", "delete"],
					description: ACTION_DESCRIPTION,
				},
				cellIndex: {
					type: "number",
					description: CELL_INDEX_DESCRIPTION,
				},
				content: {
					type: "string",
					description: CONTENT_DESCRIPTION,
				},
				cellType: {
					type: "string",
					enum: ["code", "markdown"],
					description: CELL_TYPE_DESCRIPTION,
				},
			},
			required: ["path", "action", "cellIndex"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
