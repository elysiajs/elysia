/* eslint-disable sonarjs/no-duplicate-string */
import type { TSchema } from '@sinclair/typebox'

import { WebStandardAdapter } from '../web-standard/index'
import { parseSetCookies } from '../utils'
import type { ElysiaAdapter } from '../types'
import type { Serve } from '../../universal/server'

import { createBunRouteHandler } from './compose'
import { createNativeStaticHandler } from './handler-native'

import { serializeCookie } from '../../cookies'
import { isProduction, status, ValidationError } from '../../error'
import { getSchemaValidator } from '../../schema'
import {
	hasHeaderShorthand,
	isNotEmpty,
	isNumericString,
	randomId,
	supportPerMethodInlineHandler
} from '../../utils'

import {
	mapResponse,
	mapEarlyResponse,
	mapCompactResponse,
	createStaticHandler
} from './handler'

import {
	createHandleWSResponse,
	createWSMessageParser,
	ElysiaWS,
	websocket
} from '../../ws/index'
import type { ServerWebSocket } from '../../ws/bun'
import type { AnyElysia } from '../..'

const optionalParam = /:.+?\?(?=\/|$)/

const getPossibleParams = (path: string) => {
	const match = optionalParam.exec(path)

	if (!match) return [path]

	const routes: string[] = []

	const head = path.slice(0, match.index)
	const param = match[0].slice(0, -1)
	const tail = path.slice(match.index + match[0].length)

	routes.push(head.slice(0, -1))
	routes.push(head + param)

	for (const fragment of getPossibleParams(tail)) {
		if (!fragment) continue

		if (!fragment.startsWith('/:'))
			routes.push(head.slice(0, -1) + fragment)

		routes.push(head + param + fragment)
	}

	return routes
}

export const isHTMLBundle = (handle: any) => {
	return (
		typeof handle === 'object' &&
		handle !== null &&
		(handle.toString() === '[object HTMLBundle]' ||
			typeof handle.index === 'string')
	)
}

const supportedMethods = {
	GET: true,
	HEAD: true,
	OPTIONS: true,
	DELETE: true,
	PATCH: true,
	POST: true,
	PUT: true
} as const

const mapRoutes = (app: AnyElysia) => {
	if (!app.config.aot || !app.config.systemRouter) return undefined

	const routes = <Record<string, Function | Record<string, unknown>>>{}

	const add = (
		route: {
			path: string
			method: string
		},
		handler: Function
	) => {
		const path = encodeURI(route.path)

		if (routes[path]) {
			// @ts-ignore
			if (!routes[path][route.method])
				// @ts-ignore
				routes[path][route.method] = handler
		} else
			routes[path] = {
				[route.method]: handler
			}
	}

	// @ts-expect-error
	const tree = app.routeTree

	for (const route of app.router.history) {
		if (typeof route.handler !== 'function') continue

		const method = route.method

		if (
			(method === 'GET' && `WS_${route.path}` in tree) ||
			method === 'WS' ||
			route.path.charCodeAt(route.path.length - 1) === 42 ||
			!(method in supportedMethods)
		)
			continue

		if (method === 'ALL') {
			if (!(`WS_${route.path}` in tree))
				routes[route.path] = route.hooks?.config?.mount
					? route.hooks.trace ||
						app.event.trace ||
						// @ts-expect-error private property
						app.extender.higherOrderFunctions
						? createBunRouteHandler(app, route)
						: route.hooks.mount || route.handler
					: route.handler

			continue
		}

		let compiled: Function

		const handler = app.config.precompile
			? createBunRouteHandler(app, route)
			: (request: Request) => {
					if (compiled) return compiled(request)

					return (compiled = createBunRouteHandler(app, route))(
						request
					)
				}

		for (const path of getPossibleParams(route.path))
			add(
				{
					method,
					path
				},
				handler
			)
	}

	return routes
}

type Routes = Record<string, Function | Response | Record<string, unknown>>

const mergeRoutes = (r1: Routes, r2?: Routes) => {
	if (!r2) return r1

	for (const key of Object.keys(r2)) {
		if (r1[key] === r2[key]) continue

		if (!r1[key]) {
			r1[key] = r2[key]
			continue
		}

		if (r1[key] && r2[key]) {
			if (typeof r1[key] === 'function' || r1[key] instanceof Response) {
				r1[key] = r2[key]
				continue
			}

			r1[key] = {
				...r1[key],
				...r2[key]
			}
		}
	}

	return r1
}

export const BunAdapter: ElysiaAdapter = {
	...WebStandardAdapter,
	name: 'bun',
	handler: {
		mapResponse,
		mapEarlyResponse,
		mapCompactResponse,
		createStaticHandler,
		createNativeStaticHandler
	},
	composeHandler: {
		...WebStandardAdapter.composeHandler,
		headers: hasHeaderShorthand
			? 'c.headers=c.request.headers.toJSON()\n'
			: 'c.headers={}\n' +
				'for(const [k,v] of c.request.headers.entries())' +
				'c.headers[k]=v\n'
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

			const createStaticRoute = <
				WithAsync extends boolean | undefined = false
			>(
				iterator: AnyElysia['router']['response'],
				{ withAsync = false }: { withAsync?: WithAsync } = {}
			): true extends WithAsync
				? Promise<{
						[path: string]:
							| Response
							| { [method: string]: Response }
					}>
				: {
						[path: string]:
							| Response
							| { [method: string]: Response }
					} => {
				const staticRoutes = <
					{
						[path: string]:
							| Response
							| { [method: string]: Response }
					}
				>{}
				const ops = <Promise<any>[]>[]

				for (let [path, route] of Object.entries(iterator)) {
					path = encodeURI(path)

					if (supportPerMethodInlineHandler) {
						if (!route) continue

						for (const [method, value] of Object.entries(route)) {
							if (!value || !(method in supportedMethods))
								continue

							if (value instanceof Promise) {
								if (withAsync) {
									if (!staticRoutes[path])
										staticRoutes[path] = {}

									ops.push(
										value.then((awaited) => {
											if (awaited instanceof Response)
												// @ts-ignore
												staticRoutes[path][method] =
													awaited

											if (isHTMLBundle(awaited))
												// @ts-ignore
												staticRoutes[path][method] =
													awaited
										})
									)
								}

								continue
							}

							if (
								!(value instanceof Response) &&
								!isHTMLBundle(value)
							)
								continue

							if (!staticRoutes[path]) staticRoutes[path] = {}

							// @ts-ignore
							staticRoutes[path][method] = value
						}
					} else {
						if (!route) continue

						if (route instanceof Promise) {
							if (withAsync) {
								if (!staticRoutes[path]) staticRoutes[path] = {}

								ops.push(
									route.then((awaited) => {
										if (awaited instanceof Response)
											// @ts-ignore
											staticRoutes[path] = awaited
									})
								)
							}

							continue
						}

						if (!(route instanceof Response)) continue

						staticRoutes[path] = route
					}
				}

				if (withAsync)
					return Promise.all(ops).then(() => staticRoutes) as any

				return staticRoutes as any
			}

			const serve =
				typeof options === 'object'
					? ({
							development: !isProduction,
							reusePort: true,
							idleTimeout: 30,
							...(app.config.serve || {}),
							...(options || {}),
							// @ts-ignore
							routes: mergeRoutes(
								mergeRoutes(
									createStaticRoute(app.router.response),
									mapRoutes(app)
								),
								// @ts-ignore
								app.config.serve?.routes
							),
							websocket: {
								...(app.config.websocket || {}),
								...(websocket || {}),
								...(options.websocket || {})
							},
							fetch: app.fetch
						} as Serve)
					: ({
							development: !isProduction,
							reusePort: true,
							idleTimeout: 30,
							...(app.config.serve || {}),
							// @ts-ignore
							routes: mergeRoutes(
								mergeRoutes(
									createStaticRoute(app.router.response),
									mapRoutes(app)
								),
								// @ts-ignore
								app.config.serve?.routes
							),
							websocket: {
								...(app.config.websocket || {}),
								...(websocket || {})
							},
							port: options,
							fetch: app.fetch
						} as Serve)

			app.server = Bun.serve(serve as any) as any

			if (app.event.start)
				for (let i = 0; i < app.event.start.length; i++)
					app.event.start[i].fn(app)

			if (callback) callback(app.server!)

			process.on('beforeExit', async () => {
				if (app.server) {
					await app.server.stop?.()
					app.server = null

					if (app.event.stop)
						for (let i = 0; i < app.event.stop.length; i++)
							app.event.stop[i].fn(app)
				}
			})

			// @ts-expect-error private
			app.promisedModules.then(async () => {
				if (typeof app.config.aot) app.compile()

				app.server?.reload({
					...serve,
					fetch: app.fetch,
					// @ts-ignore
					routes: mergeRoutes(
						mergeRoutes(
							await createStaticRoute(app.router.response, {
								withAsync: true
							}),
							mapRoutes(app)
						),
						// @ts-ignore
						app.config.serve?.routes
					)
				})

				Bun?.gc(false)
			})
		}
	},
	async stop(app, closeActiveConnections) {
		if (app.server) {
			await app.server.stop(closeActiveConnections)
			app.server = null

			if (app.event.stop?.length)
				for (let i = 0; i < app.event.stop.length; i++)
					app.event.stop[i].fn(app)
		} else
			console.log(
				"Elysia isn't running. Call `app.listen` to start the server.",
				new Error().stack
			)
	},
	ws(app, path, options) {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { parse, body, response, ...rest } = options

		const messageValidator = getSchemaValidator(body, {
			// @ts-expect-error private property
			modules: app.definitions.typebox,
			// @ts-expect-error private property
			models: app.definitions.type as Record<string, TSchema>,
			normalize: app.config.normalize
		})

		const validateMessage = messageValidator
			? messageValidator.provider === 'standard'
				? (data: unknown) =>
						messageValidator.schema['~standard'].validate(data)
							.issues
				: (data: unknown) => messageValidator.Check(data) === false
			: undefined

		const responseValidator = getSchemaValidator(response as any, {
			// @ts-expect-error private property
			modules: app.definitions.typebox,
			// @ts-expect-error private property
			models: app.definitions.type as Record<string, TSchema>,
			normalize: app.config.normalize
		})

		app.route(
			'WS',
			path as any,
			async (context: any) => {
				const server =
					(context.server as (typeof app)['server']) ?? app.server

				// ! Enable static code analysis just in case resolveUnknownFunction doesn't work, do not remove
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { set, path, qi, headers, query, params } = context

				// @ts-ignore
				context.validator = responseValidator

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

				const handleResponse = createHandleWSResponse(responseValidator)
				const parseMessage = createWSMessageParser(parse as any)

				let _id: string | undefined

				if (typeof options.beforeHandle === 'function') {
					const result = options.beforeHandle(context)
					if (result instanceof Promise) await result
				}

				const errorHandlers = [
					...(options.error
						? Array.isArray(options.error)
							? options.error
							: [options.error]
						: []),
					...(app.event.error ?? []).map((x) =>
						typeof x === 'function' ? x : x.fn
					)
				].filter((x) => x)

				const hasCustomErrorHandlers = errorHandlers.length > 0

				const handleErrors = !hasCustomErrorHandlers
					? () => {}
					: async (ws: ServerWebSocket<any>, error: unknown) => {
							for (const handleError of errorHandlers) {
								let response = handleError(
									Object.assign(context, { error })
								)
								if (response instanceof Promise)
									response = await response

								await handleResponse(ws, response)

								if (response) break
							}
						}

				if (
					server?.upgrade(context.request, {
						headers: isNotEmpty(set.headers)
							? (set.headers as Record<string, string>)
							: undefined,
						data: {
							...context,
							get id() {
								if (_id) return _id

								return (_id = randomId())
							},
							validator: responseValidator,
							ping(ws: ServerWebSocket<any>, data?: unknown) {
								options.ping?.(ws as any, data)
							},
							pong(ws: ServerWebSocket<any>, data?: unknown) {
								options.pong?.(ws as any, data)
							},
							open: async (ws: ServerWebSocket<any>) => {
								try {
									await handleResponse(
										ws,
										options.open?.(
											new ElysiaWS(ws, context as any)
										)
									)
								} catch (error) {
									handleErrors(ws, error)
								}
							},
							message: async (
								ws: ServerWebSocket<any>,
								_message: any
							) => {
								const message = await parseMessage(ws, _message)

								if (
									validateMessage &&
									validateMessage(message)
								) {
									const validationError = new ValidationError(
										'message',
										messageValidator!,
										message
									)

									if (!hasCustomErrorHandlers)
										return void ws.send(
											validationError.message as string
										)

									return handleErrors(ws, validationError)
								}

								try {
									await handleResponse(
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
								} catch (error) {
									handleErrors(ws, error)
								}
							},
							drain: async (ws: ServerWebSocket<any>) => {
								try {
									await handleResponse(
										ws,
										options.drain?.(
											new ElysiaWS(ws, context as any)
										)
									)
								} catch (error) {
									handleErrors(ws, error)
								}
							},
							close: async (
								ws: ServerWebSocket<any>,
								code: number,
								reason: string
							) => {
								try {
									await handleResponse(
										ws,
										options.close?.(
											new ElysiaWS(ws, context as any),
											code,
											reason
										)
									)
								} catch (error) {
									handleErrors(ws, error)
								}
							}
						}
					})
				)
					return

				return status(400, 'Expected a websocket connection')
			},
			{
				...rest,
				websocket: options
			} as any
		)
	}
}
