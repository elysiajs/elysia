import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'

import { flushMemory } from '../../memory'
import { flattenChain } from '../../utils'

import type { AnyElysia } from '../../base'

function collectStaticRoutes(app: AnyElysia) {
	const hook = flattenChain(app['~ext']?.hookChain)
	if (
		hook &&
		(hook?.request?.length ||
			hook?.error?.length ||
			hook?.afterResponse?.length ||
			hook?.trace?.length)
	)
		return

	void app.fetch
	const source = app['~staticResponse']
	if (!source) return

	const ready: Record<string, Record<string, Response>> = {}
	const pending: Array<Promise<void>> = []

	for (const rawPath in source) {
		// Bun matches the request URL's encoded form against the keys in
		// `routes`. Paths registered with non-ASCII characters
		// (e.g. `/สวัสดี`) need `encodeURI` here or they won't match incoming requests.
		const path = encodeURI(rawPath)

		const methods = source[rawPath]
		for (const method in methods) {
			const value = methods[method]
			if (value instanceof Promise) {
				pending.push(
					value.then(
						(resolved) => {
							if (!(resolved instanceof Response)) return
							;(ready[path] ??= {})[method] = resolved
						},
						(err) => {
							console.error(
								`[Elysia] Static route ${method} ${path} failed to resolve:`,
								err
							)
						}
					)
				)
			} else {
				;(ready[path] ??= {})[method] = value
			}
		}
	}

	return [ready, pending] as const
}

export const BunAdapter = createAdapter({
	...WebStandardAdapter,
	name: 'bun',
	runtime: 'bun',
	listen(app, options, callback) {
		const staticRoutes = collectStaticRoutes(app as AnyElysia)

		const serveOptions =
			typeof options === 'object'
				? Object.assign(options, {
						fetch: app.fetch,
						routes: staticRoutes?.[0],
						reusePort: true
					} as any)
				: {
						port: +options,
						fetch: app.fetch,
						routes: staticRoutes?.[0],
						reusePort: true
					}

		const server = (app.server = Bun.serve(serveOptions))

		if (staticRoutes?.[1].length)
			Promise.all(staticRoutes?.[1]).then(() => {
				server.reload({
					routes: staticRoutes?.[0],
					fetch: app.fetch
				} as any)
			})

		flushMemory(app)

		callback?.(server)
	}
})
