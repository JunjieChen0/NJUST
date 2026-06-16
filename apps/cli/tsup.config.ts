import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	target: "node20",
	platform: "node",
	banner: {
		js: "#!/usr/bin/env node",
	},
	// Bundle workspace packages that export TypeScript
	noExternal: ["@njust-ai/core", "@njust-ai/core/cli", "@njust-ai/types", "@njust-ai/vscode-shim"],
	external: [
		// Keep native modules external
		"@anthropic-ai/sdk",
		"@anthropic-ai/bedrock-sdk",
		"@anthropic-ai/vertex-sdk",
		// Keep @vscode/ripgrep external - we bundle the binary separately
		"@vscode/ripgrep",
		// Optional dev dependency of ink - not needed at runtime
		"react-devtools-core",
		// OpenTUI packages - external, loaded by Bun subprocess
		"@opentui/core",
		"@opentui/solid",
		"@opentui/keymap",
		"solid-js",
		// VS Code extension host bundle - loaded dynamically by path, never bundled
		"njust-ai",
	],
	esbuildOptions(options) {
		// Enable JSX for React/Ink components (default UI)
		options.jsx = "automatic"
		options.jsxImportSource = "react"
		// Solid JSX files (src/tui/**) are excluded from this build
		// They are built separately by the Solid build step (Babel pre-compile)
	},
})
