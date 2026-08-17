import { RouteValidator } from '../validator/route'
import { StandardValidator } from '../validator'
import {
	buildFrozenRouteValidator,
	isBridgeNotInitialized
} from '../compile/handler/frozen-validator'
import { isBridgeLive } from '../type/bridge'
import {
	assignOwn,
	deriveEntryFn,
	isNotEmpty,
	isSocketQuiet,
	nullObject,
	type DeriveEntry
} from '../utils'
import { frozenRootOf } from '../generation'
import { sucrose } from '../sucrose'
import { parseQueryFromURL } from '../parse-query'
import { compileCookieConfig } from '../cookie/config'
import {
	buildCookieJar,
	hasSyncHmac,
	parseCookieRaw,
	parseCookieRawDeferred,
	parseCookieRawLazy
} from '../cookie/utils'
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

import {
	ElysiaWS,
	isGeneratorObject,
	trackWSSettling,
	type WSConnectionData
} from './context'
import { createMessageParser } from './parser'
import {
	ElysiaError,
	ElysiaStatus,
	ValidationError,
	internalServerErrorBodyString,
	problemBody,
	problemResponse
} from '../error'

import {
	adoptErrorType,
	claimsProblemType,
	createErrorHandler,
	readAnnotation,
	resolveStatus,
	statusFallbackBody
} from '../handler/error'

import { isBun } from '../universal/constants'
import { mapResponse } from '../adapter/web-standard/handler'

import type { AnyElysia } from '../base'
import type { Context } from '../context'
import type {
	AnyWSLocalHook,
	WSValidatorLike,
	ServerWebSocket,
	WebSocketHandler,
	WSOptions,
	WSOptionsEntry
} from './types'
import type { InternalRoute, AppHook } from '../types'

type AnyFn = (...args: any[]) => any
type Server = {
	upgrade(request: Request, options?: { headers?: any; data?: any }): boolean
}

const EMPTY_HOOKS: readonly AnyFn[] = Object.freeze([]) as any

/**
 * Build-time (route-registration-time) analysis of a WS `message` handler to
 * decide whether the per-frame `ws.body` view must be assigned.
 */
function handlerMayTouchBody(fn: AnyFn | undefined): boolean {
	if (!fn) return false

	let source: string
	try {
		source = Function.prototype.toString.call(fn)
	} catch {
		return true
	}

	if (source.indexOf('[native code]') !== -1) return true

	if (/\bbody\b/.test(source)) return true
	if (/\barguments\b/.test(source)) return true
	if (source.indexOf('[') !== -1) return true
	if (source.indexOf('...') !== -1) return true

	const parsed = firstParamIdentifier(source)
	if (parsed === undefined) return true

	const { name: wsName, bodyStart, paramsEnd } = parsed

	if (source.slice(0, paramsEnd).indexOf('(', 1) !== -1) return true

	const body = source.slice(bodyStart)

	const safeName = wsName.replace(/[$]/g, '\\$&')
	const escaped = new RegExp(`(?<![\\w$.])${safeName}(?![\\w$]|\\s*\\.)`)

	if (escaped.test(body)) return true

	return false
}

function firstParamIdentifier(
	source: string
): { name: string; bodyStart: number; paramsEnd: number } | undefined {
	const open = source.indexOf('(')
	if (open === -1) {
		const m = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(source)
		if (!m) return undefined
		const end = m.index + m[0].length
		return { name: m[1], bodyStart: end, paramsEnd: end }
	}

	// Find the matching close paren of the parameter list.
	let depth = 0
	let close = -1
	for (let i = open; i < source.length; i++) {
		const c = source[i]
		if (c === '(') depth++
		else if (c === ')') {
			depth--
			if (depth === 0) {
				close = i
				break
			}
		}
	}
	if (close === -1) return undefined

	const params = source.slice(open + 1, close).trim()
	if (params.length === 0) return undefined

	// First param up to the first top-level comma.
	let first = params
	const comma = params.indexOf(',')
	if (comma !== -1) first = params.slice(0, comma).trim()

	// Destructuring patterns handled by the `body`/`...`/`[` checks above.
	if (first[0] === '{' || first[0] === '[') return undefined

	const m = /^([A-Za-z_$][\w$]*)/.exec(first)
	if (!m) return undefined

	return { name: m[1], bodyStart: close + 1, paramsEnd: close + 1 }
}

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

/**
 * Frame served by an error that claims an RFC 9457 problem document, mirroring
 * the HTTP tiers in `handler/error.ts`: `value` replaces the whole frame,
 * `detail` fills the `detail` member, the message is the last resort.
 *
 * A frame carries no headers, so a `headers` annotation is ignored outright
 * rather than half-applied
 */
function wsProblemFrame(error: any): string | Promise<string> {
	const status = resolveStatus(error.status)
	const served = typeof status === 'number' && status >= 100 ? status : 500

	const stringify = (value: unknown) =>
		typeof value === 'object' && value !== null
			? JSON.stringify(value)
			: String(value)

	const problemFrame = (detail: unknown) =>
		JSON.stringify(
			problemBody({
				type: error.type ?? 'about:blank',
				detail: detail as string,
				status: served
			})
		)

	const serveMessage = () => problemFrame(statusFallbackBody(error, served))
	const serveDetail = () => {
		const detail = readAnnotation(error, 'detail', true)

		if (detail === undefined) return serveMessage()

		if (detail instanceof Promise)
			return detail
				.then((resolved: unknown) =>
					resolved === undefined
						? serveMessage()
						: problemFrame(resolved)
				)
				.catch(() => wsLegacyFrame(error))

		return problemFrame(detail)
	}

	const value = readAnnotation(error, 'value', true)
	if (value === undefined) return serveDetail()

	if (value instanceof Promise)
		return value
			.then((resolved: unknown) =>
				resolved === undefined ? serveDetail() : stringify(resolved)
			)
			.catch(() => wsLegacyFrame(error))

	return stringify(value)
}

function wsErrorFrameFallback(error: any): string | Promise<string> {
	if (claimsProblemType(error))
		try {
			return wsProblemFrame(error)
		} catch {}

	return wsLegacyFrame(error)
}

/** Frame an error that never self-described has always served */
function wsLegacyFrame(error: any): string {
	if (error?.status) {
		const body = statusFallbackBody(error, error.status)

		return typeof body === 'object' ? JSON.stringify(body) : String(body)
	}

	return internalServerErrorBodyString(error)
}

function sendErrorFrame(ws: ElysiaWS<any>, error: unknown) {
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
	type: 'params' | 'query' | 'headers' | 'cookie'
): unknown | Promise<unknown> {
	if (validator instanceof StandardValidator)
		return validator.From(value, type)

	if (validator.hasCodec) return validator.From(value, type)

	return validator.EncodeFrom(value, type)
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

	const instance = (route[3] as AnyElysia | undefined) ?? app
	const appHookChain = route[5] as Parameters<typeof composeRouteHook>[2]
	const inheritedChain = route[6] as Parameters<typeof composeRouteHook>[3]

	const composed = (composeRouteHook(
		instance,
		route[4] as AnyWSLocalHook | undefined,
		appHookChain,
		inheritedChain,
		app,
		route[7] as AnyElysia | undefined
	) ?? hook) as AnyWSLocalHook

	let validators: RouteValidator<any>

	// fall through to RouteValidator when no frozen validator exists
	// so the error surfaces as today
	const frozenEager = isBridgeLive()
		? undefined
		: buildFrozenRouteValidator(
				composed as any,
				app,
				'WS',
				route[1] as string
			)

	if (frozenEager) validators = frozenEager as any
	else
		try {
			validators = new RouteValidator(composed as any, {
				models: frozenRootOf(app)['~ext']?.models,
				app,
				// same app-level resolution HTTP uses: both are enforcement
				// controls, and binding on one transport only is a gap
				normalize: frozenRootOf(app)['~config']?.normalize,
				sanitize: frozenRootOf(app)['~config']?.sanitize,
				schemas: (composed as { schemas?: any }).schemas,
				aot: { method: 'WS', path: route[1] },
				eager: frozenRootOf(app)['~config']?.precompile
			})
		} catch (error) {
			if (!isBridgeNotInitialized(error)) throw error

			const frozen = buildFrozenRouteValidator(
				composed as any,
				app,
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

	const cookieIsOptional = !!(composed.cookie as any)?.['~optional']

	const queryChannels = getQueryParseChannels(
		(validators.query as any)?.schema
	)
	const queryArray = queryChannels?.array
	const queryObject = queryChannels?.object

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

	// same handler analysis HTTP compiles with: a hook touching
	// headers/query/cookie materializes the channel even without a schema
	const inference = sucrose(hook.message as any, {
		beforeHandle: [
			...allBeforeHandles,
			hook.open,
			hook.close,
			hook.drain,
			hook.ping,
			hook.pong,
			typeof hook.upgrade === 'function' ? hook.upgrade : undefined
		].filter(Boolean) as any,
		parse: parseHooks as any,
		transform: transforms as any,
		error: errorHandlers as any,
		afterHandle: afterHandles as any,
		mapResponse: mapResponses as any,
		afterResponse: afterResponses as any
	})

	const cookieConfig =
		validators.cookie || inference.cookie
			? compileCookieConfig(
					composed.cookie as any,
					frozenRootOf(app)['~config']?.cookie as any
				)
			: undefined

	const parseMessage = createMessageParser(parseHooks as any)

	const handleUpgradeError = createErrorHandler(
		errorHandlers.length ? (errorHandlers as any) : undefined,
		((response: unknown, set: Context['set'], context?: Context) =>
			mapResponse(
				response,
				set,
				(context as { request?: Request } | undefined)?.request
			)) as any,
		undefined,
		frozenRootOf(app)['~config']?.allowUnsafeValidationDetails
	)

	async function handleError(ws: ElysiaWS<any>, error: unknown) {
		const errCtx: any = Object.create(ws as any)
		errCtx.error = error
		if (
			frozenRootOf(app)['~config']?.allowUnsafeValidationDetails &&
			error instanceof ValidationError
		)
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
				// A hook that produced an untyped problem inherits the
				// intercepted error's `type`, same as the HTTP handler
				r = adoptErrorType(r, error)

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

	function onMessageValidationError(ws: ElysiaWS<any>, error: unknown) {
		if (errorHandlers.length === 0) {
			if (
				frozenRootOf(app)['~config']?.allowUnsafeValidationDetails &&
				error instanceof ValidationError
			)
				(error as ValidationError).allowUnsafeValidationDetails = true

			return sendErrorFrame(ws, error)
		}

		return handleError(ws, error)
	}

	const messageHandlerTouchesBody =
		!!bodyValidator ||
		handlerMayTouchBody(hook.message as AnyFn | undefined) ||
		errorHandlers.some(handlerMayTouchBody)

	const syncDispatchEligible =
		transforms.length === 0 &&
		messageBeforeHandles.length === 0 &&
		afterHandles.length === 0 &&
		afterResponses.length === 0 &&
		mapResponses.length === 0

	function finishMessageResult(ws: ElysiaWS<any>, value: unknown) {
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

	function dispatchParsedSync(ws: ElysiaWS<any>, message: unknown) {
		if (bodyValidator) {
			let decoded: unknown

			try {
				decoded = validateMessageBody(message)
			} catch (error) {
				return onMessageValidationError(ws, error)
			}

			if (decoded instanceof Promise)
				return decoded.then(
					(m) => runMessage(ws, m),
					(error) => onMessageValidationError(ws, error)
				)

			message = decoded
		}

		return runMessage(ws, message)
	}

	function runMessageSync(ws: ElysiaWS<any>, message: unknown) {
		try {
			if (messageHandlerTouchesBody) ws.body = message as any

			const result = (hook.message as AnyFn)(ws, message)

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

			const result = (hook.message as AnyFn)(ws, message)
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
	) {
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
			} else if (inference.query) {
				const url = request.url
				;(context as any).query = parseQueryFromURL(
					url,
					(context as any).qi ?? url.indexOf('?')
				)
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
			} else if (inference.headers) {
				;(context as any).headers = isBun
					? request.headers.toJSON()
					: Object.fromEntries(request.headers)
			}

			if (cookieConfig) {
				const cookieHeader = request.headers.get('cookie')

				// read/verify surface only: an accepted upgrade carries no
				// response for `set.cookie` writes to ride on
				if (validators.cookie) {
					const raw = await parseCookieRaw(cookieHeader, cookieConfig)

					let r: unknown = raw
					if (!cookieIsOptional || Object.keys(raw).length) {
						r = validateUpgradeChannel(
							validators.cookie as any,
							raw,
							'cookie'
						)
						if (r instanceof Promise) r = await r
					}

					;(context as any).cookie = buildCookieJar(
						(context as any).set,
						r as any,
						cookieConfig
					)
				} else if (!cookieConfig.hasSign) {
					// unvalidated lanes mirror HTTP: defer decode/verification
					// to first access instead of failing the upgrade eagerly
					;(context as any).cookie = buildCookieJar(
						(context as any).set,
						parseCookieRawDeferred(cookieHeader, cookieConfig),
						cookieConfig,
						undefined,
						1
					)
				} else if (hasSyncHmac && cookieConfig.verify === 'lazy') {
					;(context as any).cookie = buildCookieJar(
						(context as any).set,
						parseCookieRawLazy(cookieHeader, cookieConfig),
						cookieConfig,
						1
					)
				} else {
					;(context as any).cookie = buildCookieJar(
						(context as any).set,
						await parseCookieRaw(cookieHeader, cookieConfig),
						cookieConfig
					)
				}
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
						else assignOwn(context as any, r)
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
					id: undefined,
					context: context as any,
					validator: responseValidator,
					defaultValidator: defaultResponseValidator,
					open: onOpen as any,
					message: hook.message ? dispatchMessageSync : undefined,
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

	const options: Partial<WebSocketHandler<any>> = nullObject()
	for (const k of wsOptions)
		if ((hook as any)[k] !== undefined)
			(options as any)[k] = (hook as any)[k]

	return [fetchHandler, options] as const
}

export function resolveWSOptions(
	entries: WSOptionsEntry[]
): WSOptions | undefined {
	if (!entries || entries.length === 0) return undefined
	if (entries.length === 1) return { ...entries[0].value }

	const ordered = entries
		.map((entry, index) => ({ entry, index }))
		.sort((a, b) => b.entry.depth - a.entry.depth || a.index - b.index)

	const result = {} as WSOptions
	let warned: Set<string> | undefined

	for (const { entry } of ordered)
		for (const key in entry.value) {
			const incoming = (entry.value as any)[key]
			if (
				key in result &&
				(result as any)[key] !== incoming &&
				!warned?.has(key)
			) {
				;(warned ??= new Set()).add(key)
				console.warn(
					`[Elysia] Conflicting WebSocket option '${key}' across .use(websocket()). Using nearest-root registration.`
				)
			}

			;(result as any)[key] = incoming
		}

	return result
}

const wsLimits = ['maxPayloadLength', 'backpressureLimit', 'idleTimeout']
const routeOwnedKeys = new WeakMap<WSOptions, Set<string>>()

export function accumulateWSOptions(
	target: WSOptions,
	routeOptions: WSOptions,
	_path: string
) {
	if (!isNotEmpty(routeOptions)) return

	let owned = routeOwnedKeys.get(target)
	if (!owned) routeOwnedKeys.set(target, (owned = new Set()))

	for (const key in routeOptions) {
		const incoming = (routeOptions as any)[key]
		const current = (target as any)[key]

		if (key in target && current !== incoming) {
			if (isBun) {
				console.warn(
					`[Elysia] Conflicting per-route WebSocket option '${key}'\nBun uses one global WebSocket config per server, per-route values are not enforced (for limits the strictest route wins, otherwise the last-registered route).`
				)
				console.warn(new Error().stack)
			}

			// deliberately not gated on `isBun`: the merge, not the warning,
			// is where the safety lives
			if (
				owned.has(key) &&
				typeof current === 'number' &&
				typeof incoming === 'number' &&
				current < incoming &&
				wsLimits.includes(key)
			)
				continue
		}

		owned.add(key)
		;(target as any)[key] = incoming
	}
}

const MAX_INFLIGHT_MESSAGES = 256

export function buildGlobalWSHandler(): WebSocketHandler<WSConnectionData> {
	let lifecycle:
		| {
				closing: boolean
				sockets: Set<ServerWebSocket<WSConnectionData>>
				run<T, Args extends unknown[]>(
					callback: (...args: Args) => T,
					...args: Args
				): T
		  }
		| undefined
	const runLifecycle = <T, Args extends unknown[]>(
		callback: (...args: Args) => T,
		...args: Args
	) => (lifecycle ? lifecycle.run(callback, ...args) : callback(...args))
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
	const releaseLifecycle = (ws: ServerWebSocket<WSConnectionData>) => {
		if (!lifecycle?.closing && isSocketQuiet(ws)) {
			delete (
				ws.data as WSConnectionData & { '~lifecycleRun'?: unknown }
			)['~lifecycleRun']
			lifecycle?.sockets.delete(ws)
		}
	}

	const release = (ws: ServerWebSocket<WSConnectionData>) => {
		const data = ws.data
		const inflight = data.inflight
		if (inflight) {
			data.inflight = inflight - 1
			if (inflight === 1 && data.closeHandlerInvoked) releaseLifecycle(ws)
		}
	}

	function dispatch(
		ws: ServerWebSocket<WSConnectionData>,
		message: string | Buffer
	) {
		let result
		try {
			// ponytail: ALS costs ~12ns/frame here. Async message -> default stop
			// keeps its baseline self-wait; add request provenance only by contract.
			result = ws.data.message!(getElysia(ws), message)
		} catch (error) {
			// Sync throw from dispatch: send a last-resort frame and bail.
			release(ws)
			sendErrMsg(ws, error)
			return
		}

		if (result instanceof Promise)
			result.then(
				() => release(ws),
				(error) => {
					release(ws)
					sendErrMsg(ws, error)
				}
			)
		else release(ws)
	}

	const handler: WebSocketHandler<WSConnectionData> = {
		message(ws, message) {
			if (lifecycle?.closing) return
			const data = ws.data
			if (!data.message) return

			const inflight = (data.inflight ?? 0) + 1
			if (inflight > MAX_INFLIGHT_MESSAGES) {
				try {
					ws.close(1013, 'Too many in-flight messages')
				} catch {}
				return
			}
			data.inflight = inflight

			const opening = data.opening
			if (opening)
				return void opening.then(() => {
					if (lifecycle?.closing || ws.readyState > 1)
						return release(ws)
					dispatch(ws, message)
				})

			dispatch(ws, message)
		},
		open(ws) {
			if (lifecycle)
				Object.defineProperty(ws.data, '~lifecycleRun', {
					configurable: true,
					value: lifecycle.run
				})
			lifecycle?.sockets.add(ws)
			if (lifecycle?.closing) {
				// The open handler never ran, so the close handler must not
				// tear down state that was never acquired
				ws.data.closeHandlerInvoked = true
				try {
					ws.terminate()
				} catch {}
				return
			}

			const open = ws.data.open
			const result = open && runLifecycle(open, getElysia(ws))
			if (result instanceof Promise) {
				const clear = () => {
					ws.data.opening = undefined
					releaseLifecycle(ws)
				}
				ws.data.opening = result.then(clear, clear)
			}
		},
		drain(ws) {
			if (lifecycle?.closing) return
			const elyWs = getElysia(ws)

			drainWaiters(elyWs)
			const drain = ws.data.drain
			trackWSSettling(ws.data, drain && runLifecycle(drain, elyWs), () =>
				releaseLifecycle(ws)
			)
		},
		close(ws, code, reason) {
			const elyWs = getElysia(ws)
			drainWaiters(elyWs)

			if (ws.data.closeHandlerInvoked) return releaseLifecycle(ws)
			ws.data.closeHandlerInvoked = true

			let result: void | Promise<void>
			try {
				const close = ws.data.close
				result = close && runLifecycle(close, elyWs, code, reason)
			} finally {
				if (!(result! instanceof Promise)) releaseLifecycle(ws)
			}
			if (result instanceof Promise) {
				const closing = result.catch(() => {})
				trackWSSettling(ws.data, closing, () => releaseLifecycle(ws))
			}
		},
		ping(ws, data) {
			if (lifecycle?.closing) return
			const ping = ws.data.ping
			trackWSSettling(
				ws.data,
				ping && runLifecycle(ping, getElysia(ws), data),
				() => releaseLifecycle(ws)
			)
		},
		pong(ws, data) {
			if (lifecycle?.closing) return
			const pong = ws.data.pong
			trackWSSettling(
				ws.data,
				pong && runLifecycle(pong, getElysia(ws), data),
				() => releaseLifecycle(ws)
			)
		}
	}

	Object.defineProperty(handler, '~lifecycle', {
		set(value) {
			lifecycle = value
		}
	})

	return handler
}
