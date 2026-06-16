import { createContext, useContext, createSignal, For, type ParentProps } from "solid-js"
import { useTheme } from "./theme.tsx"

export interface Toast {
	id: string
	message: string
	type?: "info" | "success" | "warning" | "error"
}

interface ToastContextValue {
	toasts: () => Toast[]
	show: (message: string, type?: Toast["type"]) => void
	dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue>()

export function ToastProvider(props: ParentProps) {
	const [toasts, setToasts] = createSignal<Toast[]>([])

	function show(message: string, type: Toast["type"] = "info") {
		const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
		setToasts((prev) => [...prev, { id, message, type }])
		setTimeout(() => dismiss(id), 3000)
	}

	function dismiss(id: string) {
		setToasts((prev) => prev.filter((t) => t.id !== id))
	}

	return (
		<ToastContext.Provider value={{ toasts, show, dismiss }}>
			{props.children}
			<ToastContainer />
		</ToastContext.Provider>
	)
}

export function useToast(): ToastContextValue {
	const ctx = useContext(ToastContext)
	if (!ctx) {
		throw new Error("useToast must be used within a ToastProvider")
	}
	return ctx
}

function ToastContainer() {
	const { theme } = useTheme()
	const { toasts, dismiss } = useToast()

	const colorFor = (type: Toast["type"]) => {
		switch (type) {
			case "success":
				return theme.colors.success
			case "warning":
				return theme.colors.warning
			case "error":
				return theme.colors.error
			default:
				return theme.colors.primary
		}
	}

	return (
		<box flexDirection="column" position="absolute" bottom={1} right={1} width={40} gap={1}>
			<For each={toasts()}>
				{(toast) => (
					<box
						flexDirection="row"
						paddingLeft={1}
						paddingRight={1}
						paddingTop={1}
						paddingBottom={1}
						border={true}
						borderColor={colorFor(toast.type)}
						backgroundColor={theme.colors.backgroundElement}
						onClick={() => dismiss(toast.id)}>
						<text color={colorFor(toast.type)} bold>
							{toast.type === "error" ? "✖" : toast.type === "success" ? "✓" : "ℹ"}
						</text>
						<text color={theme.colors.text}> {toast.message}</text>
					</box>
				)}
			</For>
		</box>
	)
}
