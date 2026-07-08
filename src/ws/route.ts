import { RouteValidator } from '../validator/route'
import { StandardValidator } from '../validator'
import {
	buildFrozenRouteValidator,
	isBridgeNotInitialized
} from '../compile/handler/frozen-validator'
import { deriveEntryFn, nullObject, type DeriveEntry } from '../utils'
import { parseQueryFromURL } from '../parse-query'
import {
	deriveModes,
	getQueryParseChannels,
	replaceDeriveContext
} from '../compile/handler/utils'
import {
	composeRouteHook,
	localMacroRoot,
	resolveWSLocalHook
} from '../compile/handler'

import { ElysiaWS, isGeneratorObject, type WSConnectionData } from './context'
import { createMessageParser } from './parser'
import {
	ElysiaError,
	ElysiaStatus,
	ValidationError,
	internalServerErrorBodyString,
	internalServerErrorResponse,
	isProduction,
	problemBody,
	problemResponse
} from '../error'

import { isBun } from '../universal/constants'
import { mapResponse } from '../adapter/web-standard/handler'

import type { AnyElysia } from '../base'
import type { Context } from '../context'
import type {
	AnyWSLocalHook,
	WSValidatorLike,
	ServerWebSocket,
	WebSocketHandler
} from './types'
import type { InternalRoute, AppHook } from '../types'

type AnyFn = (...args: any[]) => any
type Server = {
	upgrade(request: Request, options?: { headers?: any; data?: any }): boolean
}

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

const isBackpressured = (status: unknown) =>
	typeof status === 'number' && status <= 0

const isEmptyPayload = (payload: unknown) => {
	if (payload === '' || payload == null) return true
	if (typeof payload === 'string') return false
	if (payload instanceof ArrayBuffer || ArrayBuffer.isView(payload))
		return (payload as ArrayBufferView).byteLength === 0

	return false
}

function waitForDrain(ws: ElysiaWS<any>) {
	const data = ws.raw.data

	return new Promise<void>((resolve) => {
		;(data.resumeWaiters ??= new Set()).add(resolve)
	})
}

export function drainWaiters(ws: ElysiaWS<any>) {
	const waiters = ws.raw.data.resumeWaiters
	if (!waiters || waiters.size === 0) return

	ws.raw.data.resumeWaiters = undefined
	for (const fn of waiters) fn()
}

export async function handleWSResponse(
	ws: ElysiaWS<any>,
	value: unknown,
	mapResponses: readonly AnyFn[]
): Promise<void> {
	if (value === undefined) return

	if (isGeneratorObject(value)) {
		const iter = value as Iterator<unknown> | AsyncIterator<unknown>
		try {
			while (true) {
				const step = iter.next()
				const { value: yielded, done } =
					step instanceof Promise ? await step : step

				if (done) return

				if (yielded === undefined) continue

				const mapped = mapResponses.length
					? await applyMapResponse(ws, yielded, mapResponses)
					: yielded

				let status = (ws as any).send(mapped)
				const canBackpressure = !isEmptyPayload(mapped)

				while (canBackpressure && isBackpressured(status)) {
					// closing
					if (ws.readyState >= 2) return

					await waitForDrain(ws)

					if (ws.readyState >= 2) return

					if (status === -1) break
					status = (ws as any).send(mapped)
				}
			}
		} finally {
			if (typeof (iter as any).return === 'function')
				try {
					const r = (iter as any).return()
					if (r instanceof Promise) await r
				} catch {}
		}
		return
	}

	const mapped = mapResponses.length
		? await applyMapResponse(ws, value, mapResponses)
		: value

	;(ws as any).send(mapped)
}

const wsOptions = [
	'maxPayloadLength',
	'backpressureLimit',
	'closeOnBackpressureLimit',
	'idleTimeout',
	'publishToSelf',
	'sendPings',
	'perMessageDeflate'
] as const

export function buildWSRoute(
	route: InternalRoute,
	app: AnyElysia
): [
	fetch: (
		context: Context
	) => Promise<Response | undefined> | Response | undefined,
	options: Partial<WebSocketHandler<any>>
] {
	const hook: AnyWSLocalHook = (resolveWSLocalHook(
		localMacroRoot(
			(route[7] as AnyElysia) ?? (route[3] as AnyElysia) ?? app,
			app
		),
		route[4] as AnyWSLocalHook | undefined,
		app
	) ?? nullObject()) as AnyWSLocalHook

	let validators: RouteValidator<any>
	try {
		validators = new RouteValidator(hook as any, {
			models: app['~ext']?.models,
			aot: { method: 'WS', path: route[1] }
		})
	} catch (error) {
		if (!isBridgeNotInitialized(error)) throw error

		const frozen = buildFrozenRouteValidator(
			hook as any,
			{ '~ext': app['~ext'] } as AnyElysia,
			'WS',
			route[1] as string
		)
		if (!frozen) throw error

		validators = frozen as any
	}

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

	const instance = (route[3] as AnyElysia | undefined) ?? app
	const appHookChain = route[5] as Parameters<typeof composeRouteHook>[2]
	const inheritedChain = route[6] as Parameters<typeof composeRouteHook>[3]

	const flatAppHook =
		(composeRouteHook(
			instance,
			undefined,
			appHookChain,
			inheritedChain,
			app,
			route[7] as AnyElysia | undefined
		) as Partial<AppHook> | undefined) ?? ({} as Partial<AppHook>)

	const parseHooks = (
		hook.parse == null
			? []
			: Array.isArray(hook.parse)
				? hook.parse
				: [hook.parse]
	) as any[]

	const transforms = concatHooks(
		flatAppHook.transform as any,
		hook.transform as any
	)

	const allBeforeHandles = concatHooks(
		flatAppHook.beforeHandle as any,
		hook.beforeHandle as any
	)

	const deriveEntries = [
		...(((flatAppHook as any)['~deriveEntries'] as
			| DeriveEntry[]
			| undefined) ?? []),
		...(((hook as any)['~deriveEntries'] as DeriveEntry[] | undefined) ??
			[])
	] as DeriveEntry[]

	const deriveSet = deriveEntries.length
		? new Set<Function>(deriveEntries.map(deriveEntryFn))
		: undefined

	const upgradeDeriveModes = deriveModes(
		allBeforeHandles as unknown as Function[],
		deriveEntries
	)

	const messageBeforeHandles: readonly AnyFn[] = allBeforeHandles.filter(
		(fn) => !deriveSet?.has(fn as Function)
	)

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

		// User-provided error body → keep as-is; unexpected Error → problem+json
		if (error?.response !== undefined) {
			const status = error?.status ?? 500
			const body =
				typeof error.response === 'object'
					? JSON.stringify(error.response)
					: String(error.response)

			return new Response(body, { status })
		}

		if (error instanceof Error) return internalServerErrorResponse(error)

		return new Response(String(error), { status: error?.status ?? 500 })
	}

	function wsErrorFrame(error: any): string | Promise<string> {
		if (error instanceof ValidationError)
			try {
				return JSON.stringify(error.payload)
			} catch {}

		if (error instanceof ElysiaStatus)
			try {
				return JSON.stringify({
					status: error.status,
					error: error.response
				})
			} catch {}

		if (typeof error?.toResponse === 'function') {
			if (
				error instanceof ElysiaError &&
				error.toResponse === ElysiaError.prototype.toResponse
			)
				try {
					return JSON.stringify(
						problemBody({
							type: error.problemType,
							title: error.problemTitle,
							status: (error.status ?? 500) as any,
							detail:
								error.response !== undefined &&
								error.response !== error.problemTitle
									? (error.response as any)
									: undefined
						})
					)
				} catch {}

			try {
				const r = error.toResponse()
				return Promise.resolve(r).then((resolved) =>
					resolved instanceof Response
						? resolved.text()
						: wsErrorFrameFallback(error)
				)
			} catch {}
		}

		return wsErrorFrameFallback(error)
	}

	function wsErrorFrameFallback(error: any): string {
		if (error?.status) {
			const body =
				error.response !== undefined
					? error.response
					: isProduction()
						? error.status >= 500
							? 'Internal Server Error'
							: ''
						: (error.message ?? '')

			return typeof body === 'object'
				? JSON.stringify(body)
				: String(body)
		}

		return internalServerErrorBodyString(error)
	}

	function sendErrorFrame(
		ws: ElysiaWS<any>,
		error: unknown
	): void | Promise<void> {
		const frame = wsErrorFrame(error)
		if (typeof frame === 'string') {
			try {
				ws.raw.send(frame)
			} catch {}
			return
		}
		return frame.then(
			(f) => {
				try {
					ws.raw.send(f)
				} catch {}
			},
			() => {}
		)
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

		sendErrorFrame(ws, error)
	}

	const bodyValidator = validators.body as any

	function validateMessageBody(message: unknown) {
		if (!bodyValidator) return message

		if (bodyValidator.hasCodec) return bodyValidator.From(message, 'body')

		if (bodyValidator instanceof StandardValidator)
			return bodyValidator.From(message, 'body')

		if (!bodyValidator.Check(message))
			throw new ValidationError(
				'body',
				message,
				bodyValidator.Errors?.(message) ?? []
			)

		return message
	}

	function validateUpgradeChannel(
		validator: any,
		value: unknown,
		type: 'params' | 'query' | 'headers'
	): unknown | Promise<unknown> {
		if (validator instanceof StandardValidator)
			return validator.From(value, type)

		if (validator.hasCodec) return validator.From(value, type)

		if (!validator.Check(value))
			throw new ValidationError(
				type,
				value,
				validator.Errors?.(value) ?? []
			)

		return value
	}

	function onMessageValidationError(
		ws: ElysiaWS<any>,
		error: unknown
	): void | Promise<void> {
		if (errorHandlers.length === 0) return sendErrorFrame(ws, error)

		return handleError(ws, error)
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
			const p = parseMessage(ws as any, rawMessage)
			let message = p instanceof Promise ? await p : p

			if (bodyValidator) {
				try {
					const decoded = validateMessageBody(message)
					message =
						decoded instanceof Promise ? await decoded : decoded
				} catch (err) {
					return onMessageValidationError(ws, err)
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
		if (bodyValidator) {
			let decoded: unknown

			try {
				decoded = validateMessageBody(message)
			} catch (error) {
				return onMessageValidationError(ws, error)
			}

			if (decoded instanceof Promise)
				return decoded.then(
					(m) => runMessageSync(ws, m),
					(error) => onMessageValidationError(ws, error)
				)

			message = decoded
		}

		return runMessageSync(ws, message)
	}

	function runMessageSync(
		ws: ElysiaWS<any>,
		message: unknown
	): void | Promise<void> {
		try {
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
			const p = parseMessage(ws as any, rawMessage)
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
		? async (connection: ElysiaWS<any>, code: number, reason: string) => {
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
				let r = validateUpgradeChannel(
					validators.params as any,
					context.params ?? nullObject(),
					'params'
				)
				if (r instanceof Promise) r = await r
				context.params = r as any
			}
			if (validators.query) {
				const url = request.url
				const query = parseQueryFromURL(
					url,
					(context as any).qi ?? url.indexOf('?'),
					queryArray,
					queryObject
				)

				let r = validateUpgradeChannel(
					validators.query as any,
					query,
					'query'
				)
				if (r instanceof Promise) r = await r
				;(context as any).query = r
			}

			if (validators.headers) {
				const headers = isBun
					? request.headers.toJSON()
					: Object.fromEntries(request.headers)

				let r = validateUpgradeChannel(
					validators.headers as any,
					headers,
					'headers'
				)
				if (r instanceof Promise) r = await r
				;(context as any).headers = r
			}

			for (let i = 0; i < transforms.length; i++) {
				const r = transforms[i](context as any)
				if (r instanceof Promise) await r
			}

			for (let i = 0; i < allBeforeHandles.length; i++) {
				const fn = allBeforeHandles[i]
				let r: unknown = fn(context as any)
				if (r instanceof Promise) r = await r

				const deriveMode = upgradeDeriveModes?.[i]

				if (deriveMode !== undefined && !(r instanceof ElysiaStatus)) {
					if (r && typeof r === 'object') {
						if (deriveMode)
							context = replaceDeriveContext(context, r)
						else Object.assign(context as any, r)
					}
				} else if (r !== undefined) {
					if (r instanceof Response) return r

					return mapResponse(
						r,
						(context as any).set,
						(context as any).request
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
				return problemResponse({
					status: 500,
					type: 'internal-server-error',
					title: 'Internal Server Error',
					detail: 'WebSocket upgrade requires a running server. Call .listen() first.'
				})

			const upgraded = server.upgrade(request, {
				headers: upgradeHeaders,
				data: {
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
				} satisfies WSConnectionData
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
	for (const k of wsOptions)
		if ((hook as any)[k] !== undefined)
			(options as any)[k] = (hook as any)[k]

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
			const elyWs = getElysia(ws)

			drainWaiters(elyWs)
			ws.data.drain?.(elyWs)
		},
		close(ws, code, reason) {
			const elyWs = getElysia(ws)
			drainWaiters(elyWs)

			if (ws.data.closeHandlerInvoked) return
			ws.data.closeHandlerInvoked = true
			ws.data.close?.(elyWs, code, reason)
		},
		ping(ws, data) {
			ws.data.ping?.(getElysia(ws), data)
		},
		pong(ws, data) {
			ws.data.pong?.(getElysia(ws), data)
		}
	}
}
