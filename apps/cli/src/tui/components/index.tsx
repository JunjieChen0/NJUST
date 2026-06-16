/**
 * Base Components - OpenTUI wrappers
 */

import { Dynamic } from "solid-js/web"
import type { Component, JSX, ValidComponent } from "solid-js"
import { useTheme } from "../context/theme.tsx"

export interface OpenTuiMouseEvent {
	x?: number
	y?: number
	button?: number
}

export interface BoxProps {
	children?: JSX.Element
	flexDirection?: "row" | "column"
	flexGrow?: number
	flexShrink?: number
	padding?: number
	paddingLeft?: number
	paddingRight?: number
	paddingTop?: number
	paddingBottom?: number
	margin?: number
	marginLeft?: number
	marginRight?: number
	marginTop?: number
	marginBottom?: number
	border?: boolean | string[]
	borderColor?: string
	backgroundColor?: string
	width?: number | string
	height?: number | string
	minHeight?: number
	maxHeight?: number
	position?: "absolute" | "relative"
	top?: number | string
	left?: number | string
	right?: number | string
	bottom?: number | string
	zIndex?: number
	gap?: number
	justifyContent?: "flex-start" | "flex-end" | "center" | "space-between"
	alignItems?: "flex-start" | "flex-end" | "center" | "stretch"
	wrap?: "wrap" | "nowrap"
	visible?: boolean
	ref?: (el: HTMLElement | undefined) => void
	onMouseDown?: (e: OpenTuiMouseEvent) => void
	onMouseMove?: (e: OpenTuiMouseEvent) => void
	onMouseOver?: (e: OpenTuiMouseEvent) => void
	onMouseUp?: (e: OpenTuiMouseEvent) => void
}

export const Box: Component<BoxProps> = (props) => {
	const { theme } = useTheme()
	return (
		<Dynamic
			component="box"
			ref={props.ref}
			flexDirection={props.flexDirection ?? "column"}
			flexGrow={props.flexGrow}
			flexShrink={props.flexShrink}
			padding={props.padding}
			paddingLeft={props.paddingLeft}
			paddingRight={props.paddingRight}
			paddingTop={props.paddingTop}
			paddingBottom={props.paddingBottom}
			margin={props.margin}
			marginLeft={props.marginLeft}
			marginRight={props.marginRight}
			marginTop={props.marginTop}
			marginBottom={props.marginBottom}
			border={props.border}
			borderColor={props.borderColor ?? theme.colors.border}
			backgroundColor={props.backgroundColor ?? theme.colors.background}
			width={props.width}
			height={props.height}
			minHeight={props.minHeight}
			maxHeight={props.maxHeight}
			position={props.position}
			top={props.top}
			left={props.left}
			right={props.right}
			bottom={props.bottom}
			zIndex={props.zIndex}
			gap={props.gap}
			justifyContent={props.justifyContent}
			alignItems={props.alignItems}
			wrap={props.wrap}
			visible={props.visible}
			onMouseDown={props.onMouseDown}
			onMouseMove={props.onMouseMove}
			onMouseOver={props.onMouseOver}
			onMouseUp={props.onMouseUp}>
			{props.children}
		</Dynamic>
	)
}

export interface TextProps {
	children?: JSX.Element
	color?: string
	fg?: string
	bold?: boolean
	italic?: boolean
	underline?: boolean
	dim?: boolean
	backgroundColor?: string
	wrapMode?: "none" | "word" | "char"
	width?: number | string
	ref?: (el: HTMLElement | undefined) => void
	onClick?: (e: OpenTuiMouseEvent) => void
	onMouseDown?: (e: OpenTuiMouseEvent) => void
	paddingTop?: number
}

export const Text: Component<TextProps> = (props) => {
	const { theme } = useTheme()
	const color = props.color ?? props.fg ?? theme.colors.text
	const attributes = props.bold
		? "bold"
		: props.italic
			? "italic"
			: props.underline
				? "underline"
				: props.dim
					? "dim"
					: undefined
	return (
		<Dynamic
			component={"text" as ValidComponent}
			ref={props.ref}
			fg={color}
			backgroundColor={props.backgroundColor}
			attributes={attributes}
			wrapMode={props.wrapMode}
			width={props.width}
			onClick={props.onClick}
			onMouseDown={props.onMouseDown}
			paddingTop={props.paddingTop}>
			{props.children}
		</Dynamic>
	)
}

export interface ScrollBoxProps {
	children?: JSX.Element
	ref?: (el: HTMLElement | undefined) => void
	stickyScroll?: boolean
	stickyStart?: boolean
	flexGrow?: number
	maxHeight?: number
	backgroundColor?: string
}

export const ScrollBox: Component<ScrollBoxProps> = (props) => {
	const { theme } = useTheme()
	return (
		<Dynamic
			component="scrollbox"
			ref={props.ref}
			stickyScroll={props.stickyScroll ?? true}
			stickyStart={props.stickyStart}
			flexGrow={props.flexGrow ?? 1}
			maxHeight={props.maxHeight}
			backgroundColor={props.backgroundColor ?? theme.colors.background}>
			{props.children}
		</Dynamic>
	)
}

export const Spinner: Component<{ color?: string }> = (props) => {
	const { theme } = useTheme()
	return <Dynamic component="spinner" fg={props.color ?? theme.colors.primary} />
}

export const Markdown: Component<{ children: string; width?: number; flexGrow?: number }> = (props) => {
	return <Dynamic component="markdown" content={props.children} width={props.width} flexGrow={props.flexGrow} />
}

export interface CodeProps {
	children: string
	language?: string
	theme?: string
}

export const Code: Component<CodeProps> = (props) => {
	return (
		<Dynamic
			component={"code" as ValidComponent}
			content={props.children}
			filetype={props.language}
			theme={props.theme}
		/>
	)
}
