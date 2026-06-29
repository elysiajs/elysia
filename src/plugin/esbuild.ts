import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
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

const realPath = (path: string): string => {
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
 *
 * process.exit(0)
 * ```
 *
 * The plugin imports your entry to capture the compiled app, running its
 * top-level code. `.listen()` is auto-skipped during build (gated on
 * `ELYSIA_AOT_BUILD`), but any other import-time handle — a DB pool,
 * `setInterval`, a queue consumer — keeps the process alive after the bundle
 * is written. End the build script with `process.exit(0)` (the bundle is
 * already on disk), or gate the side effect with
 * `if (!process.env.ELYSIA_AOT_BUILD)`.
 */
export const aot = (entry: string, options?: ElysiaAotOptions) => ({
	name: 'elysia-aot',
	async setup(build: any) {
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

		build.onLoad({ filter: /.*/, namespace: 'elysia-aot' }, () => ({
			contents: source,
			loader: 'js',
			resolveDir: dirname(entryPath)
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
			// Broad load: rewrite `t` imports in every source file, claiming only
			// files we change (or the entry) so other plugins keep working.
			build.onLoad({ filter: SOURCE }, async (args: { path: string }) => {
				const isEntryFile = isEntry(args.path)
				const inModules = args.path.includes('/node_modules/')
				if (inModules && !isEntryFile) return

				const original = await readFile(args.path, 'utf8')
				let contents = inModules
					? original
					: rewriteTypeImport(original)

				if (isEntryFile)
					contents = `import 'elysia/compiled'\n${contents}`

				if (contents === original) return

				return { contents, loader: resolveLoader(args.path) }
			})
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
