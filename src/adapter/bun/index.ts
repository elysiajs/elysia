/* eslint-disable sonarjs/no-duplicate-string */
import type { Serve } from 'bun'
import type { TSchema } from '@sinclair/typebox'

import { WebStandardAdapter } from '../web-standard/index'
import { parseSetCookies } from '../web-standard/handler'
import type { ElysiaAdapter } from '../types'

import { createNativeStaticHandler } from './handler'
import { serializeCookie } from '../../cookies'
import { isProduction, ValidationError } from '../../error'
import type { TypeCheck } from '../../type-system'
import {
	getSchemaValidator,
	hasHeaderShorthand,
	isNotEmpty,
	isNumericString
} from '../../utils'

import { ElysiaWS, websocket } from '../../ws/index'
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
	},
	ws(app, path, options) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { parse, body, response, ...rest } = options

		const parsers = typeof parse === 'function' ? [parse] : parse

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

		const parseMessage = async (ws: ServerWebSocket<any>, message: any) => {
			if (typeof message === 'string') {
				const start = message?.charCodeAt(0)

				if (start === 47 || start === 123)
					try {
						message = JSON.parse(message)
					} catch {
						// Not empty
					}
				else if (isNumericString(message)) message = +message
			}

			if (parsers)
				for (let i = 0; i < parsers.length; i++) {
					let temp = parsers[i](ws, message)
					if (temp instanceof Promise) temp = await temp

					if (temp !== undefined) return temp
				}

			return message
		}

		app.route(
			'$INTERNALWS',
			path as any,
			async (context) => {
				// ! Enable static code analysis just in case resolveUnknownFunction doesn't work, do not remove
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { set, path, qi, headers, query, params } = context

				// @ts-expect-error private property
				const server = app.getServer()

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

				if (
					server?.upgrade<any>(context.request, {
						headers: isNotEmpty(set.headers)
							? (set.headers as Record<string, string>)
							: undefined,
						data: {
							...context,
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

const createHandleWSResponse = (
	validateResponse: TypeCheck<any> | undefined
) => {
	const handleWSResponse = (ws: ServerWebSocket, data: unknown): unknown => {
		if (data instanceof Promise)
			return data.then((data) => handleWSResponse(ws, data))

		if (Buffer.isBuffer(data)) return ws.send(data)

		if (data === undefined) return

		const send = (ws: ServerWebSocket, datum: unknown) => {
			if (validateResponse?.Check(datum) === false)
				return ws.send(
					new ValidationError('message', validateResponse, datum)
						.message
				)

			if (typeof datum === 'object') return ws.send(JSON.stringify(datum))

			ws.send(datum)
		}

		if (typeof (data as Generator)?.next === 'function') {
			const init = (data as Generator | AsyncGenerator).next()

			if (init instanceof Promise)
				return (async () => {
					const first = await init

					if (validateResponse?.Check(first) === false)
						return ws.send(
							new ValidationError(
								'message',
								validateResponse,
								first
							).message
						)

					if (typeof first.value === 'object')
						ws.send(JSON.stringify(first.value)) as any
					else ws.send(first.value as any)

					if (!first.done)
						for await (const datum of data as Generator)
							send(ws, datum)
				})()

			if (typeof init.value === 'object')
				ws.send(JSON.stringify(init.value))
			else ws.send(init.value)

			if (!init.done)
				for (const datum of data as Generator) {
					send(ws, datum)

					return
				}

			if (validateResponse?.Check(data) === false)
				return ws.send(
					new ValidationError('message', validateResponse, data)
						.message
				)

			if (typeof data === 'object') return ws.send(JSON.stringify(data))

			if (data !== undefined) return ws.send(data as any)
		}

		return handleWSResponse
	}

	return handleWSResponse
}
