#!/usr/bin/env node
/**
 * Build a BM25-style keyword index for the bundled CangjieCorpus.
 *
 * Usage:
 *   node scripts/build-cangjie-corpus-index.mjs [corpusDir] [outputPath]
 *
 * Defaults:
 *   corpusDir  = bundled-cangjie-corpus/CangjieCorpus-1.0.0
 *   outputPath = bundled-cangjie-corpus/CangjieCorpus-1.0.0/semantic-index.json
 *
 * The index contains:
 *   - Chunked documents (by heading for .md, by definition block for .cj)
 *   - Term frequency vectors per chunk
 *   - Inverse document frequency table
 *   - Metadata (version, build date, chunk count)
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const INDEX_VERSION = 2
/** Drop very rare terms from the IDF table unless whitelisted (shrinks semantic-index.json). */
const MIN_DOC_FREQ = 2
const CANGJIE_INDEX_KEEP_TERMS = new Set([
	"class",
	"struct",
	"interface",
	"enum",
	"func",
	"let",
	"var",
	"match",
	"case",
	"where",
	"extend",
	"prop",
	"init",
	"main",
	"public",
	"private",
	"protected",
	"internal",
	"static",
	"mut",
	"override",
	"redef",
	"operator",
	"macro",
	"package",
	"import",
	"spawn",
	"synchronized",
	"try",
	"throw",
	"type",
	"abstract",
	"open",
	"sealed",
	"unsafe",
	"foreign",
	"from",
	"cjpm",
	"cjc",
	"cjfmt",
	"cjlint",
	"cjdb",
	"cjprof",
	"hashmap",
	"hashset",
	"arraylist",
	"mutex",
	"varray",
	"option",
	"array",
	"string",
	"tuple",
	"rune",
	"int64",
	"uint8",
	"uint64",
	"float64",
	"bool",
	"unit",
])

function shouldKeepIndexedTerm(term, df) {
	if (df >= MIN_DOC_FREQ) return true
	if (CANGJIE_INDEX_KEEP_TERMS.has(term)) return true
	if (/^cj[a-z]{2,}$/.test(term)) return true
	return false
}
const CHUNK_MAX_CHARS = 1500
const FILE_EXTENSIONS = [".md", ".cj", ".txt"]

// ---------------------------------------------------------------------------
// Tokenizer — handles mixed Chinese/English text
// ---------------------------------------------------------------------------

function expandEnglishWord(word) {
	const out = new Set()
	out.add(word.toLowerCase())
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

function tokenize(text) {
	const tokens = []

	// Chinese: bigrams + single-char fallback (matches runtime tokenizer)
	const zhRe = /[\u4e00-\u9fff\u3400-\u4dbf]+/g
	let m
	while ((m = zhRe.exec(text)) !== null) {
		const seg = m[0]
		for (let i = 0; i < seg.length - 1; i++) {
			tokens.push(seg.slice(i, i + 2))
		}
		for (const ch of seg) tokens.push(ch)
	}

	// English: whole-word + CamelCase (matches CangjieCorpusSemanticIndex)
	const enRe = /[a-zA-Z_]\w{1,}/g
	while ((m = enRe.exec(text)) !== null) {
		tokens.push(...expandEnglishWord(m[0]))
	}

	return tokens
}

// ---------------------------------------------------------------------------
// Chunking strategies
// ---------------------------------------------------------------------------

function chunkMarkdown(content, relPath) {
	const chunks = []
	const lines = content.split("\n")
	let currentHeading = relPath
	let currentLines = []
	let currentStart = 0

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const headingMatch = line.match(/^(#{1,4})\s+(.+)/)
		if (headingMatch && currentLines.length > 0) {
			const text = currentLines.join("\n").trim()
			if (text.length > 20) {
				chunks.push({ relPath, heading: currentHeading, text, startLine: currentStart })
			}
			currentHeading = headingMatch[2].trim()
			currentLines = [line]
			currentStart = i
		} else {
			currentLines.push(line)
		}
	}

	if (currentLines.length > 0) {
		const text = currentLines.join("\n").trim()
		if (text.length > 20) {
			chunks.push({ relPath, heading: currentHeading, text, startLine: currentStart })
		}
	}

	// Split oversized chunks
	const result = []
	for (const chunk of chunks) {
		if (chunk.text.length <= CHUNK_MAX_CHARS) {
			result.push(chunk)
		} else {
			const parts = splitText(chunk.text, CHUNK_MAX_CHARS)
			for (let i = 0; i < parts.length; i++) {
				result.push({
					...chunk,
					text: parts[i],
					heading: i === 0 ? chunk.heading : `${chunk.heading} (${i + 1})`,
				})
			}
		}
	}

	return result
}

function chunkCangjieSource(content, relPath) {
	const chunks = []
	const lines = content.split("\n")
	const defRe = /^\s*(?:public\s+|protected\s+|private\s+|internal\s+|open\s+|abstract\s+|sealed\s+|static\s+)*(?:class|struct|interface|enum|func|extend|main)\b/
	let currentLines = []
	let currentStart = 0
	let currentName = relPath

	for (let i = 0; i < lines.length; i++) {
		if (defRe.test(lines[i]) && currentLines.length > 0) {
			const text = currentLines.join("\n").trim()
			if (text.length > 20) {
				chunks.push({ relPath, heading: currentName, text, startLine: currentStart })
			}
			currentName = lines[i].trim().slice(0, 80)
			currentLines = [lines[i]]
			currentStart = i
		} else {
			currentLines.push(lines[i])
		}
	}

	if (currentLines.length > 0) {
		const text = currentLines.join("\n").trim()
		if (text.length > 20) {
			chunks.push({ relPath, heading: currentName, text, startLine: currentStart })
		}
	}

	const result = []
	for (const chunk of chunks) {
		if (chunk.text.length <= CHUNK_MAX_CHARS) {
			result.push(chunk)
		} else {
			const parts = splitText(chunk.text, CHUNK_MAX_CHARS)
			for (let i = 0; i < parts.length; i++) {
				result.push({
					...chunk,
					text: parts[i],
					heading: i === 0 ? chunk.heading : `${chunk.heading} (${i + 1})`,
				})
			}
		}
	}

	return result
}

function splitText(text, maxLen) {
	const parts = []
	let start = 0
	while (start < text.length) {
		let end = Math.min(start + maxLen, text.length)
		if (end < text.length) {
			const lastNl = text.lastIndexOf("\n", end)
			if (lastNl > start + maxLen / 2) end = lastNl
		}
		parts.push(text.slice(start, end))
		start = end
	}
	return parts
}

// ---------------------------------------------------------------------------
// Index builder
// ---------------------------------------------------------------------------

function scanFiles(dir, base) {
	const results = []
	const entries = fs.readdirSync(dir, { withFileTypes: true })
	for (const entry of entries) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "target") {
			results.push(...scanFiles(full, base))
		} else if (entry.isFile() && FILE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
			results.push({ absolute: full, relative: path.relative(base, full).replace(/\\/g, "/") })
		}
	}
	return results
}

function buildIndex(corpusDir) {
	console.log(`Scanning ${corpusDir} …`)
	const files = scanFiles(corpusDir, corpusDir)
	console.log(`Found ${files.length} files`)

	const allChunks = []

	for (const { absolute, relative } of files) {
		const content = fs.readFileSync(absolute, "utf-8")
		const ext = path.extname(relative)
		const chunks =
			ext === ".md" || ext === ".txt"
				? chunkMarkdown(content, relative)
				: chunkCangjieSource(content, relative)
		allChunks.push(...chunks)
	}

	console.log(`Created ${allChunks.length} chunks`)

	// Compute term frequencies per chunk
	const docCount = allChunks.length
	const dfMap = new Map() // term -> number of docs containing it

	const chunkData = allChunks.map((chunk, idx) => {
		const tokens = tokenize(chunk.text + " " + chunk.heading)
		const tf = new Map()
		for (const t of tokens) {
			tf.set(t, (tf.get(t) || 0) + 1)
		}
		// Track document frequency
		for (const t of tf.keys()) {
			dfMap.set(t, (dfMap.get(t) || 0) + 1)
		}
		return {
			id: idx,
			relPath: chunk.relPath,
			heading: chunk.heading,
			startLine: chunk.startLine,
			snippet: chunk.text.slice(0, 200),
			tf: Object.fromEntries(tf),
		}
	})

	const keptTerms = new Set()
	for (const [term, df] of dfMap) {
		if (shouldKeepIndexedTerm(term, df)) keptTerms.add(term)
	}

	for (const chunk of chunkData) {
		const nextTf = {}
		for (const [t, c] of Object.entries(chunk.tf)) {
			if (keptTerms.has(t)) nextTf[t] = c
		}
		chunk.tf = nextTf
	}

	const idf = {}
	for (const term of keptTerms) {
		const df = dfMap.get(term)
		idf[term] = Math.log((docCount - df + 0.5) / (df + 0.5) + 1)
	}

	const index = {
		version: INDEX_VERSION,
		buildDate: new Date().toISOString(),
		docCount,
		chunkCount: chunkData.length,
		idf,
		chunks: chunkData,
	}

	return index
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const corpusDir = process.argv[2] || path.join(ROOT, "bundled-cangjie-corpus", "CangjieCorpus-1.0.0")
const outputPath = process.argv[3] || path.join(corpusDir, "semantic-index.json")

if (!fs.existsSync(corpusDir)) {
	console.error(`Corpus directory not found: ${corpusDir}`)
	process.exit(1)
}

const index = buildIndex(corpusDir)

fs.writeFileSync(outputPath, JSON.stringify(index), "utf-8")
const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)
console.log(`Index written to ${outputPath} (${sizeMB} MB, ${index.chunkCount} chunks)`)
