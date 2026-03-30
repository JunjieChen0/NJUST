import type { CSSProperties } from "react"

import { cn } from "@/lib/utils"

/** Hard cap so layout works even if Tailwind utilities are missing from the bundle. */
const toolUseBlockLayoutStyle: CSSProperties = {
	boxSizing: "border-box",
	minWidth: 0,
	maxWidth: "min(100%, 56rem)",
	width: "100%",
}

export const ToolUseBlock = ({
	className,
	style,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		{...props}
		className={cn("overflow-hidden rounded-md p-2 cursor-pointer bg-vscode-editor-background", className)}
		style={{
			...toolUseBlockLayoutStyle,
			...style,
		}}
	/>
)

export const ToolUseBlockHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn("flex font-mono items-center select-none text-sm text-vscode-descriptionForeground", className)}
		{...props}
	/>
)
