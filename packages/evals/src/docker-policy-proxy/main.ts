/**
 * Docker Policy Proxy — Standalone Entry Point
 *
 * Reads configuration from environment variables and starts the proxy server.
 * This is the main entry point for the docker-proxy container.
 */

import { DockerPolicyProxy } from "./server"
import { DEFAULT_POLICY } from "./policy"

const port = parseInt(process.env.PROXY_PORT ?? "2375", 10)
const dockerEndpoint = process.env.DOCKER_ENDPOINT ?? "unix:///var/run/docker.sock"
const authToken = process.env.PROXY_AUTH_TOKEN

async function main(): Promise<void> {
	// Fail-closed: require auth token at startup
	if (!authToken) {
		console.error("[docker-policy-proxy] FATAL: PROXY_AUTH_TOKEN is not set.")
		console.error("[docker-policy-proxy] The proxy will not start without authentication.")
		console.error("[docker-policy-proxy] Set PROXY_AUTH_TOKEN in your environment or docker-compose.yml.")
		process.exit(1)
	}

	const proxy = new DockerPolicyProxy({
		port,
		bindAddress: "0.0.0.0",
		dockerEndpoint,
		policy: DEFAULT_POLICY,
		authToken,
	})

	console.log(`[docker-policy-proxy] Starting on port ${port}`)
	console.log(`[docker-policy-proxy] Docker endpoint: ${dockerEndpoint}`)
	console.log(`[docker-policy-proxy] Auth: enabled`)
	console.log(`[docker-policy-proxy] Policy:`)
	console.log(`  Allowed images: ${DEFAULT_POLICY.allowedImages.join(", ")}`)
	console.log(`  Allowed volume sources: ${DEFAULT_POLICY.allowedVolumeSources.join(", ")}`)
	console.log(`  Allowed networks: ${DEFAULT_POLICY.allowedNetworks.join(", ")}`)
	console.log(`  Required name prefix: ${DEFAULT_POLICY.requiredNamePrefix}`)
	console.log(`  Max memory: ${DEFAULT_POLICY.maxMemoryBytes / 1024 / 1024}MB`)

	await proxy.start()
	console.log(`[docker-policy-proxy] Listening on 0.0.0.0:${port}`)

	// Graceful shutdown
	const shutdown = async (signal: string): Promise<void> => {
		console.log(`[docker-policy-proxy] Received ${signal}, shutting down...`)
		await proxy.stop()
		process.exit(0)
	}

	process.on("SIGTERM", () => void shutdown("SIGTERM"))
	process.on("SIGINT", () => void shutdown("SIGINT"))
}

main().catch((error) => {
	console.error("[docker-policy-proxy] Fatal error:", error)
	process.exit(1)
})
