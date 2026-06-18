import { useMemo, useState, useEffect } from "react"
import { Box, Text, useInput } from "ink"

import {
	loadModelStore,
	pushRecent,
	saveModelStore,
	toggleFavorite,
	PROVIDER_MODELS,
	PROVIDER_LABELS,
	PROVIDER_PRIORITY,
	type ModelRef,
} from "@/lib/storage/local-model-store.js"
import { providerNames } from "@njust-ai/types"

import { useTheme } from "../theme.js"
import { useDialog } from "../dialog/DialogProvider.js"

interface ModelOption {
	providerID: string
	modelID: string
	label: string
	category: string
	isFavorite?: boolean
}

function buildOptions(
	recent: ModelRef[],
	favorite: ModelRef[],
	current: ModelRef | null,
): ModelOption[] {
	const options: ModelOption[] = []
	const seen = new Set<string>()

	function addOption(ref: ModelRef, category: string, isFavorite?: boolean) {
		const key = `${ref.providerID}/${ref.modelID}`
		if (seen.has(key)) return
		seen.add(key)
		const providerLabel = PROVIDER_LABELS[ref.providerID] ?? ref.providerID
		options.push({
			providerID: ref.providerID,
			modelID: ref.modelID,
			label: `${ref.modelID}  (${providerLabel})`,
			category,
			isFavorite,
		})
	}

	// Favorites section
	for (const ref of favorite) {
		addOption(ref, "Favorites", true)
	}

	// Recent section (exclude favorites)
	for (const ref of recent) {
		if (favorite.some((f) => f.providerID === ref.providerID && f.modelID === ref.modelID)) continue
		addOption(ref, "Recent")
	}

	// All providers section — show ALL models per provider
	const sortedProviders = [...providerNames].sort((a, b) => {
		const pa = PROVIDER_PRIORITY[a] ?? 99
		const pb = PROVIDER_PRIORITY[b] ?? 99
		if (pa !== pb) return pa - pb
		const la = PROVIDER_LABELS[a] ?? a
		const lb = PROVIDER_LABELS[b] ?? b
		return la.localeCompare(lb)
	})

	for (const provider of sortedProviders) {
		const models = PROVIDER_MODELS[provider]
		if (!models || models.length === 0) continue
		const providerLabel = PROVIDER_LABELS[provider] ?? provider
		for (const modelID of models) {
			addOption({ providerID: provider, modelID }, providerLabel)
		}
	}

	return options
}

interface DialogModelProps {
	currentProvider?: string
	currentModel?: string
	onSelect?: (providerID: string, modelID: string) => void
}

export function DialogModel({ currentProvider, currentModel, onSelect }: DialogModelProps) {
	const theme = useTheme()
	const dialog = useDialog()
	const [data, setData] = useState({
		recent: [] as ModelRef[],
		favorite: [] as ModelRef[],
		loaded: false,
	})
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [filter, setFilter] = useState("")

	useEffect(() => {
		loadModelStore().then((store) => {
			setData({ recent: store.recent, favorite: store.favorite, loaded: true })
		})
	}, [])

	const currentRef = useMemo<ModelRef | null>(() => {
		if (!currentProvider || !currentModel) return null
		return { providerID: currentProvider, modelID: currentModel }
	}, [currentProvider, currentModel])

	const allOptions = useMemo(
		() => buildOptions(data.recent, data.favorite, currentRef),
		[data.recent, data.favorite, currentRef],
	)

	const filteredOptions = useMemo(() => {
		const needle = filter.trim().toLowerCase()
		if (!needle) return allOptions
		return allOptions.filter((opt) =>
			opt.label.toLowerCase().includes(needle),
		)
	}, [allOptions, filter])

	useInput(
		(input, key) => {
			if (key.escape) {
				dialog.pop()
				return
			}

			if (key.upArrow) {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1))
				return
			}

			if (key.downArrow) {
				setSelectedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0))
				return
			}

			if (key.return) {
				const selected = filteredOptions[selectedIndex]
				if (!selected) return
				void (async () => {
					const store = await loadModelStore()
					const newRecent = pushRecent(store.recent, {
						providerID: selected.providerID,
						modelID: selected.modelID,
					})
					await saveModelStore({
						recent: newRecent,
						favorite: store.favorite,
						variant: store.variant,
					})
					onSelect?.(selected.providerID, selected.modelID)
					dialog.pop()
				})()
				return
			}

			if (input === "f" || input === "F") {
				const selected = filteredOptions[selectedIndex]
				if (!selected) return
				void (async () => {
					const store = await loadModelStore()
					const newFavorite = toggleFavorite(store.favorite, {
						providerID: selected.providerID,
						modelID: selected.modelID,
					})
					await saveModelStore({
						recent: store.recent,
						favorite: newFavorite,
						variant: store.variant,
					})
					setData((prev) => ({ ...prev, favorite: newFavorite }))
				})()
				return
			}

			if (key.backspace || key.delete) {
				setFilter((prev) => prev.slice(0, -1))
				setSelectedIndex(0)
				return
			}

			if (!key.ctrl && !key.meta && input.length === 1) {
				setFilter((prev) => prev + input)
				setSelectedIndex(0)
			}
		},
		{ isActive: true },
	)

	if (!data.loaded) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color={theme.dimText}>Loading models...</Text>
			</Box>
		)
	}

	if (filteredOptions.length === 0) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color={theme.dimText}>No models match "{filter}"</Text>
				<Text color={theme.dimText}>Esc to close</Text>
			</Box>
		)
	}

	// Scroll window: keep selected item visible within a fixed-size viewport.
	const viewportSize = 14
	const scrollOffset = Math.max(0, Math.min(selectedIndex, filteredOptions.length - viewportSize))
	const visibleOptions = filteredOptions.slice(scrollOffset, scrollOffset + viewportSize)
	let lastCategory = ""

	return (
		<Box flexDirection="column" paddingLeft={1} paddingRight={1}>
			<Box flexDirection="row" justifyContent="space-between">
				<Text color={theme.text} bold>
					Select model
				</Text>
				<Text color={theme.dimText}>esc</Text>
			</Box>
			{filter && (
				<Box marginTop={1}>
					<Text color={theme.dimText}>Search: {filter}</Text>
				</Box>
			)}
			<Box flexDirection="column" marginTop={1}>
				{visibleOptions.map((opt, index) => {
					const actualIndex = scrollOffset + index
					const isSelected = actualIndex === selectedIndex
					const isCurrent =
						currentRef?.providerID === opt.providerID && currentRef?.modelID === opt.modelID
					const showCategory = opt.category !== lastCategory
					lastCategory = opt.category

					return (
						<Box key={`${opt.providerID}-${opt.modelID}`} flexDirection="column">
							{showCategory && (
								<Box marginTop={1}>
									<Text color={theme.accent} bold>
										{opt.category}
									</Text>
								</Box>
							)}
							<Box>
								<Text color={isSelected ? "cyan" : theme.dimText}>
									{isSelected ? "> " : "  "}
									{isCurrent ? "● " : "  "}
									{opt.label}
									{opt.isFavorite && <Text color={theme.warningColor}> ★</Text>}
								</Text>
							</Box>
						</Box>
					)
				})}
			</Box>
			{filteredOptions.length > viewportSize && (
				<Box flexDirection="row" justifyContent="space-between" marginTop={1}>
					<Text color={theme.dimText}>
						{scrollOffset + 1}-{Math.min(scrollOffset + viewportSize, filteredOptions.length)} of {filteredOptions.length}
					</Text>
					{scrollOffset + viewportSize < filteredOptions.length && (
						<Text color={theme.dimText}>↓ more</Text>
					)}
				</Box>
			)}
			<Box flexDirection="row" justifyContent="space-between" marginTop={1}>
				<Text color={theme.dimText}>↑↓ navigate • Enter select • f favorite</Text>
				<Text color={theme.dimText}>Esc close</Text>
			</Box>
		</Box>
	)
}
