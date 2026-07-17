import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createAotPluginHooks, setupAotOnLoad } from './hooks'
import { resolveEntry, type ElysiaAotOptions } from './core'

/**
 * Elysia AOT build plugin
 *
 * Run Elysia JIT compilation in build time instead of runtime
 *
 * ```ts
 * import * as esbuild from 'esbuild'
 * import { aot } from 'elysia/plugin/aot/esbuild'
 *
 * await esbuild.build({
 *   entryPoints: ['src/index.ts'],
 *   bundle: true,
 *   outfile: 'dist/index.js',
 *   plugins: [aot('src/index.ts')]
 * })
 *
 * process.exit(0)
 * ```
 */
export const aot = (entry: string, options?: ElysiaAotOptions) => ({
	name: 'elysia-aot',
	async setup(build: any) {
		const hooks = createAotPluginHooks(entry, options)
		let initial = true

		build.onStart(async () => {
			if (initial) {
				initial = false
				return
			}

			await hooks.buildStart()
		})

		await setupAotOnLoad(build, hooks, {
			readText: (path) => readFile(path, 'utf8'),
			resolveDir: dirname(resolveEntry(entry))
		})
	}
})
