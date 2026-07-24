/**
 * Docker Policy Proxy — Lightweight Logger
 *
 * Minimal structured logger for the standalone Docker policy proxy.
 * Avoids external dependencies so the proxy container stays lightweight.
 */

type LogLevel = "debug" | "info" | "warn" | "error"

const LOG_LEVELS: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
}

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info"

function shouldLog(level: LogLevel): boolean {
	return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]
}

function formatMessage(level: LogLevel, scope: string, message: string, data?: unknown): string {
	const timestamp = new Date().toISOString()
	const base = `[${timestamp}] [${level.toUpperCase()}] [${scope}] ${message}`
	if (data !== undefined) {
		return `${base} ${JSON.stringify(data)}`
	}
	return base
}

export const logger = {
	debug(scope: string, message: string, data?: unknown): void {
		if (shouldLog("debug")) console.debug(formatMessage("debug", scope, message, data))
	},
	info(scope: string, message: string, data?: unknown): void {
		if (shouldLog("info")) console.info(formatMessage("info", scope, message, data))
	},
	warn(scope: string, message: string, data?: unknown): void {
		if (shouldLog("warn")) console.warn(formatMessage("warn", scope, message, data))
	},
	error(scope: string, message: string, data?: unknown): void {
		if (shouldLog("error")) console.error(formatMessage("error", scope, message, data))
	},
}
