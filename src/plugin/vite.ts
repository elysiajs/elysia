import {
	generateCompiledModule,
	resolveEntry,
	SEAL_DEFINE,
	SEAL_STUB_FILTER,
	sealStubSource,
	isElysiaImporter,
	type ElysiaAotOptions
} from './core'
import { rewriteTypeImport } from './treeshake'

const SOURCE = /\.(c|m)?(t|j)sx?$/

export interface ElysiaAotVitePlugin {
	name: string
	enforce?: 'pre'
	apply?: 'build'
	config?():
		| { define: Record<string, string> }
		| undefined
		| Promise<{ define: Record<string, string> } | undefined>
	buildStart(): Promise<void>
	resolveId(id: string, importer?: string): string | undefined
	load(id: string): string | undefined
	transform(code: string, id: string): string | undefined
}

const VIRTUAL = '\0elysia/compiled'
const STUB_PREFIX = '\0elysia-seal-stub:'

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
	// best-effort seal: config() (which decides the define) and buildStart()
	// share ONE compile, so coverage runs once and the seal decision is known
	// before resolveId gates the TypeBox stub
	let sealable = false
	let compiled: ReturnType<typeof generateCompiledModule> | undefined
	const getCompiled = () =>
		(compiled ??= generateCompiledModule(entry, options))

	return {
		name: 'elysia-aot',
		enforce: 'pre',
		apply: 'build',
		async config() {
			// Inject the define only when coverage is 100% clean (best-effort).
			// config() runs before resolveId, so `sealable` is set first.
			const r = await getCompiled()
			source = r.source
			sealable = r.seal
			if (sealable) return { define: { ...SEAL_DEFINE } }
		},
		async buildStart() {
			source = (await getCompiled()).source
		},
		resolveId(id, importer) {
			if (id === 'elysia/compiled') return VIRTUAL

			// Seal: redirect typebox/value|compile to the stub (Elysia importers
			// only), gated on the best-effort seal decision resolved in config()
			if (
				sealable &&
				SEAL_STUB_FILTER.test(id) &&
				isElysiaImporter(importer)
			)
				return STUB_PREFIX + id
		},
		load(id) {
			if (id === VIRTUAL) return source
			if (id.startsWith(STUB_PREFIX))
				return sealStubSource(id.slice(STUB_PREFIX.length))
		},
		transform(code, id) {
			let out = code
			if (treeShake && SOURCE.test(id) && !id.includes('node_modules'))
				out = rewriteTypeImport(out, { from: options?.registerFrom })
			if (id === entryPath) out = `import 'elysia/compiled'\n${out}`
			return out === code ? undefined : out
		}
	}
}
