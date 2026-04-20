import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'

import { createRouteMap } from './utils'
import type { AnyElysia } from '../..'

export const BunAdapter = createAdapter({
	...WebStandardAdapter,
	name: 'bun',
	runtime: 'bun',
	listen(app, options, callback) {
		const routes = createRouteMap(app as AnyElysia)

		const server = Bun.serve(
			typeof options === 'object'
				? ({
						...options,
						routes
					} as any)
				: {
						port: +options,
						routes
					}
		)

		callback?.(server)
	}
})
