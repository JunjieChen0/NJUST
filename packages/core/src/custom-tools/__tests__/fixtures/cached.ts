import { parametersSchema, defineCustomTool } from "@njust-ai-cj/types"

export default defineCustomTool({
	name: "cached",
	description: "Cached tool",
	parameters: parametersSchema.object({}),
	async execute() {
		return "cached"
	},
})
