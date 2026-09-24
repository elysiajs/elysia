import type { TypeboxNamespaces } from './typebox-value'

/**
 * Literal `require` / `import()` so bundlers embed TypeBox (still evaluated
 * lazily) and both resolve to that one embedded copy
 *
 * The AOT build plugin always stubs this module to `() => undefined`: sealed
 * builds must keep TypeBox out, other modes re-route `typebox-value` to `-live`
 */
/* eslint-disable @typescript-eslint/no-require-imports -- lazy load bundlers can follow */
export const requireTypebox = (): TypeboxNamespaces | undefined => {
	// a foreign global `require` that throws falls back to the caller's loader
	if (typeof require === 'function')
		try {
			return {
				value: require('typebox/value'),
				schema: require('typebox/schema'),
				compile: require('typebox/compile')
			}
		} catch {}
}

// A computed specifier here made bundled servers load a second, unbundled
// TypeBox from node_modules on listen (+40 ms, +20 MB)
export const importTypebox = () =>
	Promise.all([
		import('typebox/type'),
		import('typebox/system'),
		import('typebox/value'),
		import('typebox/schema'),
		import('typebox/compile')
	])
