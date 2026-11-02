export interface ICacheManager {
	getHash(filePath: string): string | undefined
	updateHash(filePath: string, hash: string): void
	deleteHash(filePath: string): void
	flush(): Promise<void>
	/**
	 * Mark files as being re-indexed and resolve only once that is on disk, so a
	 * crash after their points are deleted cannot leave a stale hash behind.
	 * Rejects if the marker could not be saved.
	 */
	markIncomplete(filePaths: string[]): Promise<void>
	getAllHashes(): Record<string, string>
}
