import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'

import { flushMemory } from '../../memory'
import { flattenChain } from '../../utils'

import { buildGlobalWSHandler } from '../../ws/route'

import type { AnyElysia } from '../../base'

function collectStaticRoutes(app: AnyElysia) {
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

	const ready: Record<string, Record<string, Response>> = {}
	const pending: Array<Promise<void>> = []

	for (const rawPath in source) {
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
		const serve = (
			typeof options === 'object' ? options : { port: +options }
		) as any

		const hasWs = app['~hasWS']

		app.server = Bun.serve({
			...serve,
			fetch: (request) => app.fetch(request)
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

			const staticRoutes = collectStaticRoutes(app as AnyElysia)

			if (staticRoutes?.[1].length)
				Promise.all(staticRoutes?.[1]).then(() => {
					app.server!.reload(serve)
				})

			if (app.pending)
				app.modules.then(() => {
					app.server!.reload(serve)
				})

			flushMemory()

			if (hasWs) callback?.(app.server!)
		})
	}
})
