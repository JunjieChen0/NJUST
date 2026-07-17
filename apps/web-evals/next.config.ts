import path from "path"
import type { NextConfig } from "next"

const securityHeaders = [
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "X-Frame-Options", value: "DENY" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "X-DNS-Prefetch-Control", value: "off" },
	{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
]

const nextConfig: NextConfig = {
	transpilePackages: ["@njust-ai/types"],
	turbopack: {
		root: path.join(__dirname, "../.."),
	},
	async headers() {
		return [
			{
				source: "/:path*",
				headers: securityHeaders,
			},
		]
	},
}

export default nextConfig
