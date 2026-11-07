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
//
// One at a time, smallest graph first (system ⊂ type ⊂ value): parallel roots
// fan out all ~680 modules at once, ~2 MB more RSS and ~12 ms slower on Bun
export const importTypebox: () =>
	| Promise<[TypeboxTypeNamespaces, TypeboxNamespaces]>
	| undefined = async () => {
	const system = await import('./typebox-system-lite')
	const type = await import('typebox/type')
	const ops = await import('./typebox-value-ops')

	return [{ type, system }, fromOps(ops)]
}
