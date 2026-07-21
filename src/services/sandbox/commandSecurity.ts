import { parse } from "shell-quote"

import { logger } from "../../shared/logger"

/** Detect shell I/O redirection while preserving angle brackets inside quoted arguments. */
export function containsShellIoRedirection(command: string): boolean {
	try {
		return parse(command).some(
			(token) =>
				typeof token === "object" && "op" in token && typeof token.op === "string" && /[<>]/.test(token.op),
		)
	} catch (error) {
		logger.debug("CommandSecurity", "Shell command parsing failed; applying fail-closed redirection check", error)
		return /[<>]/.test(command)
	}
}
