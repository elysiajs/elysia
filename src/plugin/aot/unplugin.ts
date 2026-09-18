import { createAotPluginHooks } from './hooks'
import type { ElysiaAotOptions } from './core'

export interface ElysiaAotUnpluginOptions extends ElysiaAotOptions {
	/**
	 * Build entrypoint. Resolved by the nearest `package.json`. Must be the
	 * module that exports the Elysia app the plugin compiles.
	 */
	entry: string
}

export interface ElysiaAotUnpluginFactoryResult {
	name: string
	enforce?: 'pre' | 'post'
	buildStart?: () => Promise<void>
	buildEnd?: () => void
	resolveId?: (id: string) => string | undefined
	load?: (id: string) => string | undefined
	transformInclude?: (id: string) => boolean
	transform?: (
		code: string,
		id: string
	) => string | undefined | Promise<string | undefined>
	/** Vite-specific override (`apply: 'build'` keeps dev on runtime JIT). */
	vite?: { apply?: 'build' | 'serve' }
	/** rspack compiler hook: forces the manifest module side-effectful. */
	rspack?: (compiler: unknown) => void
	/** webpack compiler hook: forces the manifest module side-effectful. */
	webpack?: (compiler: unknown) => void
}

const cleanIdOf = (id: string): string => id.split('?', 1)[0]

const VIRTUAL_MANIFEST_RESOURCE = /%00elysia%2Fcompiled/

interface RulesCompiler {
	options: { module: { rules: unknown[] } }
}

const forceManifestSideEffect = (compiler: RulesCompiler) => {
	compiler.options.module.rules.push({
		test: VIRTUAL_MANIFEST_RESOURCE,
		sideEffects: true
	})
}

/**
 * Elysia AOT build plugin factory (universal)
 *
 * Run Elysia JIT compilation in build time instead of runtime
 *
 * ```ts
 * import { createUnplugin } from 'unplugin'
 * import { aotFactory } from 'elysia/plugin/aot/unplugin'
 *
 * const aot = createUnplugin(aotFactory)
 *
 * // webpack.config.js  → aot.webpack({ entry: 'src/index.ts' })
 * // rollup.config.js   → aot.rollup({ entry: 'src/index.ts' })
 * // farm.config.ts     → aot.farm({ entry: 'src/index.ts' })
 * ```
 *
 * For rspack, prefer the native `elysia/plugin/aot/rspack` plugin
 * (no `unplugin` needed); for Vite prefer `elysia/plugin/aot/vite`
 */
export const aotFactory = (
	options: ElysiaAotUnpluginOptions
): ElysiaAotUnpluginFactoryResult => {
	const { entry, ...rest } = options
	const hooks = createAotPluginHooks(entry, rest)

	return {
		name: 'elysia-aot',
		enforce: 'pre',
		buildStart: hooks.buildStart,
		buildEnd: hooks.buildEnd,
		resolveId(id) {
			return hooks.resolveId(id) ?? undefined
		},
		load(id) {
			return hooks.load(id) ?? undefined
		},
		// required so webpack/rspack don't pipe every module through the loader.
		transformInclude(id) {
			return hooks.isTransformCandidate(cleanIdOf(id))
		},
		transform(code, id) {
			return hooks.transform(code, id)
		},
		// Framework-specific override: preserve the native Vite plugin's
		// `apply: 'build'` (Vite dev keeps the runtime JIT path).
		vite: {
			apply: 'build'
		},
		// webpack/rspack production DCE prunes the side-effect-only virtual
		// manifest import unless a module rule marks it side-effectful. These
		// per-bundler hooks fire after unplugin has installed its own load rule
		// (so the rule ordering is fine) and only touch the compiled-manifest
		// virtual resource vite/esbuild/bun never run these keys, so their
		// injected import stays byte-identical.
		rspack(compiler) {
			forceManifestSideEffect(compiler as RulesCompiler)
		},
		webpack(compiler) {
			forceManifestSideEffect(compiler as RulesCompiler)
		}
	}
}

export default aotFactory
