import type { Serve } from 'bun'

import { createNativeStaticHandler } from './handler'

import { isProduction } from '../../error'
import { hasHeaderShorthand, isNumericString } from '../../utils'
import { websocket } from '../../ws'

import type { ElysiaAdapter } from '../types'

import { WebStandardAdapter } from '../web-standard'

export const BunAdapter: ElysiaAdapter = {
	...WebStandardAdapter,
	handler: {
		...WebStandardAdapter.handler,
		createNativeStaticHandler
	},
	composeHandler: {
		...WebStandardAdapter.composeHandler,
		headers: hasHeaderShorthand
			? 'c.headers = c.request.headers.toJSON()\n'
			: 'c.headers = {}\n' +
				'for (const [key, value] of c.request.headers.entries())' +
				'c.headers[key] = value\n'
	},
	listen(app) {
		return (options, callback) => {
			if (typeof Bun === 'undefined')
				throw new Error(
					'.listen() is designed to run on Bun only. If you are running Elysia in other environment please use a dedicated plugin or export the handler via Elysia.fetch'
				)

			app.compile()

			if (typeof options === 'string') {
				if (!isNumericString(options))
					throw new Error('Port must be a numeric value')

				options = parseInt(options)
			}

			const fetch = app.fetch

			const serve =
				typeof options === 'object'
					? ({
							development: !isProduction,
							reusePort: true,
							...(app.config.serve || {}),
							...(options || {}),
							// @ts-ignore
							static: app.router.static.http.static,
							websocket: {
								...(app.config.websocket || {}),
								...(websocket || {})
							},
							fetch,
							// @ts-expect-error private property
							error: app.outerErrorHandler
						} as Serve)
					: ({
							development: !isProduction,
							reusePort: true,
							...(app.config.serve || {}),
							// @ts-ignore
							static: app.router.static.http.static,
							websocket: {
								...(app.config.websocket || {}),
								...(websocket || {})
							},
							port: options,
							fetch,
							// @ts-expect-error private property
							error: app.outerErrorHandler
						} as Serve)

			app.server = Bun?.serve(serve)

			for (let i = 0; i < app.event.start.length; i++)
				app.event.start[i].fn(this)

			if (callback) callback(app.server!)

			process.on('beforeExit', () => {
				if (app.server) {
					app.server.stop()
					app.server = null

					for (let i = 0; i < app.event.stop.length; i++)
						app.event.stop[i].fn(this)
				}
			})

			// @ts-expect-error private
			app.promisedModules.then(() => {
				Bun?.gc(false)
			})
		}
	}
}
