import { expect, test, type APIResponse, type Page, type Request, type Response } from "@playwright/test"

// Checks that the nonce-based CSP set by src/middleware.ts lets the production build
// load, hydrate and run client code, with no CSP violations along the way.

const TEST_MODEL_ID = "test/csp-model"

declare global {
	interface Window {
		__cspViolations?: string[]
	}
}

/** Record CSP violations from the page (DOM events) and the console. */
async function trackCspViolations(page: Page): Promise<() => Promise<string[]>> {
	const consoleViolations: string[] = []
	page.on("console", (message) => {
		if (/Content Security Policy|Refused to (execute|load|apply|connect)/i.test(message.text())) {
			consoleViolations.push(message.text())
		}
	})
	await page.addInitScript(() => {
		document.addEventListener("securitypolicyviolation", (event) => {
			window.__cspViolations = [
				...(window.__cspViolations ?? []),
				`${event.violatedDirective} blocked ${event.blockedURI || "inline"}`,
			]
		})
	})
	return async () => [...consoleViolations, ...(await page.evaluate(() => window.__cspViolations ?? []))]
}

/** The script nonce in a response's CSP header. */
async function nonceOf(response: Response | APIResponse | null): Promise<string> {
	const headers = response?.headers() ?? {}
	const nonce = /'nonce-([^']+)'/.exec(headers["content-security-policy"] ?? "")?.[1]
	expect(nonce, "CSP header has a script nonce").toBeTruthy()
	return nonce!
}

/**
 * Every script the server sends must carry the nonce from that response's CSP header,
 * and every inline script in the loaded page must carry the page's nonce. Chunks the
 * runtime loads later are external same-origin files, which the policy allows via 'self'.
 */
async function expectScriptsUseNonce(page: Page, path: string, navigation: Response | null) {
	const fetched = await page.request.get(path)
	const fetchedNonce = await nonceOf(fetched)
	const serverScripts = (await fetched.text()).match(/<script[^>]*>/g) ?? []
	expect(serverScripts.length).toBeGreaterThan(0)
	expect(serverScripts.filter((tag) => !tag.includes(`nonce="${fetchedNonce}"`))).toEqual([])

	// Browsers hide the nonce attribute after parsing; the property keeps the value.
	const inlineWithoutNonce = await page.evaluate(
		(expected) =>
			[...document.scripts]
				.filter((script) => !script.src && script.nonce !== expected)
				.map((script) => script.textContent?.slice(0, 60)),
		await nonceOf(navigation),
	)
	expect(inlineWithoutNonce).toEqual([])
}

test("new run page loads, hydrates and validates the form without CSP violations", async ({ page }) => {
	const violations = await trackCspViolations(page)

	const response = await page.goto("/runs/new")
	expect(response?.status()).toBe(200)
	await expectScriptsUseNonce(page, "/runs/new", response)

	// Typing and submitting only work once React has hydrated the form.
	const description = page.getByPlaceholder("Optional")
	await description.fill("csp acceptance")
	await expect(description).toHaveValue("csp acceptance")

	await page.getByRole("button", { name: "Launch" }).click()
	// Client-side validation (react-hook-form + zod) renders field messages.
	await expect(page.locator("[id$='-form-item-message']").first()).toBeVisible()

	expect(await violations()).toEqual([])
})

test("submitting a valid form sends the create-run request without CSP violations", async ({ page }) => {
	const violations = await trackCspViolations(page)

	// The model list comes from OpenRouter in the browser; serve a fixed one.
	await page.route("https://openrouter.ai/api/v1/models", (route) =>
		route.fulfill({
			json: { data: [{ id: TEST_MODEL_ID, name: "CSP Test Model" }] },
			headers: { "access-control-allow-origin": "*" },
		}),
	)

	// Isolated backend: the create-run server action is answered here and never
	// reaches the server, so nothing is written to the database and no container starts.
	const createRunRequests: Request[] = []
	await page.route("**/runs/new", async (route) => {
		const request = route.request()
		const isCreateRun =
			request.method() === "POST" &&
			request.headers()["next-action"] !== undefined &&
			(request.postData() ?? "").includes(TEST_MODEL_ID)
		if (!isCreateRun) return route.fallback()
		createRunRequests.push(request)
		await route.fulfill({ status: 503, body: "isolated in e2e" })
	})

	await page.goto("/runs/new")
	await page.getByRole("tab", { name: "OpenRouter" }).click()
	await page.getByRole("combobox").first().click()
	await page.getByRole("option", { name: "CSP Test Model" }).click()
	await page.getByRole("button", { name: "Launch" }).click()

	await expect.poll(() => createRunRequests.length).toBe(1)
	expect(createRunRequests[0]!.url()).toContain("/runs/new")

	expect(await violations()).toEqual([])
})

test("client-side navigation goes through the Next router without CSP violations", async ({ page }) => {
	const violations = await trackCspViolations(page)
	const navigation = await page.goto("/runs/new")
	await expectScriptsUseNonce(page, "/runs/new", navigation)

	// router.push("/") fetches the route's RSC payload instead of loading a new document.
	const rscRequest = page.waitForRequest(
		(request) =>
			new URL(request.url()).pathname === "/" &&
			request.resourceType() === "fetch" &&
			request.headers()["rsc"] === "1",
	)
	await page.getByRole("button", { name: "Close" }).click()
	await rscRequest

	// Without a database the home page itself fails to render, so the check stops at the
	// router request; what matters here is that client routing ran under the CSP.
	expect(await violations()).toEqual([])
})

test("full page loads keep the CSP intact", async ({ page }) => {
	const violations = await trackCspViolations(page)

	// The home page needs the database; without one it renders the error page,
	// which still loads and runs the framework scripts under the same CSP.
	const home = await page.goto("/")
	await expectScriptsUseNonce(page, "/", home)

	const newRun = await page.goto("/runs/new")
	await expectScriptsUseNonce(page, "/runs/new", newRun)

	expect(await violations()).toEqual([])
})
