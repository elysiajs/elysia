import {
	generateCompiledArtifacts,
	resolveEntry,
	STUB_SOURCES,
	type StubPlan,
	type ElysiaAotOptions
} from './core'
import { rewriteTypeImport } from './treeshake'

const SOURCE = /\.(c|m)?(t|j)sx?$/

export interface ElysiaAotVitePlugin {
	name: string
	enforce?: 'pre'
	apply?: 'build'
	buildStart(): Promise<void>
	resolveId(id: string): string | undefined
	load(id: string): string | undefined
	transform(code: string, id: string): string | undefined
}

const VIRTUAL = '\0elysia/compiled'

/**
 * Elysia AOT build plugin
 *
 * Run Elysia JIT compilation in build time instead of runtime
 *
 * ```ts
 * import { defineConfig } from 'vite'
 * import { aot } from 'elysia/plugin/vite'
 *
 * export default defineConfig({
 *   plugins: [aot('src/index.ts')]
 * })
 * ```
 */
export const aot = (
	entry: string,
	options?: ElysiaAotOptions
): ElysiaAotVitePlugin => {
	const entryPath = resolveEntry(entry)
	const treeShake = options?.treeShake ?? true
	let source = ''
	let stub: StubPlan = {
		jit: false,
		ws: false,
		reconstruct: false,
		cookie: false
	}

	return {
		name: 'elysia-aot',
		enforce: 'pre',
		apply: 'build',
		async buildStart() {
			const generated = await generateCompiledArtifacts(entry, options)
			source = generated.source
			stub = generated.stub
		},
		resolveId(id) {
			if (id === 'elysia/compiled') return VIRTUAL
		},
		load(id) {
			if (id === VIRTUAL) return source
		},
		transform(code, id) {
			// Stub when every route is compiled
			for (const key of Object.keys(STUB_SOURCES) as (keyof StubPlan)[]) {
				if (!stub[key]) continue
				for (const { filter, source: stubSource } of STUB_SOURCES[key])
					if (filter.test(id)) return stubSource
			}

			let out = code
			if (treeShake && SOURCE.test(id) && !id.includes('node_modules'))
				out = rewriteTypeImport(out)

			if (id === entryPath) out = `import 'elysia/compiled'\n${out}`
			return out === code ? undefined : out
		}
	}
}
