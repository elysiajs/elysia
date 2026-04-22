import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'
import {
	mapCompactResponse,
	mapEarlyResponse,
	mapResponse,
	mapStaticHandler
} from './handler'

import { clearSucroseCache } from '../../sucrose'
import { Validator } from '../../schema/validator'
import { createRouteMap } from './utils'

import type { AnyElysia } from '../..'

export const BunAdapter = createAdapter({
	...WebStandardAdapter,
	name: 'bun',
	runtime: 'bun',
	response: {
		map: mapResponse,
		compact: mapCompactResponse,
		early: mapEarlyResponse,
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

		callback?.(server)

		clearSucroseCache(0)
		Validator.clear()
		Bun.gc()
	}
})
