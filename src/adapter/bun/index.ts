/* eslint-disable sonarjs/no-duplicate-string */
import type { Serve } from 'bun'
import type { TSchema } from '@sinclair/typebox'

import { WebStandardAdapter } from '../web-standard/index'
import { parseSetCookies } from '../web-standard/handler'
import type { ElysiaAdapter } from '../types'

import { createNativeStaticHandler } from './handler'
import { serializeCookie } from '../../cookies'
import { isProduction, ValidationError } from '../../error'
import {
	getSchemaValidator,
	hasHeaderShorthand,
	isNotEmpty,
	isNumericString,
	randomId
} from '../../utils'

import {
	createHandleWSResponse,
	createWSMessageParser,
	ElysiaWS,
	websocket
} from '../../ws/index'
import type { ServerWebSocket } from '../../ws/bun'

export const BunAdapter: ElysiaAdapter = {
	...WebStandardAdapter,
	name: 'bun',
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
				app.event.start[i].fn(app)

			if (callback) callback(app.server!)

			process.on('beforeExit', () => {
				if (app.server) {
					app.server.stop()
					app.server = null

					for (let i = 0; i < app.event.stop.length; i++)
						app.event.stop[i].fn(app)
				}
			})

			// @ts-expect-error private
			app.promisedModules.then(() => {
				Bun?.gc(false)
			})
		}
	},
	ws(app, path, options) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { parse, body, response, ...rest } = options

		const validateMessage = getSchemaValidator(body, {
			// @ts-expect-error private property
			models: app.definitions.type as Record<string, TSchema>,
			normalize: app.config.normalize
		})

		const validateResponse = getSchemaValidator(response as any, {
			// @ts-expect-error private property
			models: app.definitions.type as Record<string, TSchema>,
			normalize: app.config.normalize
		})

		app.route(
			'$INTERNALWS',
			path as any,
			async (context) => {
				// @ts-expect-error private property
				const server = app.getServer()

				// ! Enable static code analysis just in case resolveUnknownFunction doesn't work, do not remove
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { set, path, qi, headers, query, params } = context

				// @ts-ignore
				context.validator = validateResponse

				if (options.upgrade) {
					if (typeof options.upgrade === 'function') {
						const temp = options.upgrade(context as any)
						if (temp instanceof Promise) await temp
					} else if (options.upgrade)
						Object.assign(
							set.headers,
							options.upgrade as Record<string, any>
						)
				}

				if (set.cookie && isNotEmpty(set.cookie)) {
					const cookie = serializeCookie(set.cookie)

					if (cookie) set.headers['set-cookie'] = cookie
				}

				if (
					set.headers['set-cookie'] &&
					Array.isArray(set.headers['set-cookie'])
				)
					set.headers = parseSetCookies(
						new Headers(set.headers as any) as Headers,
						set.headers['set-cookie']
					) as any

				const handleResponse = createHandleWSResponse(validateResponse)
				const parseMessage = createWSMessageParser(parse)

				let _id: string | undefined

				if (
					server?.upgrade<any>(context.request, {
						headers: isNotEmpty(set.headers)
							? (set.headers as Record<string, string>)
							: undefined,
						data: {
							...context,
							get id() {
								if (_id) return _id

								return (_id = randomId())
							},
							validator: validateResponse,
							ping(data?: unknown) {
								options.ping?.(data)
							},
							pong(data?: unknown) {
								options.pong?.(data)
							},
							open(ws: ServerWebSocket<any>) {
								handleResponse(
									ws,
									options.open?.(
										new ElysiaWS(ws, context as any)
									)
								)
							},
							message: async (
								ws: ServerWebSocket<any>,
								_message: any
							) => {
								const message = await parseMessage(ws, _message)

								if (validateMessage?.Check(message) === false)
									return void ws.send(
										new ValidationError(
											'message',
											validateMessage,
											message
										).message as string
									)

								handleResponse(
									ws,
									options.message?.(
										new ElysiaWS(
											ws,
											context as any,
											message
										),
										message as any
									)
								)
							},
							drain(ws: ServerWebSocket<any>) {
								handleResponse(
									ws,
									options.drain?.(
										new ElysiaWS(ws, context as any)
									)
								)
							},
							close(
								ws: ServerWebSocket<any>,
								code: number,
								reason: string
							) {
								handleResponse(
									ws,
									options.close?.(
										new ElysiaWS(ws, context as any),
										code,
										reason
									)
								)
							}
						}
					})
				)
					return

				set.status = 400
				return 'Expected a websocket connection'
			},
			{
				...rest,
				websocket: options
			} as any
		)
	}
}
