import { realpathSync } from 'node:fs'
import type { BunPlugin } from 'bun'
import {
	generateCompiledArtifacts,
	resolveEntry,
	resolveLoader,
	entryFilter,
	STUB_SOURCES,
	type StubPlan,
	type ElysiaAotOptions
} from './core'
import { rewriteTypeImport } from './treeshake'

// eslint-disable-next-line sonarjs/single-character-alternation
const SOURCE = /\.(c|m)?(t|j)sx?$/

const realPath = (path: string) => {
	try {
		return realpathSync(path)
	} catch {
		return path
	}
}

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
		const { source, stub } = await generateCompiledArtifacts(entry, options)
		const entryPath = resolveEntry(entry)
		const entryReal = realPath(entryPath)
		const treeShake = options?.treeShake ?? true

		const isEntry = (path: string): boolean =>
			path === entryPath || realPath(path) === entryReal

		build.onResolve({ filter: /^elysia\/compiled$/ }, () => ({
			path: 'manifest',
			namespace: 'elysia-aot'
		}))

		build.onLoad({ namespace: 'elysia-aot', filter: /.*/ }, () => ({
			contents: source,
			loader: 'js'
		}))

		// Stub when every route is compiled
		for (const key of Object.keys(STUB_SOURCES) as (keyof StubPlan)[]) {
			if (!stub[key]) continue

			for (const { filter, source: stubSource } of STUB_SOURCES[key])
				build.onLoad({ filter }, () => ({
					contents: stubSource,
					loader: 'js'
				}))
		}

		if (treeShake)
			build.onLoad({ filter: SOURCE }, async (args) => {
				const isEntryFile = isEntry(args.path)
				const inModules = args.path.includes('/node_modules/')
				if (inModules && !isEntryFile) return

				const original = await Bun.file(args.path).text()
				let contents = inModules
					? original
					: rewriteTypeImport(original)

				if (isEntryFile)
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
