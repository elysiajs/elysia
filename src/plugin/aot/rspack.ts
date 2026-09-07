import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAotPluginHooks } from './hooks'
import { registerAotHooks, unregisterAotHooks } from './rspack-loader'
import { resolveEntry, siblingModuleExt } from './core'
import type { ElysiaAotOptions } from './core'


// mirror of the rspack `Compiler`
interface RspackModuleRule {
	test?: RegExp | ((value: string) => boolean)
	enforce?: 'pre' | 'post'
	use?: { loader: string; options?: Record<string, unknown> }[]
	sideEffects?: boolean
}

interface AsyncSeriesTap {
	tapPromise(name: string, fn: () => Promise<void>): void
}

interface RspackCompiler {
	options: {
		module: { rules: unknown[] }
		resolve: { alias?: Record<string, string | false | (string | false)[]> }
	}
	hooks: {
		beforeCompile: AsyncSeriesTap
		afterCompile: AsyncSeriesTap
	}
}

const PLUGIN = 'elysia-aot'

let tokenCounter = 0

// Rolldown rewrites `import.meta.url` to `pathToFileURL(__filename).href` in the
// CJS build, so this resolves the sibling `rspack-loader` file in both the
// `.mjs` and `.js` outputs (and the `.ts` source under the bun test runtime).
function loaderPath() {
	const moduleUrl = import.meta.url

	return resolve(
		dirname(fileURLToPath(moduleUrl)),
		'rspack-loader' + siblingModuleExt(moduleUrl)
	)
}

/**
 * Elysia AOT build plugin
 *
 * Run Elysia JIT compilation at build time instead of runtime.
 *
 * ```ts
 * // rspack.config.ts
 * import { aot } from 'elysia/plugin/aot/rspack'
 *
 * export default {
 *   plugins: [aot('src/index.ts')]
 * }
 * ```
 */
export const aot = (
	entry: string,
	options?: ElysiaAotOptions
): { name: string; apply(compiler: unknown): void } => {
	const hooks = createAotPluginHooks(entry, options)
	const entryPath = resolveEntry(entry)
	const token = `${PLUGIN}:${entryPath}:${tokenCounter++}`

	const cacheDir = join(
		process.cwd(),
		'node_modules',
		'.cache',
		'elysia-aot',
		// eslint-disable-next-line sonarjs/hashing
		createHash('sha1').update(entryPath).digest('hex').slice(0, 16)
	)

	const manifestFile = join(cacheDir, 'compiled.mjs')
	const typeFile = join(cacheDir, 'type.mjs')

	const apply = (rawCompiler: unknown): void => {
		const compiler = rawCompiler as RspackCompiler

		// Loader: shared transform for every candidate id (entry + elysia-owned).
		;(compiler.options.module.rules as RspackModuleRule[]).push({
			test: (id: string) =>
				hooks.isTransformCandidate(id.split('?', 1)[0]),
			enforce: 'pre',
			use: [{ loader: loaderPath(), options: { token } }]
		})

		// Keep production `sideEffects`/`usedExports` DCE from pruning the
		// side-effect-only `import 'elysia/compiled'`.
		;(compiler.options.module.rules as RspackModuleRule[]).push({
			test: (id: string) => id.split('?', 1)[0] === manifestFile,
			sideEffects: true
		})

		compiler.hooks.beforeCompile.tapPromise(PLUGIN, async () => {
			registerAotHooks(token, hooks)

			await hooks.buildStart()

			const source = hooks.load(hooks.resolveId('elysia/compiled')!)
			const typeId = hooks.resolveId('elysia/type')
			const virtualType =
				typeId === undefined ? undefined : hooks.load(typeId)

			mkdirSync(cacheDir, { recursive: true })
			writeFileSync(manifestFile, source ?? '')

			const resolveOptions = (compiler.options.resolve ??= {})
			const alias = (resolveOptions.alias ??= {})
			alias['elysia/compiled$'] = manifestFile

			if (virtualType !== undefined) {
				writeFileSync(typeFile, virtualType)
				alias['elysia/type$'] = typeFile
			} else delete alias['elysia/type$']
		})

		compiler.hooks.afterCompile.tapPromise(PLUGIN, async () => {
			try {
				hooks.buildEnd()
			} finally {
				unregisterAotHooks(token)
			}
		})
	}

	return { name: PLUGIN, apply }
}

export default aot
