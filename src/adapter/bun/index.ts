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

		const server = Bun.serve(
			typeof options === 'object'
				? ({
						...options,
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
		)

		flushMemory(app)

		callback?.(server)
	}
})
