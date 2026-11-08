import { build } from "esbuild"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"

it("preserves the ignored-ask control signal after production minification", async () => {
	const source = fileURLToPath(new URL("../AskIgnoredError.ts", import.meta.url))
	const helper = fileURLToPath(new URL("../../../utils/errorHandling.ts", import.meta.url))
	const result = await build({
		stdin: {
			contents: `import { AskIgnoredError } from ${JSON.stringify(source)};
import { ignoreAbortError } from ${JSON.stringify(helper)};
export const error = new AskIgnoredError("new partial");
export const ignore = () => ignoreAbortError(error);`,
			resolveDir: fileURLToPath(new URL(".", import.meta.url)),
		},
		alias: {
			"@njust-ai/core/shared": fileURLToPath(
				new URL("../../../../packages/types/src/NamedError.ts", import.meta.url),
			),
		},
		bundle: true,
		minify: true,
		platform: "node",
		format: "cjs",
		write: false,
	})
	const module = { exports: {} as { error: Error; ignore: () => void } }
	new Function("module", result.outputFiles[0]!.text)(module)
	expect(module.exports.error.name).toBe("AskIgnoredError")
	expect(module.exports.ignore).not.toThrow()
})
