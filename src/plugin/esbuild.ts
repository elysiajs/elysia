import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
	generateCompiledModule,
	resolveEntry,
	resolveLoader,
	entryFilter,
	SEAL_DEFINE,
	type ElysiaAotOptions
} from './core'
import { rewriteTypeImport } from './treeshake'

const SOURCE = /\.(c|m)?(t|j)sx?$/

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
		const treeShake = options?.treeShake ?? true

		if (options?.seal) {
			build.initialOptions.define = {
				...build.initialOptions.define,
				...SEAL_DEFINE
			}

			// Under seal, every typebox/value + typebox/compile USE folds away
			// (SEAL_DEFINE in form-B/ternary branches), but esbuild only
			// tree-shakes the import EDGE if it knows the module is side-effect
			// free — and typebox ships no `sideEffects:false`. Mark the entry
			// barrels so the now-dead imports drop, taking the ~49 KB raw /
			// 12 KB gzip value+compile graph with them.
			build.onResolve(
				{ filter: /^typebox\/(value|compile)(\/|$)/ },
				async (args: any) => {
					if (args.pluginData?.elysiaSeal) return null // re-entry guard
					const resolved = await build.resolve(args.path, {
						kind: args.kind,
						resolveDir: args.resolveDir,
						importer: args.importer,
						pluginData: { elysiaSeal: true }
					})
					if (resolved.errors.length) return resolved
					return { path: resolved.path, sideEffects: false }
				}
			)
		}

		build.onResolve({ filter: /^elysia\/compiled$/ }, () => ({
			path: 'manifest',
			namespace: 'elysia-aot'
		}))

		build.onLoad({ filter: /.*/, namespace: 'elysia-aot' }, () => ({
			contents: source,
			loader: 'js',
			resolveDir: dirname(entryPath)
		}))

		if (treeShake)
			// Broad load: rewrite `t` imports in every source file, claiming only
			// files we change (or the entry) so other plugins keep working.
			build.onLoad(
				{ filter: SOURCE },
				async (args: { path: string }) => {
					if (args.path.includes('/node_modules/')) return
					const original = await readFile(args.path, 'utf8')
					let contents = rewriteTypeImport(original, {
						from: options?.registerFrom
					})
					if (args.path === entryPath)
						contents = `import 'elysia/compiled'\n${contents}`
					if (contents === original) return
					return { contents, loader: resolveLoader(args.path) }
				}
			)
		else
			build.onLoad(
				{ filter: entryFilter(entryPath) },
				async (args: { path: string }) => ({
					contents: `import 'elysia/compiled'\n${await readFile(args.path, 'utf8')}`,
					loader: resolveLoader(args.path)
				})
			)
	}
})
