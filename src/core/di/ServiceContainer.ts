type Token<T = unknown> = string | symbol | (new (...args: never[]) => T)

type Registration<T> =
	| { kind: "singleton"; factory: () => T; instance?: T }
	| { kind: "transient"; factory: () => T }

/**
 * Minimal DI container (G.1): register factory + singleton/transient resolution.
 */
export class ServiceContainer {
	private readonly registry = new Map<Token, Registration<unknown>>()

	registerSingleton<T>(token: Token<T>, factory: () => T): void {
		this.registry.set(token, { kind: "singleton", factory })
	}

	registerTransient<T>(token: Token<T>, factory: () => T): void {
		this.registry.set(token, { kind: "transient", factory })
	}

	resolve<T>(token: Token<T>): T {
		const reg = this.registry.get(token) as Registration<T> | undefined
		if (!reg) {
			throw new Error(`ServiceContainer: unregistered token ${String(token)}`)
		}
		if (reg.kind === "singleton") {
			if (reg.instance === undefined) {
				reg.instance = reg.factory()
			}
			return reg.instance
		}
		return reg.factory()
	}

	tryResolve<T>(token: Token<T>): T | undefined {
		try {
			return this.resolve(token)
		} catch {
			return undefined
		}
	}

	clear(): void {
		this.registry.clear()
	}
}
