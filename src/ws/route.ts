import { RouteValidator } from '../validator/route'
import { StandardValidator } from '../validator'
import { isTypeboxInitialized } from '../type/bridge'
import { buildFrozenRouteValidator } from '../compile/handler/frozen-validator'
import { deriveEntryFn, nullObject, type DeriveEntry } from '../utils'
import { frozenRootOf, type RuntimeServerBinding } from '../generation'
import { getQueryParseChannels, parseQueryFromURL } from '../parse-query'
import { deriveModes, replaceDeriveContext } from '../compile/handler/utils'
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
	isProduction,
	problemBody,
	problemResponse
} from '../error'

import { createErrorHandler } from '../handler/error'

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

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
	value !== null &&
	(typeof value === 'object' || typeof value === 'function') &&
	typeof (value as any).then === 'function'

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

		return typeof body === 'object' ? JSON.stringify(body) : String(body)
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

function validateUpgradeChannel(
	validator: any,
	value: unknown,
	type: 'params' | 'query' | 'headers'
): unknown | Promise<unknown> {
	if (validator instanceof StandardValidator)
		return validator.From(value, type)

	if (validator.hasCodec) return validator.From(value, type)

	return validator.EncodeFrom(value, type)
}

interface WSRouteRuntimePlan {
	validators: RouteValidator<any>
	responseValidator: { [status: number]: WSValidatorLike } | undefined
	defaultResponseValidator: WSValidatorLike | undefined
	queryPlan: any
	fusedQuery: boolean
	queryArray: any
	queryObject: any
	transforms: readonly AnyFn[]
	allBeforeHandles: readonly AnyFn[]
	upgradeDeriveModes: ReturnType<typeof deriveModes>
	messageBeforeHandles: readonly AnyFn[]
	afterHandles: readonly AnyFn[]
	mapResponses: readonly AnyFn[]
	afterResponses: readonly AnyFn[]
	errorHandlers: readonly AnyFn[]
	parseMessage: ReturnType<typeof createMessageParser>
	messageHandler: AnyFn | undefined
	openHandler: AnyFn | undefined
	drainHandler: AnyFn | undefined
	closeHandler: AnyFn | undefined
	pingHandler: AnyFn | undefined
	pongHandler: AnyFn | undefined
	upgradeHook: unknown
	allowUnsafeValidationDetails: boolean
	compatCancellation: boolean
	serverBinding: RuntimeServerBinding | undefined
}

function createWSRouteRuntime({
	validators,
	responseValidator,
	defaultResponseValidator,
	queryPlan,
	fusedQuery,
	queryArray,
	queryObject,
	transforms,
	allBeforeHandles,
	upgradeDeriveModes,
	messageBeforeHandles,
	afterHandles,
	mapResponses,
	afterResponses,
	errorHandlers,
	parseMessage,
	messageHandler,
	openHandler,
	drainHandler,
	closeHandler,
	pingHandler,
	pongHandler,
	upgradeHook,
	allowUnsafeValidationDetails,
	compatCancellation,
	serverBinding
}: WSRouteRuntimePlan) {
	const handleUpgradeError = createErrorHandler(
		errorHandlers.length ? (errorHandlers as any) : undefined,
		((response: unknown, set: Context['set'], context?: Context) =>
			mapResponse(
				response,
				set,
				(context as { request?: Request } | undefined)?.request
			)) as any,
		undefined,
		allowUnsafeValidationDetails,
		compatCancellation
	)

	async function handleError(ws: ElysiaWS<any>, error: unknown) {
		const errCtx: any = Object.create(ws as any)
		errCtx.error = error
		if (allowUnsafeValidationDetails && error instanceof ValidationError)
			error.allowUnsafeValidationDetails = true

		for (let i = 0; i < errorHandlers.length; i++) {
			let r: unknown
			try {
				r = errorHandlers[i](errCtx)
				if (r instanceof Promise) r = await r
			} catch {
				break
			}

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

		return bodyValidator.EncodeFrom(message, 'body')
	}

	function onMessageValidationError(
		ws: ElysiaWS<any>,
		error: unknown
	): void | Promise<void> {
		if (errorHandlers.length === 0) {
			if (
				allowUnsafeValidationDetails &&
				error instanceof ValidationError
			)
				(error as ValidationError).allowUnsafeValidationDetails = true

			return sendErrorFrame(ws, error)
		}

		return handleError(ws, error)
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

			if (isThenable(decoded))
				return Promise.resolve(decoded).then(
					(m) => runMessage(ws, m),
					(error) => onMessageValidationError(ws, error)
				)

			message = decoded
		}

		return runMessage(ws, message)
	}

	function runMessageSync(
		ws: ElysiaWS<any>,
		message: unknown
	): void | Promise<void> {
		try {
			ws.body = message as any

			const result = messageHandler!(ws, message)

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

	async function runMessageFull(ws: ElysiaWS<any>, message: unknown) {
		try {
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

			const result = messageHandler!(ws, message)
			const resolved = result instanceof Promise ? await result : result

			if (resolved !== undefined)
				await handleWSResponse(ws, resolved, mapResponses)

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

	const runMessage = syncDispatchEligible ? runMessageSync : runMessageFull

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

	function wrapLifecycle(fn: AnyFn | undefined, withBody: boolean) {
		if (!fn) return

		return async (connection: ElysiaWS<any>, bodyArg?: unknown) => {
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

	const onOpen = wrapLifecycle(openHandler, false)
	const onDrain = wrapLifecycle(drainHandler, false)
	const onPing = wrapLifecycle(pingHandler, true)
	const onPong = wrapLifecycle(pongHandler, true)
	const onClose = closeHandler
		? async (connection: ElysiaWS<any>, code: number, reason: string) => {
				const ws: ElysiaWS<any> = Object.create(connection)
				try {
					;(ws as any).code = code
					;(ws as any).reason = reason

					const result = closeHandler(ws, code, reason)
					const resolved =
						result instanceof Promise ? await result : result

					await handleWSResponse(ws, resolved, mapResponses)
				} catch (error) {
					await handleError(ws, error)
				}
			}
		: undefined

	return async (context: Context) => {
		const request = context.request

		try {
			if (validators.params) {
				let r = validateUpgradeChannel(
					validators.params as any,
					context.params ?? nullObject(),
					'params'
				)
				if (isThenable(r)) r = await r
				context.params = r as any
			}
			if (validators.query) {
				const url = request.url
				const query = fusedQuery
					? queryPlan.fromURL!(
							url,
							(context as any).qi ?? url.indexOf('?')
						)
					: queryPlan
						? queryPlan.parse(
								url,
								(context as any).qi ?? url.indexOf('?'),
								queryPlan.array,
								queryPlan.object
							)
						: parseQueryFromURL(
								url,
								(context as any).qi ?? url.indexOf('?'),
								queryArray,
								queryObject
							)

				if (fusedQuery) {
					;(context as any).query = queryPlan.validate!(
						query,
						validators.query as any
					)
				} else {
					let r = validateUpgradeChannel(
						validators.query as any,
						query,
						'query'
					)
					if (isThenable(r)) r = await r
					;(context as any).query = r
				}
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
				if (isThenable(r)) r = await r
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
			if (upgradeHook != null) {
				const r =
					typeof upgradeHook === 'function'
						? (upgradeHook as AnyFn)(context as any)
						: upgradeHook
				const resolved = r instanceof Promise ? await r : r
				if (resolved && typeof resolved === 'object')
					upgradeHeaders = resolved as Record<string, string>
			}

			const server =
				((context as any).server as Server | null | undefined) ??
				serverBinding?.current ??
				null
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
					id: undefined,
					context: context as any,
					validator: responseValidator,
					defaultValidator: defaultResponseValidator,
					open: onOpen as any,
					message: messageHandler ? dispatchMessageSync : undefined,
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
			return handleUpgradeError(context, error as Error) as
				| Response
				| Promise<Response>
		}
	}
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
	app: AnyElysia,
	serverBinding?: RuntimeServerBinding
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

	const frozenRoot = frozenRootOf(app)
	const allowUnsafeValidationDetails =
		frozenRoot['~config']?.allowUnsafeValidationDetails === true
	const compatCancellation =
		frozenRoot['~config']?.experimental?.cancellation === 'compat'
	let validators = !isTypeboxInitialized()
		? (buildFrozenRouteValidator(
				hook as any,
				app,
				'WS',
				route[1] as string
			) as RouteValidator<any> | undefined)
		: undefined
	if (!validators)
		validators = new RouteValidator(hook as any, {
			models: frozenRoot['~ext']?.models,
			app,
			validationPlan: frozenRoot['~config']?.experimental?.validationPlan,
			aot: { method: 'WS', path: route[1] }
		})

	const responseValidator = validators.response as
		| { [status: number]: WSValidatorLike }
		| undefined

	const defaultResponseValidator = responseValidator
		? (responseValidator[200] ??
			responseValidator[Object.keys(responseValidator)[0] as any])
		: undefined

	const queryPlan = !!frozenRoot['~config']?.experimental?.validationPlan
		? validators.queryPlan
		: undefined
	const fusedQuery =
		!!queryPlan?.fused && !!(validators.query as any)?.hasCodec
	const queryChannels = queryPlan
		? undefined
		: getQueryParseChannels((validators.query as any)?.schema)
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
	const messageHandler = hook.message as AnyFn | undefined
	const closeHandler = hook.close as AnyFn | undefined
	const upgradeHook = hook.upgrade
	const options: Partial<WebSocketHandler<any>> = nullObject()
	for (const k of wsOptions)
		if ((hook as any)[k] !== undefined)
			(options as any)[k] = (hook as any)[k]

	return [
		createWSRouteRuntime({
			validators,
			responseValidator,
			defaultResponseValidator,
			queryPlan,
			fusedQuery,
			queryArray,
			queryObject,
			transforms,
			allBeforeHandles,
			upgradeDeriveModes,
			messageBeforeHandles,
			afterHandles,
			mapResponses,
			afterResponses,
			errorHandlers,
			parseMessage,
			messageHandler,
			openHandler: hook.open as AnyFn | undefined,
			drainHandler: hook.drain as AnyFn | undefined,
			closeHandler,
			pingHandler: hook.ping as AnyFn | undefined,
			pongHandler: hook.pong as AnyFn | undefined,
			upgradeHook,
			allowUnsafeValidationDetails,
			compatCancellation,
			serverBinding
		}),
		options
	] as const
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

	const sendErrMsg = (ws: ServerWebSocket<any>, error: unknown) => {
		try {
			ws.send(
				typeof (error as any)?.message === 'string'
					? (error as any).message
					: 'Internal Server Error'
			)
		} catch {}
	}

	return {
		message(ws, message) {
			let result: void | Promise<void>
			try {
				result = ws.data.message?.(getElysia(ws), message)
			} catch (error) {
				// Sync throw from dispatch: send a last-resort frame and bail.
				sendErrMsg(ws, error)
				return
			}
			if (result instanceof Promise)
				result.catch((error) => sendErrMsg(ws, error))
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

export function buildWebSocketRuntime(
	config?: Partial<WebSocketHandler<WSConnectionData>>
): WebSocketHandler<WSConnectionData> {
	const handler = buildGlobalWSHandler()
	return config ? Object.assign(handler, config) : handler
}
