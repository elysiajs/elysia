import { createAotPluginHooks } from './hooks'
import type { ElysiaAotOptions } from './core'

export interface ElysiaAotVitePlugin {
	name: string
	enforce?: 'pre'
	apply?: 'build'
	configResolved?(config: { command: string }): void
	buildStart(): Promise<void>
	buildEnd(): void
	resolveId(id: string): string | undefined
	load(id: string): string | undefined
	transform(
		code: string,
		id: string
	): string | undefined | Promise<string | undefined>
}

/**
 * Elysia AOT build plugin
 *
 * Run Elysia JIT compilation in build time instead of runtime
 *
 * ```ts
 * import { defineConfig } from 'vite'
 * import { aot } from 'elysia/plugin/aot/vite'
 *
 * export default defineConfig({
 *   plugins: [aot('src/index.ts')]
 * })
 * ```
 */
export const aot = (
	entry: string,
	options?: ElysiaAotOptions
): ElysiaAotVitePlugin => {
	const hooks = createAotPluginHooks(entry, options)

	// workerd bans runtime codegen (`new Function`), so a workerd target must
	// run the AOT manifest in `vite dev` too — `core.ts` already refuses to
	// build a workerd bundle whose JIT is reachable. Every other target keeps
	// the runtime JIT path in dev.
	const runsInDev = options?.target === 'workerd'
	let serving = false

	return {
		name: 'elysia-aot',
		enforce: 'pre',
		...(runsInDev ? {} : { apply: 'build' as const }),
		configResolved(config) {
			serving = config.command === 'serve'
		},
		buildStart: hooks.buildStart,
		buildEnd() {
			// `serve` calls buildEnd on server close; the entry may never have
			// been requested, which is expected (not the `build` invariant).
			if (!serving) hooks.buildEnd()
		},
		resolveId: hooks.resolveId,
		load: hooks.load,
		transform: hooks.transform
	}
}
