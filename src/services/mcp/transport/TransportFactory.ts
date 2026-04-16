import type { z } from "zod"

import { ServerConfigSchema } from "../McpHub"

/**
 * Transport selection inputs (plan Task 6 — stdio / sse / streamable-http).
 */
export type McpServerConfig = z.infer<typeof ServerConfigSchema>
