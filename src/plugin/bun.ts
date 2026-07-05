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
 */
export const aot = (entry: string, options?: ElysiaAotOptions): BunPlugin => ({
	name: 'elysia-aot',
	async setup(build) {
		const { source, stub, virtualType } = await generateCompiledArtifacts(
			entry,
			options
		)

		await setupAotHooks({
			readText: (path) => Bun.file(path).text(),
			entryPath: resolveEntry(entry),
			source,
			stub,
			treeShake: options?.treeShake ?? true,
			virtualType,
			// Bun resolves relative to the project root by default — no resolveDir needed
			resolveDir: undefined,
			build
		})
	}
})
