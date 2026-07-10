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
		const entryPath = resolveEntry(entry)
		const resolveDir = dirname(entryPath)

		const box = await generateCompiledArtifacts(entry, options)

		build.onStart(async () => {
			const fresh = await generateCompiledArtifacts(entry, options)

			box.source = fresh.source
			box.stub = fresh.stub
			box.virtualType = fresh.virtualType
		})

		const MANIFEST_NS = 'elysia-aot'
		const VIRTUAL_TYPE_NS = 'elysia-aot-type'

		const manifestLoader = () => ({ contents: box.source, loader: 'js', resolveDir })
		const virtualTypeLoader = () => ({ contents: box.virtualType, loader: 'js', resolveDir })

		const buildProxy: any = new Proxy(build, {
			get(target, prop) {
				if (prop !== 'onLoad') return target[prop]

				return (
					filter: { filter: RegExp; namespace?: string },
					cb: (...args: unknown[]) => unknown
				) => {
					if (filter.namespace === MANIFEST_NS)
						return target.onLoad(filter, manifestLoader)

					if (filter.namespace === VIRTUAL_TYPE_NS)
						return target.onLoad(filter, virtualTypeLoader)

					return target.onLoad(filter, cb)
				}
			}
		})

		await setupAotHooks({
			readText: (path) => readFile(path, 'utf8'),
			entryPath,
			source: box.source,
			stub: box.stub,
			treeShake: options?.treeShake ?? true,
			virtualType: box.virtualType,
			resolveDir,
			build: buildProxy
		})
	}
})
