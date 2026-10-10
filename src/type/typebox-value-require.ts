import type { TypeboxNamespaces } from './typebox-value'
import type { TypeboxTypeNamespaces } from './typebox-type'

const fromOps = (
	ops: typeof import('./typebox-value-ops')
): TypeboxNamespaces => ({
	value: ops,
	schema: { Compile: ops.SchemaCompile, Build: ops.Build },
	compile: { Compile: ops.Compile }
})

/* eslint-disable @typescript-eslint/no-require-imports -- lazy load bundlers can follow */
export const requireTypebox = (): TypeboxNamespaces | undefined => {
	// a foreign global `require` that throws falls back to the caller's loader
	if (typeof require === 'function')
		try {
			return fromOps(require('./typebox-value-ops'))
		} catch {}
}

// A computed specifier here made bundled servers load a second, unbundled
// TypeBox from node_modules on listen (+40 ms, +20 MB)
export const importTypebox = ():
	| Promise<[TypeboxTypeNamespaces, TypeboxNamespaces]>
	| undefined =>
	Promise.all([
		import('typebox/type'),
		import('./typebox-system-lite'),
		import('./typebox-value-ops')
	]).then(([type, system, ops]) => [{ type, system }, fromOps(ops)])
