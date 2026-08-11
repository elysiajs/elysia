import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createAotPluginHooks, setupAotOnLoad } from './hooks'
import {
	resolveEntry,
	resolveEntryModuleKind,
	type ElysiaAotOptions
} from './core'

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
		const entryPath = resolveEntry(entry)
		const moduleCondition = resolveEntryModuleKind(entryPath)
		if (build.initialOptions?.conditions?.includes('types'))
			throw new Error(
				"[elysia-aot] esbuild conditions includes 'types'; this selects declaration files as runtime inputs. Remove the conflicting condition."
			)
		if (
			moduleCondition === 'cjs' &&
			build.initialOptions?.conditions?.includes('import')
		)
			throw new Error(
				"[elysia-aot] esbuild conditions includes 'import' for a CommonJS entry; this would load two Elysia module instances. Remove the conflicting condition."
			)

		const hooks = createAotPluginHooks(entry, options, moduleCondition)
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
			resolveDir: dirname(entryPath)
		})

		const allowedKinds =
			moduleCondition === 'cjs'
				? new Set(['require-call', 'require-resolve'])
				: new Set(['import-statement', 'dynamic-import'])
		build.onResolve(
			{ filter: /^elysia(?:\/.*)?$/ },
			(args: { kind: string; path: string }) =>
				allowedKinds.has(args.kind)
					? undefined
					: {
							errors: [
								{
									text:
										`[elysia-aot] ${args.path} uses esbuild edge kind ${JSON.stringify(args.kind)}, ` +
										`which conflicts with the ${JSON.stringify(moduleCondition)} entry module condition. ` +
										'Use one consistent import/require condition for Elysia.'
								}
							]
						}
		)
	}
})
