import type { BunPlugin } from 'bun'
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
export const aot = (entry: string, options?: ElysiaAotOptions): BunPlugin => ({
	name: 'elysia-aot',
	async setup(build) {
		const { source, stub } = await generateCompiledArtifacts(entry, options)

		await setupAotHooks({
			readText: (path) => Bun.file(path).text(),
			entryPath: resolveEntry(entry),
			source,
			stub,
			treeShake: options?.treeShake ?? true,
			// Bun resolves relative to the project root by default — no resolveDir needed
			resolveDir: undefined,
			build
		})
	}
})
