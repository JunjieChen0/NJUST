import * as fs from "fs"
import * as path from "path"

// ---------------------------------------------------------------------------
// Types mirroring the build script output
// ---------------------------------------------------------------------------

interface ChunkEntry {
	id: number
	relPath: string
	heading: string
	startLine: number
	snippet: string
	tf: Record<string, number>
	embedding?: number[]
}

interface SemanticIndex {
	version: number
	buildDate: string
	docCount: number
	chunkCount: number
	idf: Record<string, number>
	chunks: ChunkEntry[]
	embeddingModel?: string
}

export interface SemanticSearchResult {
	relPath: string
	heading: string
	startLine: number
	snippet: string
	score: number
}

export interface CorpusSearchOptions {
	/** After BM25 ranking, keep at most this many hits per `relPath` (diversifies multi-chunk files). */
	maxChunksPerPath?: number
}

// ---------------------------------------------------------------------------
// Tokenizer — must match the build script
// ---------------------------------------------------------------------------

const ZH_SEGMENT_RE = /[\u4e00-\u9fff\u3400-\u4dbf]+/g
const EN_TOKEN_RE = /[a-zA-Z_]\w{1,}/g

/** CamelCase / PascalCase → whole word (lower) + segment tokens, e.g. HashMap → hashmap, hash, map */
function expandEnglishWord(word: string): string[] {
	const out = new Set<string>()
	const lower = word.toLowerCase()
	out.add(lower)
	const split = word
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.split(/\s+/)
		.filter(Boolean)
	for (const seg of split) {
		const sl = seg.toLowerCase()
		if (sl.length >= 2) out.add(sl)
		else if (split.length === 1 && sl.length === 1) out.add(sl)
	}
	return [...out]
}

function tokenize(text: string): string[] {
	const tokens: string[] = []
	let m: RegExpExecArray | null

	// Chinese: bigrams + single-char fallback for better phrase matching
	ZH_SEGMENT_RE.lastIndex = 0
	while ((m = ZH_SEGMENT_RE.exec(text)) !== null) {
		const seg = m[0]
		for (let i = 0; i < seg.length - 1; i++) {
			tokens.push(seg.slice(i, i + 2))
		}
		for (const ch of seg) tokens.push(ch)
	}

	// English: whole-word + CamelCase segments (must match build-cangjie-corpus-index.mjs)
	EN_TOKEN_RE.lastIndex = 0
	while ((m = EN_TOKEN_RE.exec(text)) !== null) {
		tokens.push(...expandEnglishWord(m[0]))
	}

	return tokens
}

// ---------------------------------------------------------------------------
// BM25 scorer
// ---------------------------------------------------------------------------

const BM25_K1 = 1.2
const BM25_B = 0.75
const HYBRID_VECTOR_DIM = 64
const HYBRID_BM25_WEIGHT = 0.7
const HYBRID_VECTOR_WEIGHT = 0.3

function scoreBM25(
	queryTokens: string[],
	chunkTf: Record<string, number>,
	idf: Record<string, number>,
	avgDl: number,
): number {
	let dl = 0
	for (const v of Object.values(chunkTf)) dl += v

	let score = 0
	for (const qt of queryTokens) {
		const tf = chunkTf[qt] ?? 0
		if (tf === 0) continue
		const idfVal = idf[qt] ?? 0
		const numerator = tf * (BM25_K1 + 1)
		const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgDl))
		score += idfVal * (numerator / denominator)
	}
	return score
}

function hashTokenToDim(token: string, dim: number): number {
	let h = 2166136261
	for (let i = 0; i < token.length; i++) {
		h ^= token.charCodeAt(i)
		h = Math.imul(h, 16777619)
	}
	return (h >>> 0) % dim
}

function buildHashedEmbeddingFromTf(tf: Record<string, number>, dim = HYBRID_VECTOR_DIM): number[] {
	const vec = new Array(dim).fill(0)
	for (const [token, weight] of Object.entries(tf)) {
		const d = hashTokenToDim(token, dim)
		vec[d] += weight
	}
	const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1
	return vec.map((v) => v / norm)
}

function buildHashedEmbeddingFromQueryTokens(tokens: string[], dim = HYBRID_VECTOR_DIM): number[] {
	const tf: Record<string, number> = {}
	for (const token of tokens) {
		tf[token] = (tf[token] ?? 0) + 1
	}
	return buildHashedEmbeddingFromTf(tf, dim)
}

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0
	let dot = 0
	let na = 0
	let nb = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	if (na === 0 || nb === 0) return 0
	return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const INDEX_FILENAME = "semantic-index.json"

/** `mtimeMs:size` of `semantic-index.json` — when it changes, drop cached {@link CangjieCorpusSemanticIndex} instances. */
export function getCangjieSemanticIndexFingerprint(corpusRoot: string): string | null {
	const indexPath = path.join(corpusRoot, INDEX_FILENAME)
	try {
		const st = fs.statSync(indexPath)
		return `${st.mtimeMs}:${st.size}`
	} catch {
		return null
	}
}

/** Small synonym expansion for BM25 query recall (at most two extra tokens). */
const QUERY_SYNONYM_EXTRA: Record<string, string> = {
	array: "arraylist",
	list: "arraylist",
	map: "hashmap",
	dict: "hashmap",
	set: "hashset",
	字典: "hashmap",
	映射: "hashmap",
	去重: "hashset",
	唯一: "hashset",
	并发: "std.sync",
	协程: "coroutine",
}

export function expandCangjieSemanticQuery(query: string): string {
	const words = query
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
	const seen = new Set(words)
	const extras: string[] = []
	for (const w of words) {
		if (extras.length >= 2) break
		const syn = QUERY_SYNONYM_EXTRA[w]
		if (syn && !seen.has(syn)) {
			extras.push(syn)
			seen.add(syn)
		}
	}
	return extras.length ? `${query} ${extras.join(" ")}` : query
}

export class CangjieCorpusSemanticIndex {
	private index: SemanticIndex | null = null
	private avgDl = 0
	private loaded = false
	private loadError: string | undefined
	private chunkEmbeddingCache = new Map<number, number[]>()

	constructor(private readonly corpusRoot: string) {}

	/**
	 * Lazily load the precomputed index on first search.
	 * Returns true if the index is available.
	 */
	private ensureLoaded(): boolean {
		if (this.loaded) return this.index !== null

		this.loaded = true
		const indexPath = path.join(this.corpusRoot, INDEX_FILENAME)
		if (!fs.existsSync(indexPath)) {
			this.loadError = `Index file not found: ${indexPath}`
			return false
		}

		try {
			const raw = fs.readFileSync(indexPath, "utf-8")
			const parsed = JSON.parse(raw) as SemanticIndex
			if (!parsed.chunks || !parsed.idf) {
				this.loadError = "Malformed index"
				return false
			}
			this.index = parsed

			let totalDl = 0
			for (const chunk of parsed.chunks) {
				let dl = 0
				for (const v of Object.values(chunk.tf)) dl += v
				totalDl += dl
			}
			this.avgDl = parsed.chunks.length > 0 ? totalDl / parsed.chunks.length : 1

			return true
		} catch (err) {
			this.loadError = String(err)
			return false
		}
	}

	get isAvailable(): boolean {
		return this.ensureLoaded()
	}

	get diagnosticMessage(): string | undefined {
		this.ensureLoaded()
		return this.loadError
	}

	/**
	 * Search the corpus using BM25 keyword matching.
	 *
	 * @param query      Natural language query
	 * @param topK       Maximum results (default 10)
	 * @param pathPrefix Optional sub-path filter (e.g. "libs/std/collection")
	 * @param options    Optional diversification (e.g. cap chunks per file)
	 */
	private finalizeScoredChunks(
		scored: Array<{ chunk: ChunkEntry; score: number }>,
		topK: number,
		options?: CorpusSearchOptions,
	): SemanticSearchResult[] {
		scored.sort((a, b) => b.score - a.score)

		const maxPerPath = options?.maxChunksPerPath
		let picked: Array<{ chunk: ChunkEntry; score: number }>
		if (maxPerPath !== undefined && maxPerPath > 0) {
			const countByPath = new Map<string, number>()
			picked = []
			for (const item of scored) {
				const p = item.chunk.relPath
				const c = countByPath.get(p) ?? 0
				if (c >= maxPerPath) continue
				countByPath.set(p, c + 1)
				picked.push(item)
				if (picked.length >= topK) break
			}
		} else {
			picked = scored.slice(0, topK)
		}

		return picked.map(({ chunk, score }) => ({
			relPath: chunk.relPath,
			heading: chunk.heading,
			startLine: chunk.startLine,
			snippet: chunk.snippet,
			score,
		}))
	}

	search(query: string, topK = 10, pathPrefix?: string, options?: CorpusSearchOptions): SemanticSearchResult[] {
		if (!this.ensureLoaded() || !this.index) return []

		const queryTokens = tokenize(query)
		if (queryTokens.length === 0) return []

		const scored: Array<{ chunk: ChunkEntry; score: number }> = []
		const queryVec = buildHashedEmbeddingFromQueryTokens(queryTokens)

		for (const chunk of this.index.chunks) {
			if (pathPrefix && !chunk.relPath.startsWith(pathPrefix)) continue
			const bm25 = scoreBM25(queryTokens, chunk.tf, this.index.idf, this.avgDl)
			const emb = chunk.embedding ?? this.getChunkEmbedding(chunk)
			const vecScore = cosineSimilarity(queryVec, emb)
			const s = HYBRID_BM25_WEIGHT * bm25 + HYBRID_VECTOR_WEIGHT * Math.max(0, vecScore)
			if (s > 0) {
				scored.push({ chunk, score: s })
			}
		}

		return this.finalizeScoredChunks(scored, topK, options)
	}

	/**
	 * Run multiple queries with a single pass over chunks (same scoring as {@link search} per query).
	 */
	searchBatch(
		queries: string[],
		topK = 10,
		pathPrefix?: string,
		options?: CorpusSearchOptions,
	): SemanticSearchResult[][] {
		if (!this.ensureLoaded() || !this.index) return queries.map(() => [])

		const meta: Array<{ queryTokens: string[]; queryVec: number[] } | null> = queries.map((q) => {
			const queryTokens = tokenize(q)
			if (queryTokens.length === 0) return null
			return { queryTokens, queryVec: buildHashedEmbeddingFromQueryTokens(queryTokens) }
		})

		const qCount = queries.length
		const scoredByQ: Array<Array<{ chunk: ChunkEntry; score: number }>> = Array.from({ length: qCount }, () => [])

		for (const chunk of this.index.chunks) {
			if (pathPrefix && !chunk.relPath.startsWith(pathPrefix)) continue
			const emb = chunk.embedding ?? this.getChunkEmbedding(chunk)
			for (let qi = 0; qi < qCount; qi++) {
				const m = meta[qi]
				if (!m) continue
				const bm25 = scoreBM25(m.queryTokens, chunk.tf, this.index.idf, this.avgDl)
				const vecScore = cosineSimilarity(m.queryVec, emb)
				const s = HYBRID_BM25_WEIGHT * bm25 + HYBRID_VECTOR_WEIGHT * Math.max(0, vecScore)
				if (s > 0) scoredByQ[qi].push({ chunk, score: s })
			}
		}

		return meta.map((m, qi) => (m ? this.finalizeScoredChunks(scoredByQ[qi], topK, options) : []))
	}

	private getChunkEmbedding(chunk: ChunkEntry): number[] {
		const cached = this.chunkEmbeddingCache.get(chunk.id)
		if (cached) return cached
		const built = buildHashedEmbeddingFromTf(chunk.tf)
		this.chunkEmbeddingCache.set(chunk.id, built)
		return built
	}
}
