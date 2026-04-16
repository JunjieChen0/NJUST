/**
 * Tracks semantic versions for major prompt sections (report F.3).
 * Wire-up to changesets / CI can append entries over time.
 */
export type PromptVersionRecord = {
	sectionId: string
	version: string
	updatedAt: string
}

export class PromptVersionRegistry {
	private readonly versions = new Map<string, PromptVersionRecord>()

	register(record: PromptVersionRecord): void {
		this.versions.set(record.sectionId, record)
	}

	get(sectionId: string): PromptVersionRecord | undefined {
		return this.versions.get(sectionId)
	}
}

export const promptVersionRegistry = new PromptVersionRegistry()

promptVersionRegistry.register({
	sectionId: "system_prompt_core",
	version: "2026.4.0",
	updatedAt: "2026-04-15T00:00:00.000Z",
})
