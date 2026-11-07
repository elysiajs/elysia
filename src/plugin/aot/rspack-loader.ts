import type { AotPluginHooks } from './hooks'

/**
 * Shared, same-process registry mapping an opaque token -> the plugin instance's
 * hooks. rspack loaders run in the same process as the plugin, so the plugin
 * registers its `hooks` under a per-instance token (see `rspack.ts`) and passes
 * the token through the rule's loader `options`; this loader looks it up here.
 *
 * This is the standard "loader can't close over plugin state, so pass a token
 * through options and resolve it from a module-global map" trick. Keyed per
 * plugin instance so concurrent compilers / multiple plugin instances don't
 * clobber each other.
 */
const registry = new Map<string, AotPluginHooks>()

export function registerAotHooks(token: string, hooks: AotPluginHooks) {
	registry.set(token, hooks)
}

export function unregisterAotHooks(token: string) {
	registry.delete(token)
}

interface AotLoaderContext {
	resourcePath: string
	getOptions(): { token?: string } | undefined
}

/**
 * webpack/rspack-style JS loader. Delegates to `hooks.transform`, which returns
 * `undefined` for any module it doesn't rewrite so the loader passes the source through unchanged.
 * `enforce: 'pre'` runs this before the swc/babel loaders, mirroring unplugin's `enforce: 'pre'`.
 */
export default function elysiaAotLoader(
	this: AotLoaderContext,
	source: string
) {
	const token = this.getOptions()?.token
	const hooks = token ? registry.get(token) : undefined

	return hooks?.transform(source, this.resourcePath) ?? source
}
