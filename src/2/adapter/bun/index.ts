import { createAdapter } from '..'
import { WebStandardAdapter } from '../web-standard'
import { mapStaticHandler } from './handler'

import { clearSucroseCache } from '../../sucrose'
import { Validator } from '../../schema/validator'
import { createRouteMap } from './utils'

import type { AnyElysia } from '../..'
import { flushMemory } from '../../utils'

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

		callback?.(server)

		flushMemory(app)
	}
})
