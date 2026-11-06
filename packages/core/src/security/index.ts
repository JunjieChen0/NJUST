export {
	assertSafeOutboundUrl,
	lookupWithAbort,
	guardedFetch,
	assertPublicIp,
	assertHeadersSafe,
	setGuardedFetchProxy,
} from "./networkGuard.js"
export { recordSecurityMetric, startTraceSpan } from "./metrics.js"
export { SECRET_PATTERNS, detectSecretsInContent } from "./secretPatterns.js"
export type { SecretPattern } from "./secretPatterns.js"
