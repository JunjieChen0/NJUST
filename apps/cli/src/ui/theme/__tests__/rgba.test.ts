import { describe, it, expect } from "vitest"

import { rgba, rgbaFromHex, toHex, tint, selectedForeground, ansiToRgba } from "../rgba.js"

describe("rgba primitives", () => {
	it("clamps channels to 0..255", () => {
		expect(rgba(-10, 999, 128)).toEqual({ r: 0, g: 255, b: 128, a: 255 })
	})

	it("rounds fractional inputs", () => {
		expect(rgba(127.4, 127.6, 0)).toEqual({ r: 127, g: 128, b: 0, a: 255 })
	})

	it("parses 6-digit hex", () => {
		expect(rgbaFromHex("#fab283")).toEqual({ r: 0xfa, g: 0xb2, b: 0x83, a: 255 })
	})

	it("parses 3-digit hex (expanded)", () => {
		expect(rgbaFromHex("#abc")).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 255 })
	})

	it("parses 8-digit hex with alpha", () => {
		expect(rgbaFromHex("#00112233")).toEqual({ r: 0x00, g: 0x11, b: 0x22, a: 0x33 })
	})

	it("rejects invalid hex", () => {
		expect(() => rgbaFromHex("#xyz")).toThrow()
		expect(() => rgbaFromHex("nothex")).toThrow()
	})

	it("serializes to lowercase #rrggbb (drops alpha)", () => {
		expect(toHex(rgba(0xfa, 0xb2, 0x83, 0x80))).toBe("#fab283")
	})

	it("tint blends linearly toward `over` weighted by alpha", () => {
		const black = rgba(0, 0, 0)
		const white = rgba(255, 255, 255)
		expect(tint(black, 0, white)).toEqual(black)
		expect(tint(black, 1, white)).toEqual(white)
		expect(tint(black, 0.5, white)).toEqual({ r: 128, g: 128, b: 128, a: 255 })
	})

	it("tint clamps alpha outside 0..1", () => {
		const black = rgba(0, 0, 0)
		const white = rgba(255, 255, 255)
		expect(tint(black, -1, white)).toEqual(black)
		expect(tint(black, 99, white)).toEqual(white)
	})

	it("selectedForeground picks white on dark bg, black on light bg", () => {
		expect(selectedForeground(rgba(0, 0, 0))).toEqual(rgba(255, 255, 255))
		expect(selectedForeground(rgba(255, 255, 255))).toEqual(rgba(0, 0, 0))
		expect(selectedForeground(rgba(50, 50, 50))).toEqual(rgba(255, 255, 255))
		expect(selectedForeground(rgba(200, 200, 200))).toEqual(rgba(0, 0, 0))
	})

	it("ansiToRgba: 16 base colors", () => {
		expect(ansiToRgba(0)).toEqual(rgba(0, 0, 0))
		expect(ansiToRgba(15)).toEqual(rgba(255, 255, 255))
	})

	it("ansiToRgba: 6x6x6 cube", () => {
		// code 16 = (0,0,0)
		expect(ansiToRgba(16)).toEqual(rgba(0, 0, 0))
		// code 231 = (5,5,5) → (255,255,255)
		expect(ansiToRgba(231)).toEqual(rgba(255, 255, 255))
	})

	it("ansiToRgba: grayscale ramp", () => {
		expect(ansiToRgba(232)).toEqual(rgba(8, 8, 8))
		expect(ansiToRgba(255)).toEqual(rgba(238, 238, 238))
	})

	it("ansiToRgba: out-of-range returns black", () => {
		expect(ansiToRgba(999)).toEqual(rgba(0, 0, 0))
	})
})
