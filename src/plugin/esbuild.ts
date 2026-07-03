import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
	generateCompiledArtifacts,
	resolveEntry,
	setupAotHooks,
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

		await setupAotHooks({
			readText: (path) => readFile(path, 'utf8'),
			entryPath,
			source,
			stub,
			treeShake: options?.treeShake ?? true,
			// esbuild needs resolveDir so relative imports in the emitted manifest
			// resolve correctly against the entry directory
			resolveDir: dirname(entryPath),
			build
		})
	}
})
