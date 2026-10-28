/**
 * Type declarations for the pdf-parse entry used by extract-text.ts.
 *
 * pdf-parse 1.1.1 ships without type definitions. Only the CommonJS entry
 * ("pdf-parse/lib/pdf-parse") is declared here; it is the only import used
 * by this repository.
 */

declare module "pdf-parse/lib/pdf-parse" {
	export interface PdfParseResult {
		/** Number of pages found in the PDF document. */
		numpages: number
		/** Number of pages rendered. */
		numrender: number
		/** PDF metadata dictionary reported by pdf.js. */
		info: Record<string, unknown>
		/** Raw metadata block reported by pdf.js. */
		metadata: unknown
		/** Extracted text, pages separated by blank lines. */
		text: string
		/** pdf-parse version. */
		version: string
	}

	export interface PdfParseOptions {
		/** Called for each page; resolves to that page's rendered text. */
		pagerender?: (pageData: unknown) => string | Promise<string>
		/** Maximum number of pages to render (0 renders all pages). */
		max?: number
		/** pdf.js version override. */
		version?: string
	}

	function pdf(dataBuffer: Uint8Array, options?: PdfParseOptions): Promise<PdfParseResult>

	export = pdf
}
