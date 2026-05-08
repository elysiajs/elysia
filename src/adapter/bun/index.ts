import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'
import { mapStaticHandler } from './handler'

import { createRouteMap } from './utils'
import { flushMemory } from '../../memory'

import type { AnyElysia } from '../../base'

export const BunAdapter = createAdapter({
	...WebStandardAdapter,
	name: 'bun',
	runtime: 'bun',
	response: {
		...WebStandardAdapter.response,
		static: mapStaticHandler
	},
	listen(app, options, callback) {
		const [routes, fetch] = createRouteMap(app as AnyElysia)

		const serveOptions =
			typeof options === 'object'
				? Object.assign(options, {
						routes,
						fetch,
						reusePort: true
					} as any)
				: {
						port: +options,
						routes,
						fetch,
						reusePort: true
					}

		const server = (app.server = Bun.serve(serveOptions))

		if ((app as AnyElysia).pending) {
			;(app as AnyElysia).modules
				.catch((err) => {
					console.error(err)
				})
				.then(() => {
					const [nextRoutes, nextFetch] = createRouteMap(
						app as AnyElysia
					)

					app.server?.reload({
						...serveOptions,
						fetch: nextFetch,
						routes: nextRoutes
					} as any)

					flushMemory(app)
				})
		} else flushMemory(app)

		callback?.(server)
	}
})
