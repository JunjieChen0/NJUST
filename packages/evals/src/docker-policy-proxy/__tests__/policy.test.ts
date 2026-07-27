/**
 * Docker Policy Proxy — Policy Engine Tests
 *
 * Tests the policy validation logic for Docker API requests.
 * Covers: privileged containers, socket mounts, namespace access,
 * arbitrary bind mounts, image allowlisting, and method/path filtering.
 */

import { describe, it, expect } from "vitest"

import { validateCreateContainer, validateKillContainer, isMethodAllowed, DEFAULT_POLICY } from "../policy"
import type { DockerCreateContainerRequest, PolicyConfig } from "../types"

describe("Docker Policy Engine", () => {
	describe("validateCreateContainer", () => {
		it("allows valid evals-runner container", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-task-1.0",
				Env: ["HOST_EXECUTION_METHOD=docker", "EVALS_ATTEMPT=0"],
				HostConfig: {
					Binds: ["/tmp/evals:/var/log/evals"],
					NetworkMode: "evals_default",
					Memory: 512 * 1024 * 1024,
					PidsLimit: 200,
					NanoCpus: 1e9,
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(true)
		})

		it("rejects privileged containers", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					Privileged: true,
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Privileged")
		})

		it("rejects Docker socket mounts", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					Binds: ["/var/run/docker.sock:/var/run/docker.sock"],
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Volume bind")
		})

		it("rejects nested socket mounts (escape attempt)", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					Binds: ["/var/run/docker.sock:/tmp/fake.sock"],
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Volume bind")
		})

		it("rejects arbitrary bind mounts outside allowed sources", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					Binds: ["/etc/passwd:/etc/passwd:ro"],
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Volume bind")
		})

		it("rejects host PID namespace", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					PidMode: "host",
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("PID namespace")
		})

		it("rejects host IPC namespace", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					IpcMode: "host",
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("IPC namespace")
		})

		it("rejects any capabilities in CapAdd", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					CapAdd: ["SYS_ADMIN"],
					Memory: 512 * 1024 * 1024,
					PidsLimit: 200,
					NanoCpus: 1e9,
					NetworkMode: "evals_default",
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Capabilities are not allowed")
		})

		it("rejects SYS_MODULE capability", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					CapAdd: ["SYS_MODULE"],
					Memory: 512 * 1024 * 1024,
					PidsLimit: 200,
					NanoCpus: 1e9,
					NetworkMode: "evals_default",
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Capabilities are not allowed")
		})

		it("rejects SecurityOpt seccomp=unconfined", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					SecurityOpt: ["seccomp=unconfined"],
					Memory: 512 * 1024 * 1024,
					PidsLimit: 200,
					NanoCpus: 1e9,
					NetworkMode: "evals_default",
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("SecurityOpt is not allowed")
		})

		it("rejects SecurityOpt apparmor=unconfined", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					SecurityOpt: ["apparmor=unconfined"],
					Memory: 512 * 1024 * 1024,
					PidsLimit: 200,
					NanoCpus: 1e9,
					NetworkMode: "evals_default",
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("SecurityOpt is not allowed")
		})

		it("rejects SecurityOpt label=disable (SELinux isolation bypass)", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					SecurityOpt: ["label=disable"],
					Memory: 512 * 1024 * 1024,
					PidsLimit: 200,
					NanoCpus: 1e9,
					NetworkMode: "evals_default",
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("SecurityOpt is not allowed")
		})

		it("rejects containers without NetworkMode", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					Memory: 512 * 1024 * 1024,
					PidsLimit: 200,
					NanoCpus: 1e9,
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("NetworkMode is required")
		})

		it("rejects unauthorized images", () => {
			const req: DockerCreateContainerRequest = {
				Image: "malicious-image:latest",
				Name: "evals-test",
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Image")
		})

		it("rejects containers without required name prefix", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "malicious-container",
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("must start with")
		})

		it("rejects unauthorized networks", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					NetworkMode: "host",
					Memory: 512 * 1024 * 1024,
					PidsLimit: 200,
					NanoCpus: 1e9,
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Network")
		})

		it("rejects unauthorized environment variables", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				Env: ["MALICIOUS_VAR=secret"],
				HostConfig: { Memory: 512 * 1024 * 1024, PidsLimit: 200, NanoCpus: 1e9, NetworkMode: "evals_default" },
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Environment variable")
		})

		it("rejects excessive memory limits", () => {
			const customPolicy: PolicyConfig = {
				...DEFAULT_POLICY,
				maxMemoryBytes: 1024 * 1024 * 1024, // 1GB
			}

			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					Memory: 2 * 1024 * 1024 * 1024, // 2GB
				},
			}

			const decision = validateCreateContainer(req, customPolicy)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Memory")
		})

		it("rejects device access", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					Devices: [{ PathOnHost: "/dev/sda" }],
					Memory: 512 * 1024 * 1024,
					PidsLimit: 200,
					NanoCpus: 1e9,
					NetworkMode: "evals_default",
				},
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Device access")
		})

		it("allows image with tag suffix", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner:v1.0.0",
				Name: "evals-test",
				HostConfig: { Memory: 512 * 1024 * 1024, PidsLimit: 200, NanoCpus: 1e9, NetworkMode: "evals_default" },
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(true)
		})

		it("rejects subdirectory of allowed volume source (exact match only)", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					Binds: ["/tmp/evals/runs/1:/var/log/evals"],
					Memory: 512 * 1024 * 1024,
					PidsLimit: 200,
					NanoCpus: 1e9,
				},
			}
			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Volume bind")
		})

		it("rejects containers without HostConfig", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
			}
			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("HostConfig is required")
		})

		it("rejects containers without PidsLimit", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: { Memory: 512 * 1024 * 1024, NanoCpus: 1e9 },
			}
			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("PidsLimit")
		})

		it("rejects containers without NanoCpus", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: { Memory: 512 * 1024 * 1024, PidsLimit: 200 },
			}
			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("NanoCpus")
		})

		it("rejects MemorySwap=-1 (unlimited swap)", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: { Memory: 512 * 1024 * 1024, MemorySwap: -1, PidsLimit: 200, NanoCpus: 1e9 },
			}
			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("unlimited swap")
		})

		it("rejects PidsLimit=-1 (unlimited)", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: { Memory: 512 * 1024 * 1024, PidsLimit: -1, NanoCpus: 1e9 },
			}
			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("PidsLimit")
		})

		it("rejects named volumes in Mounts", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-test",
				HostConfig: {
					Memory: 512 * 1024 * 1024,
					PidsLimit: 200,
					NanoCpus: 1e9,
					Mounts: [{ Type: "volume", Source: "sensitive-db", Target: "/data" }],
				},
			}
			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Named volumes")
		})
	})

	describe("validateKillContainer", () => {
		it("allows valid kill request with SIGTERM", () => {
			const decision = validateKillContainer("evals-task-1", { Signal: "SIGTERM" })
			expect(decision.allowed).toBe(true)
		})

		it("allows kill request without signal (defaults to SIGKILL)", () => {
			const decision = validateKillContainer("evals-task-1", {})
			expect(decision.allowed).toBe(true)
		})

		it("rejects invalid signals", () => {
			const decision = validateKillContainer("evals-task-1", { Signal: "SIGQUIT" })
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("Signal")
		})

		it("allows SIGKILL", () => {
			const decision = validateKillContainer("evals-task-1", { Signal: "SIGKILL" })
			expect(decision.allowed).toBe(true)
		})
	})

	describe("isMethodAllowed", () => {
		it("allows container creation", () => {
			expect(isMethodAllowed("POST", "/containers/create")).toBe(true)
			expect(isMethodAllowed("POST", "/v1.41/containers/create")).toBe(true)
		})

		it("allows container start/stop/kill", () => {
			expect(isMethodAllowed("POST", "/containers/abc123/start")).toBe(true)
			expect(isMethodAllowed("POST", "/containers/abc123/stop")).toBe(true)
			expect(isMethodAllowed("POST", "/containers/abc123/kill")).toBe(true)
		})

		it("allows container wait and resize (docker run)", () => {
			expect(isMethodAllowed("POST", "/containers/abc123/wait")).toBe(true)
			expect(isMethodAllowed("POST", "/containers/abc123/resize")).toBe(true)
			expect(isMethodAllowed("POST", "/v1.41/containers/abc123/wait")).toBe(true)
		})

		it("allows container attach (docker run -it)", () => {
			expect(isMethodAllowed("POST", "/containers/abc123/attach")).toBe(true)
			expect(isMethodAllowed("POST", "/containers/abc123/attach?stream=1&stdin=1")).toBe(true)
		})

		it("allows container exec creation", () => {
			expect(isMethodAllowed("POST", "/containers/abc123/exec")).toBe(true)
		})

		it("allows exec instance operations", () => {
			expect(isMethodAllowed("POST", "/exec/exec123/start")).toBe(true)
			expect(isMethodAllowed("POST", "/exec/exec123/resize")).toBe(true)
			expect(isMethodAllowed("GET", "/exec/exec123/json")).toBe(true)
		})

		it("allows container listing and inspection", () => {
			expect(isMethodAllowed("GET", "/containers/json")).toBe(true)
			expect(isMethodAllowed("GET", "/containers/abc123/json")).toBe(true)
		})

		it("allows container logs", () => {
			expect(isMethodAllowed("GET", "/containers/abc123/logs")).toBe(true)
		})

		it("allows container removal", () => {
			expect(isMethodAllowed("DELETE", "/containers/abc123")).toBe(true)
		})

		it("allows ping and version", () => {
			expect(isMethodAllowed("GET", "/_ping")).toBe(true)
			expect(isMethodAllowed("GET", "/version")).toBe(true)
		})

		it("rejects image operations", () => {
			expect(isMethodAllowed("POST", "/images/create")).toBe(false)
			expect(isMethodAllowed("POST", "/build")).toBe(false)
			expect(isMethodAllowed("DELETE", "/images/abc123")).toBe(false)
		})

		it("rejects network operations", () => {
			expect(isMethodAllowed("POST", "/networks/create")).toBe(false)
			expect(isMethodAllowed("DELETE", "/networks/abc123")).toBe(false)
		})

		it("rejects volume operations", () => {
			expect(isMethodAllowed("POST", "/volumes/create")).toBe(false)
			expect(isMethodAllowed("DELETE", "/volumes/abc123")).toBe(false)
		})

		it("rejects exec delete operations", () => {
			expect(isMethodAllowed("DELETE", "/exec/exec123")).toBe(false)
		})

		it("rejects swarm operations", () => {
			expect(isMethodAllowed("POST", "/swarm/init")).toBe(false)
			expect(isMethodAllowed("POST", "/swarm/join")).toBe(false)
		})
	})
})
