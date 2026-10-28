import { createAotPluginHooks, type AotPluginHooks } from './hooks'
import type { ElysiaAotOptions } from './core'

export interface ElysiaAotVitePlugin
	extends Omit<AotPluginHooks, 'isTransformCandidate'> {
	name: string
	enforce?: 'pre'
	apply?: 'build'
	applyToEnvironment?(environment: {
		config: { command: 'build' | 'serve'; consumer: 'client' | 'server' }
	}): boolean
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
		applyToEnvironment(environment) {
			// Cloudflare builds public assets in a separate client graph.
			// Dev still needs the client buildStart hook to capture the app.
			return (
				options?.target !== 'workerd' ||
				environment.config.command !== 'build' ||
				environment.config.consumer === 'server'
			)
		},
		buildStart: hooks.buildStart,
		buildEnd: hooks.buildEnd,
		resolveId: hooks.resolveId,
		load: hooks.load,
		transform: hooks.transform
	}
}
