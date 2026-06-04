import type { BunPlugin } from 'bun'
import {
	generateCompiledModule,
	resolveEntry,
	resolveLoader,
	entryFilter,
	type ElysiaAotOptions
} from './core'

/**
 * Elysia AOT build plugin
 *
 * Run Elysia JIT compilation in build time instead of runtime
 *
 * ```ts
 * import { aot } from 'elysia/plugin/bun'
 *
 * await Bun.build({
 *   entrypoints: ['src/index.ts'],
 *   outdir: 'dist',
 *   plugins: [aot('src/index.ts')]
 * })
 * ```
 */
export const aot = (entry: string, options?: ElysiaAotOptions): BunPlugin => ({
	name: 'elysia-aot',
	async setup(build) {
		const source = await generateCompiledModule(entry, options)
		const entryPath = resolveEntry(entry)
		const loader = resolveLoader(entryPath)

		build.onResolve({ filter: /^elysia\/compiled$/ }, () => ({
			path: 'manifest',
			namespace: 'elysia-aot'
		}))

		build.onLoad({ namespace: 'elysia-aot', filter: /.*/ }, () => ({
			contents: source,
			loader: 'js'
		}))

		build.onLoad({ filter: entryFilter(entryPath) }, async (args) => {
			const original = await Bun.file(args.path).text()
			return {
				contents: `import 'elysia/compiled'\n${original}`,
				loader
			}
		})
	}
})
