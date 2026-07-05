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
 */
export const aot = (entry: string, options?: ElysiaAotOptions) => ({
	name: 'elysia-aot',
	async setup(build: any) {
		const { source, stub, virtualType } = await generateCompiledArtifacts(
			entry,
			options
		)
		const entryPath = resolveEntry(entry)

		await setupAotHooks({
			readText: (path) => readFile(path, 'utf8'),
			entryPath,
			source,
			stub,
			treeShake: options?.treeShake ?? true,
			virtualType,
			// esbuild needs resolveDir so relative imports in the emitted manifest
			// resolve correctly against the entry directory
			resolveDir: dirname(entryPath),
			build
		})
	}
})
