import type { BunPlugin } from 'bun'
import {
	generateCompiledModule,
	resolveEntry,
	resolveLoader,
	entryFilter,
	SEAL_DEFINE,
	SEAL_STUB_FILTER,
	sealStubSource,
	isElysiaImporter,
	type ElysiaAotOptions
} from './core'
import { rewriteTypeImport } from './treeshake'

const SOURCE = /\.(c|m)?(t|j)sx?$/

/**
 * Elysia AOT build plugin
 *
 * Run Elysia JIT compilation in build time instead of runtime
 *
 * Relative entry is resolved by the nearest `package.json`
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
		// best-effort: `seal` is true only when coverage reached 100% (else the
		// build keeps TypeBox + warns — see compileToSource)
		const { source, seal } = await generateCompiledModule(entry, options)
		const entryPath = resolveEntry(entry)
		const treeShake = options?.treeShake ?? true

		if (seal) {
			build.config.define = {
				...(build.config.define ?? {}),
				...SEAL_DEFINE
			}

			// replace typebox/compile, typebox/value with void 0 to avoid typebox deps in runtime
			build.onResolve({ filter: SEAL_STUB_FILTER }, (args) =>
				isElysiaImporter(args.importer)
					? { path: args.path, namespace: 'elysia-seal-stub' }
					: undefined
			)

			build.onLoad(
				{ namespace: 'elysia-seal-stub', filter: /.*/ },
				(args) => ({
					contents: sealStubSource(args.path),
					loader: 'js'
				})
			)
		}

		build.onResolve({ filter: /^elysia\/compiled$/ }, () => ({
			path: 'manifest',
			namespace: 'elysia-aot'
		}))

		build.onLoad({ namespace: 'elysia-aot', filter: /.*/ }, () => ({
			contents: source,
			loader: 'js'
		}))

		if (treeShake)
			build.onLoad({ filter: SOURCE }, async (args) => {
				if (args.path.includes('/node_modules/')) return

				const original = await Bun.file(args.path).text()
				let contents = rewriteTypeImport(original, {
					from: options?.registerFrom
				})

				if (args.path === entryPath)
					contents = `import 'elysia/compiled'\n${contents}`

				if (contents === original) return

				return { contents, loader: resolveLoader(args.path) }
			})
		else
			build.onLoad({ filter: entryFilter(entryPath) }, async (args) => {
				const original = await Bun.file(args.path).text()
				return {
					contents: `import 'elysia/compiled'\n${original}`,
					loader: resolveLoader(args.path)
				}
			})
	}
})
