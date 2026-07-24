export const MAX_CAPTURED_OUTPUT_BYTES = 100_000

/**
 * Captures a UTF-8 prefix without retaining more than the configured byte limit.
 */
export class BoundedOutput {
	private output = ""
	private capturedByteCount = 0
	private totalByteCount = 0
	private wasTruncated = false

	public constructor(private readonly maxBytes = MAX_CAPTURED_OUTPUT_BYTES) {
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
			throw new RangeError("maxBytes must be a non-negative safe integer")
		}
	}

	public append(text: string): void {
		const bytes = Buffer.from(text, "utf8")
		this.totalByteCount += bytes.length
		if (this.wasTruncated) {
			return
		}

		const remaining = this.maxBytes - this.capturedByteCount
		if (remaining <= 0) {
			if (bytes.length > 0) {
				this.wasTruncated = true
			}
			return
		}

		if (bytes.length <= remaining) {
			this.output += text
			this.capturedByteCount += bytes.length
			return
		}

		const safeEnd = findUtf8Boundary(bytes, remaining)
		if (safeEnd > 0) {
			this.output += bytes.subarray(0, safeEnd).toString("utf8")
			this.capturedByteCount += safeEnd
		}
		this.wasTruncated = true
	}

	public get value(): string {
		return this.output
	}

	public get capturedBytes(): number {
		return this.capturedByteCount
	}

	public get totalBytes(): number {
		return this.totalByteCount
	}

	public get truncated(): boolean {
		return this.wasTruncated
	}
}

function findUtf8Boundary(bytes: Buffer, maxBytes: number): number {
	const end = Math.min(bytes.length, maxBytes)
	if (end === 0 || end === bytes.length) {
		return end
	}

	let leadIndex = end - 1
	while (leadIndex >= 0 && (bytes[leadIndex]! & 0xc0) === 0x80) {
		leadIndex--
	}

	if (leadIndex < 0) {
		return 0
	}

	const lead = bytes[leadIndex]!
	const sequenceLength = lead < 0x80 ? 1 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : 4
	return leadIndex + sequenceLength <= end ? end : leadIndex
}
