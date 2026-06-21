import { RouteValidator } from '../validator/route'
import { flattenChain, nullObject } from '../utils'
import { parseQueryFromURL } from '../parse-query'
import { getQueryParseChannels } from '../compile/handler/utils'

import { ElysiaWS, isGeneratorObject, type WSConnectionData } from './context'
import { createMessageParser } from './parser'
import { ValidationError } from '../error'

import { isBun } from '../universal/constants'

import type { AnyElysia } from '../base'
import type { Context } from '../context'
import type {
	AnyWSLocalHook,
	WSValidatorLike,
	ServerWebSocket,
	WebSocketHandler
} from './types'
import type { InternalRoute } from '../types'

type AnyFn = (...args: any[]) => any
type Server = {
	upgrade(request: Request, options?: { headers?: any; data?: any }): boolean
}

const toArray = <T>(v: T | T[] | undefined): T[] =>
	v == null ? [] : Array.isArray(v) ? v : [v]

const EMPTY_HOOKS: readonly AnyFn[] = Object.freeze([]) as any

function concatHooks(
	...sources: Array<AnyFn | AnyFn[] | undefined | null>
): readonly AnyFn[] {
	let result: AnyFn[] | undefined

	for (let i = 0; i < sources.length; i++) {
		const s = sources[i]
		if (s == null) continue
		const arr = Array.isArray(s) ? s : [s]
		if (arr.length === 0) continue
		result = result ? result.concat(arr) : arr
	}

	return result ?? EMPTY_HOOKS
}

async function applyMapResponse(
	ws: ElysiaWS<any>,
	value: unknown,
	mapResponses: readonly AnyFn[]
): Promise<unknown> {
	for (let i = 0; i < mapResponses.length; i++) {
		;(ws as any).responseValue = value

		const r = mapResponses[i](ws)
		const result = r instanceof Promise ? await r : r
		if (result !== undefined) value = result
	}

	return value
}

async function handleWSResponse(
	ws: ElysiaWS<any>,
	value: unknown,
	mapResponses: readonly AnyFn[]
): Promise<void> {
	if (value === undefined) return

	if (isGeneratorObject(value)) {
		const iter = value as Iterator<unknown> | AsyncIterator<unknown>
		while (true) {
			const step = iter.next()
			const { value: yielded, done } =
				step instanceof Promise ? await step : step

			if (done) return

			if (yielded !== undefined) {
				const mapped = mapResponses.length
					? await applyMapResponse(ws, yielded, mapResponses)
					: yielded
				;(ws as any).send(mapped)
			}
		}
	}

	const mapped = mapResponses.length
		? await applyMapResponse(ws, value, mapResponses)
		: value

	;(ws as any).send(mapped)
}

export function buildWSRoute(
	route: InternalRoute,
	app: AnyElysia
): [
	fetch: (
		context: Context
	) => Promise<Response | undefined> | Response | undefined,
	options: Partial<WebSocketHandler<any>>
] {
	const hook: AnyWSLocalHook = ((route[4] as AnyWSLocalHook | undefined) ??
		{}) as AnyWSLocalHook

	const validators = new RouteValidator(hook as any, {
		models: app['~ext']?.models
	})

	const responseValidator = validators.response as
		| { [status: number]: WSValidatorLike }
		| undefined

	const defaultResponseValidator = responseValidator
		? (responseValidator[200] ??
			responseValidator[Object.keys(responseValidator)[0] as any])
		: undefined

	const queryChannels = getQueryParseChannels(
		(validators.query as any)?.schema
	)
	const queryArray = queryChannels?.array
	const queryObject = queryChannels?.object

	const flatAppHook = flattenChain(app['~hookChain']) ?? {}

	const parseHooks = toArray(hook.parse as any)
	const transforms = concatHooks(
		flatAppHook.transform as any,
		hook.transform as any
	)

	const allBeforeHandles = concatHooks(
		flatAppHook.beforeHandle as any,
		hook.beforeHandle as any
	)

	const deriveSet: WeakSet<any> | undefined = (app as any)['~derive']
	const messageBeforeHandles: readonly AnyFn[] = deriveSet
		? allBeforeHandles.filter((fn) => !deriveSet.has(fn))
		: allBeforeHandles

	const afterHandles = concatHooks(
		flatAppHook.afterHandle as any,
		hook.afterHandle as any
	)

	const mapResponses = concatHooks(
		flatAppHook.mapResponse as any,
		hook.mapResponse as any
	)

	const afterResponses = concatHooks(
		flatAppHook.afterResponse as any,
		hook.afterResponse as any
	)

	const errorHandlers = concatHooks(
		hook.error as any,
		flatAppHook.error as any
	)

	const parseMessage = createMessageParser(parseHooks as any)

	async function handleUpgradeError(
		context: Context,
		error: any
	): Promise<Response> {
		;(context as any).error = error
		if (
			app['~config']?.allowUnsafeValidationDetails &&
			error instanceof ValidationError
		)
			error.allowUnsafeValidationDetails = true
		if (error?.status) (context.set as any).status = error.status

		for (let i = 0; i < errorHandlers.length; i++) {
			let r: unknown = errorHandlers[i](context as any)
			if (r instanceof Promise) r = await r

			if (r === undefined) continue
			if (r instanceof Response) return r

			const status = (context.set as any)?.status ?? 200
			return new Response(
				typeof r === 'object' ? JSON.stringify(r) : String(r),
				{ status }
			)
		}

		if (typeof error?.toResponse === 'function')
			try {
				const r = error.toResponse()
				if (r instanceof Response) return r
			} catch {}

		const status = error?.status ?? 500
		const body =
			error?.response !== undefined
				? typeof error.response === 'object'
					? JSON.stringify(error.response)
					: String(error.response)
				: error instanceof Error
					? error.message
					: String(error)

		return new Response(body, { status })
	}

	async function handleError(ws: ElysiaWS<any>, error: unknown) {
		const errCtx: any = Object.create(ws as any)
		errCtx.error = error
		if (
			app['~config']?.allowUnsafeValidationDetails &&
			error instanceof ValidationError
		)
			error.allowUnsafeValidationDetails = true

		for (let i = 0; i < errorHandlers.length; i++) {
			let r: unknown = errorHandlers[i](errCtx)
			if (r instanceof Promise) r = await r
			if (r !== undefined) {
				try {
					await handleWSResponse(ws, r, mapResponses)
				} catch {}
				return
			}
		}

		const message = error instanceof Error ? error.message : String(error)
		try {
			ws.raw.send(message)
		} catch {}
	}

	// Per-route constant. `hook.message` never changes after build.
	const messageTakesBody =
		!!hook.message && (hook.message as AnyFn).length >= 2

	async function dispatchMessage(
		connection: ElysiaWS<any>,
		rawMessage: string | Buffer
	) {
		const ws: ElysiaWS<any> = Object.create(connection)

		try {
			const p = parseMessage(ws.raw as any, rawMessage)
			const message = p instanceof Promise ? await p : p

			if (validators.body) {
				const v = validators.body as any
				if (!v.Check(message)) {
					const err = new ValidationError(
						'body',
						message,
						v.Errors?.(message) ?? []
					)
					if (errorHandlers.length === 0) {
						ws.raw.send(err.message)
						return
					}
					return handleError(ws, err)
				}
			}

			ws.body = message as any

			for (let i = 0; i < transforms.length; i++) {
				const r = transforms[i](ws as any)
				if (r instanceof Promise) await r
			}
			for (let i = 0; i < messageBeforeHandles.length; i++) {
				let r: unknown = messageBeforeHandles[i](ws as any)
				if (r instanceof Promise) r = await r
				if (r !== undefined) {
					await handleWSResponse(ws, r, mapResponses)
					return
				}
			}

			if (hook.message) {
				const result = messageTakesBody
					? (hook.message as AnyFn)(ws, message)
					: (hook.message as AnyFn)(ws)

				const resolved =
					result instanceof Promise ? await result : result

				if (resolved !== undefined)
					await handleWSResponse(ws, resolved, mapResponses)
			}

			for (let i = 0; i < afterHandles.length; i++) {
				const r = afterHandles[i](ws as any)
				if (r instanceof Promise) await r
			}
			for (let i = 0; i < afterResponses.length; i++) {
				try {
					const r = afterResponses[i](ws as any)
					if (r instanceof Promise) await r
				} catch {}
			}
		} catch (error) {
			await handleError(ws, error)
		}
	}

	const syncDispatchEligible =
		transforms.length === 0 &&
		messageBeforeHandles.length === 0 &&
		afterHandles.length === 0 &&
		afterResponses.length === 0 &&
		mapResponses.length === 0

	function finishMessageResult(
		ws: ElysiaWS<any>,
		value: unknown
	): void | Promise<void> {
		if (value === undefined) return

		if (isGeneratorObject(value))
			return handleWSResponse(ws, value, mapResponses).catch((error) =>
				handleError(ws, error)
			)

		try {
			;(ws as any).send(value)
		} catch (error) {
			return handleError(ws, error)
		}
	}

	function dispatchParsedSync(
		ws: ElysiaWS<any>,
		message: unknown
	): void | Promise<void> {
		try {
			if (validators.body) {
				const v = validators.body as any
				if (!v.Check(message)) {
					const err = new ValidationError(
						'body',
						message,
						v.Errors?.(message) ?? []
					)
					if (errorHandlers.length === 0) {
						ws.raw.send(err.message)
						return
					}
					return handleError(ws, err)
				}
			}

			ws.body = message as any

			const result = messageTakesBody
				? (hook.message as AnyFn)(ws, message)
				: (hook.message as AnyFn)(ws)

			if (result instanceof Promise)
				return result.then(
					(resolved) => finishMessageResult(ws, resolved),
					(error) => handleError(ws, error)
				)

			return finishMessageResult(ws, result)
		} catch (error) {
			return handleError(ws, error)
		}
	}

	function dispatchMessageSync(
		connection: ElysiaWS<any>,
		rawMessage: string | Buffer
	): void | Promise<void> {
		const ws: ElysiaWS<any> = Object.create(connection)

		try {
			const p = parseMessage(ws.raw as any, rawMessage)
			if (p instanceof Promise)
				return p.then(
					(message) => dispatchParsedSync(ws, message),
					(error) => handleError(ws, error)
				)

			return dispatchParsedSync(ws, p)
		} catch (error) {
			return handleError(ws, error)
		}
	}

	const dispatch = syncDispatchEligible
		? dispatchMessageSync
		: dispatchMessage

	function wrapLifecycle(fn: AnyFn | undefined, withBody: boolean) {
		if (!fn) return

		return async (connection: ElysiaWS<any>, bodyArg?: unknown) => {
			// Per-invocation view over the shared per-connection instance,
			// mirroring dispatchMessage. Without it, concurrent ping/pong
			// handlers would clobber each other's `body` (and lifecycle
			// state) on the shared connection across an await.
			const ws: ElysiaWS<any> = Object.create(connection)
			try {
				if (withBody) ws.body = bodyArg as any
				const result = withBody ? fn(ws, bodyArg) : fn(ws)
				const resolved =
					result instanceof Promise ? await result : result
				await handleWSResponse(ws, resolved, mapResponses)
			} catch (error) {
				await handleError(ws, error)
			}
		}
	}

	const onOpen = wrapLifecycle(hook.open as any, false)
	const onDrain = wrapLifecycle(hook.drain as any, false)
	const onPing = wrapLifecycle(hook.ping as any, true)
	const onPong = wrapLifecycle(hook.pong as any, true)
	const onClose = hook.close
		? async (
				connection: ElysiaWS<any>,
				code: number,
				reason: string
			) => {
				const ws: ElysiaWS<any> = Object.create(connection)
				try {
					;(ws as any).code = code
					;(ws as any).reason = reason

					const fn = hook.close as AnyFn
					const result = fn(ws, code, reason)
					const resolved =
						result instanceof Promise ? await result : result

					await handleWSResponse(ws, resolved, mapResponses)
				} catch (error) {
					await handleError(ws, error)
				}
			}
		: undefined

	const fetchHandler = async (context: Context) => {
		const request = context.request

		try {
			if (validators.params) {
				const v = validators.params as any
				if (!v.Check(context.params ?? {}))
					return await handleUpgradeError(
						context,
						new ValidationError(
							'params',
							context.params,
							v.Errors?.(context.params) ?? []
						)
					)
			}
			if (validators.query) {
				const url = request.url
				const query = parseQueryFromURL(
					url,
					(context as any).qi ?? url.indexOf('?'),
					queryArray,
					queryObject
				)
				;(context as any).query = query

				const v = validators.query as any
				if (!v.Check(query))
					return await handleUpgradeError(
						context,
						new ValidationError(
							'query',
							query,
							v.Errors?.(query) ?? []
						)
					)
			}

			if (validators.headers) {
				const headers = ((context as any).headers = isBun
					? request.headers.toJSON()
					: Object.fromEntries(request.headers))

				const vali = validators.headers as any
				if (!vali.Check(headers))
					return await handleUpgradeError(
						context,
						new ValidationError(
							'headers',
							headers,
							vali.Errors?.(headers) ?? []
						)
					)
			}

			for (let i = 0; i < transforms.length; i++) {
				const r = transforms[i](context as any)
				if (r instanceof Promise) await r
			}

			for (let i = 0; i < allBeforeHandles.length; i++) {
				const fn = allBeforeHandles[i]
				let r: unknown = fn(context as any)
				if (r instanceof Promise) r = await r
				if (deriveSet?.has(fn)) {
					if (r && typeof r === 'object')
						Object.assign(context as any, r)
				} else if (r !== undefined) {
					if (r instanceof Response) return r
					return new Response(
						typeof r === 'object' ? JSON.stringify(r) : String(r),
						{ status: (context.set as any)?.status ?? 200 }
					)
				}
			}

			let upgradeHeaders: Record<string, string> | undefined
			if (hook.upgrade != null) {
				const r =
					typeof hook.upgrade === 'function'
						? hook.upgrade(context as any)
						: hook.upgrade
				const resolved = r instanceof Promise ? await r : r
				if (resolved && typeof resolved === 'object')
					upgradeHeaders = resolved as Record<string, string>
			}

			const server = (app as any).server as Server | null
			if (!server)
				return new Response(
					'WebSocket upgrade requires a running server. Call .listen() first.',
					{ status: 500 }
				)

			const connectionData: WSConnectionData = {
				id: '',
				context: context as any,
				validator: responseValidator,
				defaultValidator: defaultResponseValidator,
				open: onOpen as any,
				message: hook.message ? dispatch : undefined,
				drain: onDrain as any,
				close: onClose as any,
				ping: onPing as any,
				pong: onPong as any
			}

			const upgraded = server.upgrade(request, {
				headers: upgradeHeaders,
				data: connectionData
			})

			if (!upgraded)
				return new Response('Expected a websocket connection', {
					status: 400
				})
		} catch (error) {
			return handleUpgradeError(context, error)
		}
	}

	const options: Partial<WebSocketHandler<any>> = nullObject()
	for (const k of [
		'maxPayloadLength',
		'backpressureLimit',
		'closeOnBackpressureLimit',
		'idleTimeout',
		'publishToSelf',
		'sendPings',
		'perMessageDeflate'
	] as const) {
		if ((hook as any)[k] !== undefined)
			(options as any)[k] = (hook as any)[k]
	}

	return [fetchHandler, options] as const
}

export function buildGlobalWSHandler(): WebSocketHandler<WSConnectionData> {
	function getElysia(ws: ServerWebSocket<WSConnectionData>): ElysiaWS<any> {
		let elysia = ws.data.elysia
		if (!elysia) {
			elysia = new ElysiaWS(ws as any, ws.data.context as any)
			ws.data.elysia = elysia
			ws.data.context = undefined
		}
		return elysia
	}

	return {
		message(ws, message) {
			ws.data.message?.(getElysia(ws), message)
		},
		open(ws) {
			ws.data.open?.(getElysia(ws))
		},
		drain(ws) {
			ws.data.drain?.(getElysia(ws))
		},
		close(ws, code, reason) {
			if (ws.data.closeHandlerInvoked) return
			ws.data.closeHandlerInvoked = true
			ws.data.close?.(getElysia(ws), code, reason)
		},
		ping(ws, data) {
			ws.data.ping?.(getElysia(ws), data)
		},
		pong(ws, data) {
			ws.data.pong?.(getElysia(ws), data)
		}
	}
}
