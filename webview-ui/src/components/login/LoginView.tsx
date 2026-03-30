import { useState, useCallback, type FormEvent, type KeyboardEvent } from "react"

interface LoginViewProps {
	onLoginSuccess: () => void
}

const VALID_USERNAME = "NJUST"
const VALID_PASSWORD = "@Njust123456"

const getLogoUrl = () => {
	const base = (window as unknown as { IMAGES_BASE_URI?: string }).IMAGES_BASE_URI || ""
	return `${base}/icon.png`
}

const LoginView = ({ onLoginSuccess }: LoginViewProps) => {
	const [username, setUsername] = useState("")
	const [password, setPassword] = useState("")
	const [error, setError] = useState("")
	const [isShaking, setIsShaking] = useState(false)

	const handleSubmit = useCallback(
		(e?: FormEvent) => {
			e?.preventDefault()
			if (username === VALID_USERNAME && password === VALID_PASSWORD) {
				setError("")
				onLoginSuccess()
			} else {
				setError("Invalid username or password")
				setIsShaking(true)
				setTimeout(() => setIsShaking(false), 500)
			}
		},
		[username, password, onLoginSuccess],
	)

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Enter") {
				handleSubmit()
			}
		},
		[handleSubmit],
	)

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 99999,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: "var(--vscode-editor-background)",
				color: "var(--vscode-editor-foreground)",
				fontFamily: "var(--vscode-font-family)",
			}}>
			<div
				style={{
					width: "100%",
					maxWidth: 340,
					padding: "32px 24px",
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: 20,
					animation: isShaking ? "login-shake 0.5s ease-in-out" : undefined,
				}}>
				<img
					src={getLogoUrl()}
					alt="NJUST"
					style={{
						width: 64,
						height: 64,
						borderRadius: "50%",
						objectFit: "cover",
					}}
				/>

				<div style={{ textAlign: "left", width: "100%" }}>
					<h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>NJUST AI Cangjie Assistant</h2>
					<p
						style={{
							margin: "8px 0 0",
							fontSize: 13,
							color: "var(--vscode-foreground)",
							lineHeight: 1.6,
						}}>
						Your intelligent Cangjie language development companion — powered by AI, built for the full
						Cangjie toolchain.
					</p>
					<div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
						<div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--vscode-descriptionForeground)" }}>
							<span style={{ color: "var(--vscode-foreground)" }}>&#x2713;</span>
							<span>LSP auto-completion, go-to-definition, diagnostics</span>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--vscode-descriptionForeground)" }}>
							<span style={{ color: "var(--vscode-foreground)" }}>&#x2713;</span>
							<span>Integrated cjpm build, cjfmt format, cjlint check</span>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--vscode-descriptionForeground)" }}>
							<span style={{ color: "var(--vscode-foreground)" }}>&#x2713;</span>
							<span>AI-assisted coding, error fixing, and code review</span>
						</div>
					</div>
					<p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--vscode-descriptionForeground)" }}>
						Please sign in to continue
					</p>
				</div>

				<form
					onSubmit={handleSubmit}
					style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						<label
							htmlFor="login-username"
							style={{
								fontSize: 12,
								color: "var(--vscode-foreground)",
							}}>
							Username
						</label>
						<input
							id="login-username"
							type="text"
							value={username}
							onChange={(e) => {
								setUsername(e.target.value)
								setError("")
							}}
							onKeyDown={handleKeyDown}
							autoFocus
							placeholder="Enter username"
							style={{
								width: "100%",
								padding: "6px 8px",
								fontSize: 13,
								color: "var(--vscode-input-foreground)",
								backgroundColor: "var(--vscode-input-background)",
								border: "1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent))",
								borderRadius: 4,
								outline: "none",
								boxSizing: "border-box",
							}}
							onFocus={(e) => {
								e.target.style.borderColor = "var(--vscode-focusBorder)"
							}}
							onBlur={(e) => {
								e.target.style.borderColor =
									"var(--vscode-input-border, var(--vscode-widget-border, transparent))"
							}}
						/>
					</div>

					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						<label
							htmlFor="login-password"
							style={{
								fontSize: 12,
								color: "var(--vscode-foreground)",
							}}>
							Password
						</label>
						<input
							id="login-password"
							type="password"
							value={password}
							onChange={(e) => {
								setPassword(e.target.value)
								setError("")
							}}
							onKeyDown={handleKeyDown}
							placeholder="Enter password"
							style={{
								width: "100%",
								padding: "6px 8px",
								fontSize: 13,
								color: "var(--vscode-input-foreground)",
								backgroundColor: "var(--vscode-input-background)",
								border: "1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent))",
								borderRadius: 4,
								outline: "none",
								boxSizing: "border-box",
							}}
							onFocus={(e) => {
								e.target.style.borderColor = "var(--vscode-focusBorder)"
							}}
							onBlur={(e) => {
								e.target.style.borderColor =
									"var(--vscode-input-border, var(--vscode-widget-border, transparent))"
							}}
						/>
					</div>

					{error && (
						<p
							style={{
								margin: 0,
								fontSize: 12,
								color: "var(--vscode-errorForeground)",
								textAlign: "center",
							}}>
							{error}
						</p>
					)}

					<button
						type="submit"
						style={{
							marginTop: 4,
							padding: "8px 16px",
							fontSize: 13,
							fontWeight: 500,
							color: "#ffffff",
							backgroundColor: "#7c3aed",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
							width: "100%",
						}}
						onMouseOver={(e) => {
							e.currentTarget.style.backgroundColor = "#6d28d9"
						}}
						onMouseOut={(e) => {
							e.currentTarget.style.backgroundColor = "#7c3aed"
						}}>
						Sign In
					</button>
				</form>
			</div>

			<style>{`
				@keyframes login-shake {
					0%, 100% { transform: translateX(0); }
					10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
					20%, 40%, 60%, 80% { transform: translateX(4px); }
				}
			`}</style>
		</div>
	)
}

export default LoginView
