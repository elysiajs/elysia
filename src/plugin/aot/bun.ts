import type { BunPlugin } from 'bun'
import { createAotPluginHooks, setupAotOnLoad } from './hooks'
import type { ElysiaAotOptions } from './core'

/**
 * Elysia AOT build plugin
 *
 * Run Elysia JIT compilation in build time instead of runtime
 *
 * Relative entry is resolved by the nearest `package.json`
 *
 * ```ts
 * import { aot } from 'elysia/plugin/aot/bun'
 *
 * await Bun.build({
 *   entrypoints: ['src/index.ts'],
 *   outdir: 'dist',
 *   plugins: [aot('src/index.ts')]
 * })
 *
 * process.exit(0)
 * ```
 */
export const aot = (entry: string, options?: ElysiaAotOptions): BunPlugin => ({
	name: 'elysia-aot',
	async setup(build) {
		await setupAotOnLoad(build, createAotPluginHooks(entry, options), {
			readText: (path) => Bun.file(path).text(),
			// Bun resolves relative to the project root by default
			resolveDir: undefined
		})
	}
})
