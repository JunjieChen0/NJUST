/**
 * TUI 诊断脚本
 * 检查为什么显示 Session 而不是 Home
 */

async function diagnose() {
	console.log("=== TUI 诊断 ===")

	// 检查 Bun 是否可用
	const fs = await import("fs")
	const path = await import("path")

	const bunPath = process.platform === "win32" ? "bun.exe" : "bun"

	console.log("Bun 路径:", bunPath)
	console.log("Bun 存在:", fs.existsSync(bunPath))

	// 检查 OpenTUI 包
	try {
		const opentuiPkg = require.resolve("@opentui/solid/package.json", { paths: [__dirname] })
		console.log("OpenTUI 包:", opentuiPkg)
	} catch {
		console.log("OpenTUI 包: 未找到")
	}

	// 检查入口文件
	const subprocessPath = path.join(__dirname, "subprocess.tsx")
	console.log("Subprocess 路径:", subprocessPath)
	console.log("Subprocess 存在:", fs.existsSync(subprocessPath))

	console.log("\n=== 环境变量 ===")
	console.log("NJUST_AI_TUI_ENGINE:", process.env.NJUST_AI_TUI_ENGINE || "未设置 (默认 opentui)")
	console.log("NODE_ENV:", process.env.NODE_ENV || "未设置")

	console.log("\n=== 建议 ===")
	console.log("1. 确保使用 Bun 运行: bun run src/index.ts")
	console.log('2. 设置环境变量: $env:NJUST_AI_TUI_ENGINE="opentui"')
	console.log("3. 检查是否有编译缓存: rm -rf dist")
}

diagnose().catch(console.error)
