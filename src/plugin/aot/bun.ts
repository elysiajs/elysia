import type { BunPlugin } from 'bun'
import {
	createAotPluginHooks,
	createTypeboxWiringHooks,
	setupAotOnLoad
} from './hooks'
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
 *
 * Skip precompilation and only wire TypeBox statically for a faster plain bundle.
 * `TypeSystem.Locale` stays opt-in, as in a plain bundle.
 *
 * ```ts
 * plugins: [aot()]
 * ```
 */
export const aot = (entry?: string, options?: ElysiaAotOptions): BunPlugin => {
	if (entry === undefined && options !== undefined)
		throw new Error('[elysia-aot] options require an entry')

	return {
		name: 'elysia-aot',
		async setup(build) {
			// Bun resolves relative to the project root by default (no resolveDir)
			await setupAotOnLoad(
				build,
				entry === undefined
					? createTypeboxWiringHooks()
					: createAotPluginHooks(entry, options),
				(path) => Bun.file(path).text()
			)
		}
	}
}
