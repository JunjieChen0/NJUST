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
import * as fs from "fs"
import * as path from "path"

/**
 * Body sent by Docker CLI 29.4.3 for the evals `docker run` arguments, captured
 * from a local fake Docker API (no container was created).
 */
const CLI_CREATE_BODY = fs.readFileSync(path.join(__dirname, "fixtures", "docker-cli-29.4.3-create.json"), "utf-8")

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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
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
				Name: "evals-task-test",
				HostConfig: { Memory: 512 * 1024 * 1024, PidsLimit: 200, NanoCpus: 1e9, NetworkMode: "evals_default" },
			}

			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(true)
		})

		it("rejects subdirectory of allowed volume source (exact match only)", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-task-test",
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
				Name: "evals-task-test",
			}
			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("HostConfig is required")
		})

		it("rejects containers without PidsLimit", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-task-test",
				HostConfig: { Memory: 512 * 1024 * 1024, NanoCpus: 1e9 },
			}
			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("PidsLimit")
		})

		it("rejects containers without NanoCpus", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-task-test",
				HostConfig: { Memory: 512 * 1024 * 1024, PidsLimit: 200 },
			}
			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("NanoCpus")
		})

		it("rejects MemorySwap=-1 (unlimited swap)", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-task-test",
				HostConfig: { Memory: 512 * 1024 * 1024, MemorySwap: -1, PidsLimit: 200, NanoCpus: 1e9 },
			}
			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("unlimited swap")
		})

		it("rejects PidsLimit=-1 (unlimited)", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-task-test",
				HostConfig: { Memory: 512 * 1024 * 1024, PidsLimit: -1, NanoCpus: 1e9 },
			}
			const decision = validateCreateContainer(req)
			expect(decision.allowed).toBe(false)
			expect(decision.reason).toContain("PidsLimit")
		})

		it("rejects named volumes in Mounts", () => {
			const req: DockerCreateContainerRequest = {
				Image: "evals-runner",
				Name: "evals-task-test",
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

		describe("managed container names", () => {
			const validHostConfig = {
				NetworkMode: "evals_default",
				Memory: 512 * 1024 * 1024,
				PidsLimit: 200,
				NanoCpus: 1e9,
			}

			it.each(["evals-docker-proxy", "evals-web", "evals-db", "evals-redis", "evals-runner"])(
				"rejects infrastructure container name %s",
				(name) => {
					const decision = validateCreateContainer({
						Image: "evals-runner",
						Name: name,
						HostConfig: validHostConfig,
					})
					expect(decision.allowed).toBe(false)
					expect(decision.reason).toContain("must start with")
				},
			)

			it.each(["evals-task-run1-42.0", "evals-controller-run1"])("allows managed container name %s", (name) => {
				const decision = validateCreateContainer({
					Image: "evals-runner",
					Name: name,
					HostConfig: validHostConfig,
				})
				expect(decision.allowed).toBe(true)
			})
		})

		describe("VolumesFrom", () => {
			const base = {
				Image: "evals-runner",
				Name: "evals-task-1.0",
			}
			const validHostConfig = {
				NetworkMode: "evals_default",
				Memory: 512 * 1024 * 1024,
				PidsLimit: 200,
				NanoCpus: 1e9,
			}

			it("rejects inheriting volumes from another container", () => {
				const decision = validateCreateContainer({
					...base,
					HostConfig: { ...validHostConfig, VolumesFrom: ["evals-docker-proxy"] },
				})
				expect(decision.allowed).toBe(false)
				expect(decision.reason).toContain("VolumesFrom")
			})

			it("rejects non-array VolumesFrom values", () => {
				// Raw wire body: VolumesFrom arrives as a string, not an array.
				const decision = validateCreateContainer(
					JSON.parse(
						JSON.stringify({
							...base,
							HostConfig: { ...validHostConfig, VolumesFrom: "evals-docker-proxy" },
						}),
					),
				)
				expect(decision.allowed).toBe(false)
				expect(decision.reason).toContain("VolumesFrom")
			})

			it.each([null, []])("allows empty VolumesFrom (%j, as sent by docker CLI)", (value) => {
				const decision = validateCreateContainer({
					...base,
					HostConfig: { ...validHostConfig, VolumesFrom: value },
				})
				expect(decision.allowed).toBe(true)
			})
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

	describe("wire-level body checks", () => {
		// Bodies are parsed from raw JSON, as the proxy does. Docker decodes field
		// names case-insensitively, so spellings the policy does not read must be rejected.
		const validHostConfig = {
			NetworkMode: "evals_default",
			Memory: 512 * 1024 * 1024,
			PidsLimit: 200,
			NanoCpus: 1e9,
		}
		const wire = (hostConfig: Record<string, unknown>, top: Record<string, unknown> = {}): unknown =>
			JSON.parse(
				JSON.stringify({ Image: "evals-runner", Name: "evals-task-1.0", HostConfig: hostConfig, ...top }),
			)

		it("accepts the canonical body", () => {
			expect(validateCreateContainer(wire(validHostConfig)).allowed).toBe(true)
		})

		it.each([
			["lowercase privileged", { ...validHostConfig, privileged: true }],
			["lowercase binds", { ...validHostConfig, binds: ["/:/host"] }],
			["mixed-case Networkmode", { ...validHostConfig, Networkmode: "host" }],
			[
				"a mount whose source is overridden by a lowercase duplicate",
				{ ...validHostConfig, Mounts: [{ Type: "bind", Source: "/tmp/evals", source: "/", Target: "/x" }] },
			],
			[
				"a mount key that only folds to Source outside ASCII",
				{ ...validHostConfig, Mounts: [{ Type: "bind", Source: "/tmp/evals", ſource: "/", Target: "/x" }] },
			],
		])("rejects %s", (_label, hostConfig) => {
			const decision = validateCreateContainer(wire(hostConfig))
			expect(decision.allowed).toBe(false)
		})

		it("rejects a lowercase top-level field", () => {
			expect(validateCreateContainer(wire(validHostConfig, { hostconfig: { Privileged: true } })).allowed).toBe(
				false,
			)
		})

		it.each([
			["Memory: null", { ...validHostConfig, Memory: null }],
			["Memory as a string", { ...validHostConfig, Memory: "1" }],
			["PidsLimit: null", { ...validHostConfig, PidsLimit: null }],
			["Privileged as a string", { ...validHostConfig, Privileged: "true" }],
			["Binds as a string", { ...validHostConfig, Binds: "/:/host" }],
			["a mount that is not an object", { ...validHostConfig, Mounts: ["/:/host"] }],
		])("rejects %s", (_label, hostConfig) => {
			expect(validateCreateContainer(wire(hostConfig)).allowed).toBe(false)
		})

		it.each([
			["an array body", []],
			["a null body", null],
			["an array HostConfig", { Image: "evals-runner", Name: "evals-task-1.0", HostConfig: [] }],
		])("rejects %s", (_label, body) => {
			expect(validateCreateContainer(body).allowed).toBe(false)
		})

		it("rejects a kill signal spelled in lowercase", () => {
			expect(validateKillContainer("evals-task-1", JSON.parse('{"signal":"SIGHUP"}')).allowed).toBe(false)
		})
	})

	describe("field allowlist", () => {
		const hostConfig = {
			NetworkMode: "evals_default",
			Memory: 512 * 1024 * 1024,
			PidsLimit: 200,
			NanoCpus: 1e9,
		}
		const create = (extraHostConfig: Record<string, unknown> = {}, extraTop: Record<string, unknown> = {}) =>
			validateCreateContainer(
				JSON.parse(
					JSON.stringify({
						Image: "evals-runner",
						Name: "evals-task-1.0",
						HostConfig: { ...hostConfig, ...extraHostConfig },
						...extraTop,
					}),
				),
			)
		const gpu = [{ Driver: "nvidia", Count: -1, Capabilities: [["gpu"]] }]

		it.each([
			["DeviceRequests", { DeviceRequests: gpu }],
			["lowercase deviceRequests", { deviceRequests: gpu }],
			["Runtime", { Runtime: "runc-unconfined" }],
			["CgroupnsMode host", { CgroupnsMode: "host" }],
			["a restart policy other than no", { RestartPolicy: { Name: "always", MaximumRetryCount: 0 } }],
		])("rejects HostConfig with %s", (_label, extra) => {
			const decision = create(extra)
			expect(decision.allowed).toBe(false)
			expect(decision.body).toBeUndefined()
		})

		it.each([
			["another network", { EndpointsConfig: { bridge: {} } }],
			["an endpoint with a static IP", { EndpointsConfig: { evals_default: { IPAddress: "10.0.0.9" } } }],
		])("rejects NetworkingConfig joining %s", (_label, networkingConfig) => {
			expect(create({}, { NetworkingConfig: networkingConfig }).allowed).toBe(false)
		})

		it("rejects an unknown top-level field with a value", () => {
			expect(create({}, { Volumes: { "/data": {} } }).allowed).toBe(false)
		})

		it("accepts the body a real Docker CLI sends for the evals run arguments", () => {
			const decision = validateCreateContainer({ ...JSON.parse(CLI_CREATE_BODY), Name: "evals-task-1.0" })

			expect(decision.reason).toBeUndefined()
			expect(decision.allowed).toBe(true)
			// -1 means "system default", the same as not sending the field.
			expect((decision.body as DockerCreateContainerRequest).HostConfig).not.toHaveProperty("MemorySwappiness")
		})

		it("still rejects a MemorySwappiness other than the default", () => {
			expect(create({ MemorySwappiness: 100 }).allowed).toBe(false)
		})

		it("accepts a Docker CLI style body and forwards only allowed fields", () => {
			const decision = create(
				{
					Binds: ["/tmp/evals:/var/log/evals"],
					MemorySwap: 1024 * 1024 * 1024,
					AutoRemove: true,
					RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
					LogConfig: { Type: "", Config: {} },
					ConsoleSize: [0, 0],
					DeviceRequests: null,
					Runtime: "",
					CgroupnsMode: "",
					MemorySwappiness: null,
					Dns: [],
					ShmSize: 0,
				},
				{
					Env: ["EVALS_ATTEMPT=0"],
					Cmd: ["sh", "-c", "pnpm cli"],
					AttachStdout: true,
					AttachStderr: true,
					Tty: false,
					Volumes: null,
					NetworkingConfig: { EndpointsConfig: { evals_default: { Aliases: null, IPAMConfig: null } } },
				},
			)

			expect(decision.allowed).toBe(true)
			const body = decision.body as Record<string, Record<string, unknown>>
			expect(Object.keys(body.HostConfig!).sort()).toEqual(
				[
					"AutoRemove",
					"Binds",
					"Memory",
					"MemorySwap",
					"NanoCpus",
					"NetworkMode",
					"PidsLimit",
					"RestartPolicy",
					"LogConfig",
					"ConsoleSize",
				].sort(),
			)
			expect(body.HostConfig!.LogConfig).toEqual({})
			expect(Object.keys(body.HostConfig!)).not.toContain("DeviceRequests")
			expect(body).not.toHaveProperty("Volumes")
			expect(body.NetworkingConfig).toEqual({ EndpointsConfig: { evals_default: {} } })
		})
	})
})
