import { useEffect, useState } from "react"

/**
 * `<useFooterWelcome>` — periodically toggles a "welcome" hint in the footer.
 *
 * Mirrors OpenCode `routes/session/footer.tsx`: when the user is NOT connected
 * to a provider, the footer alternates between showing the normal status row
 * and a `Get started /connect` nudge. The cycle is:
 *
 *   1. Wait 10s before first appearance (avoids flashing on launch)
 *   2. Show welcome for 5s
 *   3. Hide for 10s
 *   4. Repeat from step 2
 *
 * As soon as `connected` becomes `true`, the cycle stops and the welcome
 * state resets to `false` (no nudge once the user is connected).
 *
 * @param connected whether a provider is currently connected
 * @returns `welcome` — when true, the footer should render the nudge
 */
export function useFooterWelcome(connected: boolean): boolean {
	const [welcome, setWelcome] = useState(false)

	useEffect(() => {
		// Reset on connect: stop any pending cycle and hide the nudge.
		if (connected) {
			setWelcome(false)
			return
		}

		const timeouts: Array<ReturnType<typeof setTimeout>> = []

		// One tick: sets `welcome` to `value`, then schedules the inverse
		// tick after the appropriate delay.
		//
		// Matches OpenCode `routes/session/footer.tsx`: the nudge is shown
		// briefly (5s) and hidden longer (10s). Since `delayMs` is the wait
		// BEFORE the next tick fires, we delay 5s after showing and 10s
		// after hiding.
		function tick(value: boolean, delayMs: number) {
			timeouts.push(
				setTimeout(() => {
					setWelcome(value)
					tick(!value, value ? 5_000 : 10_000)
				}, delayMs),
			)
		}

		// First appearance after a 10s grace period.
		tick(true, 10_000)

		return () => {
			for (const t of timeouts) clearTimeout(t)
		}
	}, [connected])

	return welcome
}
