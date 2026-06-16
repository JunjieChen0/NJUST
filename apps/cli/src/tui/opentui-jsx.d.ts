/**
 * Ambient JSX type extensions for OpenTUI intrinsic elements.
 *
 * OpenTUI ships its own JSX runtime (@opentui/solid/jsx-runtime) that
 * compiles tags like <box>, <text>, <scrollbox>, <textarea>, etc.
 * However, TypeScript does not automatically know about these custom
 * element types unless we declare them in JSX.IntrinsicElements.
 *
 * This file declares a permissive intrinsic interface so:
 *  - TS accepts any OpenTUI tag without a missing-element error
 *  - existing Box/Text/ScrollBox/Spinner wrapper components still type
 *    correctly via their explicit prop types
 */

import "solid-js"

declare module "solid-js" {
	namespace JSX {
		interface IntrinsicElements {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			[elemName: string]: any
		}
	}
}
