import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'
import { mapStaticHandler } from './handler'

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
		// No meaningful performance gain tbh 1-2% but use 2.5x more memory
		// const [routes, fetch] = createRouteMap(app as AnyElysia)

		const serveOptions =
			typeof options === 'object'
				? Object.assign(options, {
						fetch: app.fetch,
						reusePort: true
					} as any)
				: {
						port: +options,
						fetch: app.fetch,
						reusePort: true
					}

		const server = (app.server = Bun.serve(serveOptions))

		flushMemory(app)

		callback?.(server)
	}
})
