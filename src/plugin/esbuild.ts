import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
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
 * import * as esbuild from 'esbuild'
 * import { elysiaAot } from 'elysia/plugin/esbuild'
 *
 * await esbuild.build({
 *   entryPoints: ['src/index.ts'],
 *   bundle: true,
 *   outfile: 'dist/index.js',
 *   plugins: [elysiaAot('src/index.ts')]
 * })
 * ```
 */
export const aot = (
	entry: string,
	options?: ElysiaAotOptions
) => ({
	name: 'elysia-aot',
	async setup(build: any	) {
		const source = await generateCompiledModule(entry, options)
		const entryPath = resolveEntry(entry)
		const loader = resolveLoader(entryPath)

		build.onResolve({ filter: /^elysia\/compiled$/ }, () => ({
			path: 'manifest',
			namespace: 'elysia-aot'
		}))

		build.onLoad({ filter: /.*/, namespace: 'elysia-aot' }, () => ({
			contents: source,
			loader: 'js',
			resolveDir: dirname(entryPath)
		}))

		build.onLoad(
			{ filter: entryFilter(entryPath) },
			async (args: { path: string }) => ({
				contents: `import 'elysia/compiled'\n${await readFile(args.path, 'utf8')}`,
				loader
			})
		)
	}
})
