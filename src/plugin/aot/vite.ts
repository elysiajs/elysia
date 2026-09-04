import { createAotPluginHooks } from './hooks'
import type { ElysiaAotOptions } from './core'

export interface ElysiaAotVitePlugin {
	name: string
	enforce?: 'pre'
	apply?: 'build'
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

	return {
		name: 'elysia-aot',
		enforce: 'pre',
		apply: 'build',
		buildStart: hooks.buildStart,
		buildEnd: hooks.buildEnd,
		resolveId: hooks.resolveId,
		load: hooks.load,
		transform: hooks.transform
	}
}
