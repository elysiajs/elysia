import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'

import { flushMemory } from '../../memory'
import { flattenChain, nullObject } from '../../utils'

import { buildGlobalWSHandler } from '../../ws/route'

import type { AnyElysia } from '../../base'

function collectStaticRoutes(app: AnyElysia) {
	if (app['~ext']?.hoc?.length) return

	const hook = flattenChain(app['~hookChain'])
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

	const ready: Record<string, Record<string, Response>> = nullObject()
	const pending: Array<Promise<void>> = []

	for (const rawPath in source) {
		const path = encodeURI(rawPath)

		const methods = source[rawPath]
		for (const method in methods) {
			const value = methods[method]

			if (value instanceof Promise)
				pending.push(
					value.then(
						(resolved) => {
							if (resolved instanceof Response)
								(ready[path] ??= nullObject())[method] =
									resolved
						},
						(err) => {
							console.error(
								`[Elysia] Static route ${method} ${path} failed to resolve:`,
								err
							)
						}
					)
				)
			else (ready[path] ??= nullObject())[method] = value
		}
	}

	return [ready, pending] as const
}

export const BunAdapter = createAdapter({
	...WebStandardAdapter,
	name: 'bun',
	runtime: 'bun',
	listen(app, options, callback) {
		const serve = (
			typeof options === 'object' ? options : { port: +options }
		) as any

		const hasWs = app['~hasWS']

		app.server = Bun.serve({
			...serve,
			// lazy init fetch
			fetch: (request, server) => app.fetch(request, server)
		})

		if (!hasWs) callback?.(app.server!)

		// optimize router, static route, etc.
		queueMicrotask(() => {
			serve.fetch = app.fetch

			if (hasWs) {
				const defaultConfig = (app['~config'] as any)?.websocket

				serve.websocket = defaultConfig
					? Object.assign(buildGlobalWSHandler(), defaultConfig)
					: buildGlobalWSHandler()
			}

			if (app.server) app.server.reload(serve)
			else app.server = Bun.serve(serve)

			const collectRoutes = () => {
				const staticRoutes = collectStaticRoutes(app as AnyElysia)
				if (!staticRoutes) return

				if (staticRoutes[1].length)
					return Promise.all(staticRoutes[1]).then(() => {
						serve.routes = staticRoutes[0]
						app.server!.reload(serve)
					})

				// All static responses were synchronous (the common case):
				// `pending` is empty, so previously `serve.routes` was never
				// assigned and Bun.serve's native static-route dispatch was
				// dead — every static route fell through to the JS fetch
				// handler. Install them synchronously here. Returning a truthy
				// sentinel tells the caller a reload already happened.
				if (Object.keys(staticRoutes[0]).length) {
					serve.routes = staticRoutes[0]
					app.server!.reload(serve)
					return true
				}
			}

			if (app.pending) {
				const reloadAfterModules = () => {
					serve.fetch = app.fetch

					const routes = collectRoutes()

					if (!routes) app.server!.reload(serve)
				}

				app.modules.then(reloadAfterModules, reloadAfterModules)
			} else collectRoutes()

			flushMemory()

			if (hasWs) callback?.(app.server!)
		})
	}
})
