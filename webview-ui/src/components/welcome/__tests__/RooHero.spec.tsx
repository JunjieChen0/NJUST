import { render, screen } from "@testing-library/react"
import { describe, it, expect, beforeEach } from "vitest"
import RooHero from "../RooHero"

describe("RooHero", () => {
	beforeEach(() => {
		// Reset window object IMAGES_BASE_URI
		if (typeof window !== "undefined") {
			delete (window as any).IMAGES_BASE_URI
		}
	})

	it("renders with default icon url if IMAGES_BASE_URI is not set", () => {
		render(<RooHero />)

		const img = screen.getByAltText("NJUST_AI") as HTMLImageElement
		expect(img).toBeInTheDocument()
		expect(img.src).toContain("/icon.png")

		const text = screen.getByText("NJUST_AI")
		expect(text).toBeInTheDocument()
		expect(text.tagName).toBe("SPAN")
	})

	it("renders with base uri when IMAGES_BASE_URI is defined", () => {
		const baseUri = "https://custom-base-uri.com"
		if (typeof window !== "undefined") {
			;(window as any).IMAGES_BASE_URI = baseUri
		}

		render(<RooHero />)

		const img = screen.getByAltText("NJUST_AI") as HTMLImageElement
		expect(img.src).toBe(`${baseUri}/icon.png`)
	})
})
