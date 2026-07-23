import { RouteValidator } from '../validator/route'
import { StandardValidator } from '../validator'
import { isTypeboxInitialized } from '../type/bridge'
import { buildFrozenRouteValidator } from '../compile/handler/frozen-validator'
import { createErrorHandler } from '../handler/error'
import { mapResponse } from '../adapter/web-standard/handler'
import { isBun } from '../universal/constants'
import { deriveEntryFn, nullObject, type DeriveEntry } from '../utils'
import { frozenRootOf } from '../generation'
import { getQueryParseChannels, parseQueryFromURL } from '../parse-query'
import { deriveModes, replaceDeriveContext } from '../compile/handler/utils'
import { createBaseContext } from '../context'
import {
	ElysiaError,
	ElysiaStatus,
	ValidationError,
	internalServerErrorBodyString,
	isProduction,
	problemBody,
	problemResponse
} from '../error'

import { ElysiaWS, isGeneratorObject, type WSConnectionData } from './context'
import { createMessageParser } from './parser'

import type { RuntimeServerBinding } from '../generation'
import type { FrozenValidator, ValidatorSlot } from '../compile/aot'
import type { AnyElysia } from '../base'
import type { Context } from '../context'
import type { AppHook } from '../types'
import type {
	ServerWebSocket,
	WebSocketHandler,
	WSValidatorLike,
	AnyWSLocalHook
} from './types'

export type WSAnyFn = (...args: any[]) => any

const createFrameView = (connection: ElysiaWS<any>): ElysiaWS<any> =>
	Object.create(connection)

type Server = {
	upgrade(request: Request, options?: { headers?: any; data?: any }): boolean
}

const WS_OPTIONS = [
	'maxPayloadLength',
	'backpressureLimit',
	'closeOnBackpressureLimit',
	'idleTimeout',
	'publishToSelf',
	'sendPings',
	'perMessageDeflate'
] as const

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
	value !== null &&
	(typeof value === 'object' || typeof value === 'function') &&
	typeof (value as any).then === 'function'

interface FunctionAccess {
	keys: Set<string> | null
	body: boolean
	mutates: boolean
}

function firstParam(
	source: string
): { name?: string; bodyStart: number; parameterTail?: string } | undefined {
	const open = source.indexOf('(')
	if (open === -1) {
		const arrow = /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(source)
		if (!arrow) return
		return { name: arrow[1], bodyStart: arrow[0].length }
	}

	let depth = 0
	let close = -1
	for (let i = open; i < source.length; i++) {
		if (source[i] === '(') depth++
		else if (source[i] === ')' && --depth === 0) {
			close = i
			break
		}
	}
	if (close === -1) return
	const parameters = source.slice(open + 1, close)
	const comma = parameters.indexOf(',')
	const parameter = (
		comma === -1 ? parameters : parameters.slice(0, comma)
	).trim()
	if (!parameter) return { bodyStart: close + 1 }
	if (!/^[A-Za-z_$][\w$]*$/.test(parameter)) return
	return {
		name: parameter,
		bodyStart: close + 1,
		parameterTail: comma === -1 ? undefined : parameters.slice(comma + 1)
	}
}

function analyzeFunction(fn: WSAnyFn | undefined): FunctionAccess {
	const opaque = { keys: null, body: true, mutates: true } as const
	if (!fn) return { keys: new Set(), body: false, mutates: false }
	let source: string
	try {
		source = Function.prototype.toString.call(fn)
	} catch {
		return opaque
	}
	if (
		source.includes('[native code]') ||
		/\barguments\b|\beval\s*\(/.test(source)
	)
		return opaque

	const parameter = firstParam(source)
	if (!parameter) return opaque
	if (!parameter.name) return { keys: new Set(), body: false, mutates: false }

	const body = source.slice(parameter.bodyStart)
	const name = parameter.name.replace(/[$]/g, '\\$&')
	const occurrence = new RegExp(`(^|[^\\w$])${name}(?![\\w$])`, 'g')
	if (parameter.parameterTail && occurrence.test(parameter.parameterTail))
		return opaque
	occurrence.lastIndex = 0
	const keys = new Set<string>()
	let mutates = false
	let match: RegExpExecArray | null

	while ((match = occurrence.exec(body))) {
		const index = match.index + match[1].length
		if (body[index - 1] === '.') continue
		const tail = body.slice(match.index + match[0].length)
		const member = /^\s*(?:\?\.)?\.\s*([A-Za-z_$][\w$]*)/.exec(tail)
		const computed = /^\s*(?:\?\.)?\[\s*(['"])([^'"]+)\1\s*\]/.exec(tail)
		const property = member?.[1] ?? computed?.[2]
		if (!property) return opaque
		keys.add(property)

		const after = tail.slice((member?.[0] ?? computed![0]).length)
		if (/^\s*(?:\+\+|--|=(?!=)|\+=|-=|\*=|\/=|&&=|\|\|=|\?\?=)/.test(after))
			mutates = true
		if (/\bdelete\s*$/.test(body.slice(Math.max(0, index - 8), index)))
			mutates = true
	}

	return { keys, body: keys.has('body'), mutates }
}

function analyzeAccess(
	functions: readonly (WSAnyFn | undefined)[],
	root: AnyElysia
): FunctionAccess {
	const keys = new Set<string>()
	let body = false
	let mutates = false
	for (const fn of functions) {
		const access = analyzeFunction(fn)
		if (access.keys === null)
			return { keys: null, body: true, mutates: true }
		body ||= access.body
		mutates ||= access.mutates
		for (const key of access.keys) keys.add(key)
	}
	const decorators = frozenRootOf(root)['~ext']?.decorator as
		| Record<string, unknown>
		| undefined
	for (const key of keys)
		if (typeof decorators?.[key] === 'function')
			return { keys: null, body: true, mutates: true }
	return { keys, body, mutates }
}

function handlerCertifiedSync(fn: WSAnyFn | undefined): boolean {
	if (!fn) return false
	let source: string
	try {
		source = Function.prototype.toString.call(fn)
	} catch {
		return false
	}
	if (
		source.includes('[native code]') ||
		/^\s*async\b/.test(source) ||
		/^\s*(?:async\s+)?function\s*\*/.test(source) ||
		/\b(?:await|yield|Promise)\b|\.then\s*\(/.test(source)
	)
		return false

	const arrow = source.indexOf('=>')
	const bodyStart = source.indexOf('{', arrow === -1 ? 0 : arrow)
	if (bodyStart !== -1) {
		const body = source.slice(bodyStart + 1, source.lastIndexOf('}'))
		if (!/\breturn\b/.test(body)) return true
		return !/\breturn\s+(?!undefined\b|void\b|(?:true|false|null)\b|[-+]?\d)/.test(
			body
		)
	}

	const expression = source.slice(arrow + 2).trim()
	return /^(?:[-+]?\d+(?:\.\d+)?|true|false|null|undefined|[A-Za-z_$][\w$]*\.(?:send|publish|ping|pong|subscribe|unsubscribe|isSubscribed)\s*\()/.test(
		expression
	)
}

export interface WSRoutePlan {
	readonly validators: RouteValidator<any>
	readonly responseValidator:
		| { readonly [status: number]: WSValidatorLike }
		| undefined
	readonly defaultResponseValidator: WSValidatorLike | undefined
	readonly queryPlan: any
	readonly fusedQuery: boolean
	readonly queryArray: any
	readonly queryObject: any
	readonly transforms: readonly WSAnyFn[]
	readonly allBeforeHandles: readonly WSAnyFn[]
	readonly upgradeDeriveModes: ReturnType<
		typeof import('../compile/handler/utils').deriveModes
	>
	readonly messageBeforeHandles: readonly WSAnyFn[]
	readonly afterHandles: readonly WSAnyFn[]
	readonly mapResponses: readonly WSAnyFn[]
	readonly afterResponses: readonly WSAnyFn[]
	readonly errorHandlers: readonly WSAnyFn[]
	readonly parseMessage: (context: Context, message: string | Buffer) => unknown
	readonly messageHandler: WSAnyFn | undefined
	readonly openHandler: WSAnyFn | undefined
	readonly drainHandler: WSAnyFn | undefined
	readonly closeHandler: WSAnyFn | undefined
	readonly pingHandler: WSAnyFn | undefined
	readonly pongHandler: WSAnyFn | undefined
	readonly upgradeHook: unknown
	readonly allowUnsafeValidationDetails: boolean
	readonly serverBinding: RuntimeServerBinding | undefined
	readonly certifiedSyncMessage: boolean
	readonly needsMessageView: boolean
}

type WSRoutePlanInput = Omit<
	WSRoutePlan,
	| 'upgradeDeriveModes'
	| 'parseMessage'
	| 'certifiedSyncMessage'
	| 'needsMessageView'
>

export function createWSRoutePlan(
	plan: WSRoutePlanInput,
	parseHooks: readonly WSAnyFn[],
	deriveEntries: readonly DeriveEntry[],
	root: AnyElysia
): WSRoutePlan {
	const messageLifecycle = [
		...plan.transforms,
		...plan.messageBeforeHandles,
		...plan.afterHandles,
		...plan.mapResponses,
		...plan.afterResponses,
		...plan.errorHandlers,
		plan.messageHandler
	]
	const messageAccess = analyzeAccess(messageLifecycle, root)
	const hasMessageHooks =
		plan.transforms.length !== 0 ||
		plan.messageBeforeHandles.length !== 0 ||
		plan.afterHandles.length !== 0 ||
		plan.mapResponses.length !== 0 ||
		plan.afterResponses.length !== 0 ||
		plan.errorHandlers.length !== 0
	const bodyValidator = plan.validators.body as any

	return Object.freeze({
		...plan,
		upgradeDeriveModes: deriveModes(
			plan.allBeforeHandles as unknown as Function[],
			deriveEntries as DeriveEntry[]
		),
		parseMessage: createMessageParser(parseHooks as any) as any,
		certifiedSyncMessage:
			parseHooks.length === 0 &&
			!hasMessageHooks &&
			(!bodyValidator ||
				(bodyValidator.isAsync === false &&
					bodyValidator.mayReturnPromise !== true)) &&
			handlerCertifiedSync(plan.messageHandler),
		needsMessageView:
			messageAccess.body || messageAccess.mutates || hasMessageHooks
	})
}

export interface WSRouteRuntime {
	readonly plan: WSRoutePlan
	readonly contextPrototype: object
	readonly close: (ws: ElysiaWS<any>, code?: number, reason?: string) => void
}

const contextPrototypeCache = new WeakMap<AnyElysia, object>()

export function createWSContextPrototype(app: AnyElysia): object {
	const cached = contextPrototypeCache.get(app)
	if (cached) return cached
	const contextPrototype = createBaseContext(app).prototype
	const prototype = Object.create(ElysiaWS.prototype)
	const descriptors = Object.getOwnPropertyDescriptors(contextPrototype)
	Reflect.deleteProperty(descriptors, 'constructor')
	Object.defineProperties(prototype, descriptors)
	contextPrototypeCache.set(app, prototype)
	return prototype
}

export function createWSRouteRuntime(
	plan: WSRoutePlan,
	contextPrototype: object
): WSRouteRuntime {
	return Object.freeze({
		plan,
		contextPrototype,
		close: requestClose
	})
}

export interface FrozenWSRouteDescriptor {
	readonly roles: readonly string[]
	readonly message: Readonly<{
		certifiedSync: boolean
		needsView: boolean
	}>
	readonly [key: string]: unknown
}

export type FrozenWSRouteResult = readonly [
	fetch: (
		context: Context
	) => Response | Promise<Response | undefined> | undefined,
	options: Partial<WebSocketHandler<any>>,
	runtime: WSRouteRuntime
]

const EMPTY_HOOKS: readonly WSAnyFn[] = Object.freeze([]) as any

function concatHooks(
	...sources: Array<WSAnyFn | readonly WSAnyFn[] | undefined | null>
): readonly WSAnyFn[] {
	let result: WSAnyFn[] | undefined
	for (const source of sources) {
		if (source == null) continue
		const values = Array.isArray(source) ? source : [source]
		if (values.length)
			result = result ? result.concat(values as WSAnyFn[]) : [...values]
	}
	return result ? Object.freeze(result) : EMPTY_HOOKS
}

export interface BuildWSRoutePlanInput {
	readonly path: string
	readonly hook: AnyWSLocalHook
	readonly flatAppHook?: Partial<AppHook>
	readonly app: AnyElysia
	readonly serverBinding?: RuntimeServerBinding
	readonly contextPrototype?: object
	readonly frozenSlots?: Partial<Record<ValidatorSlot, FrozenValidator>>
}

export function buildWSRoutePlan({
	path,
	hook,
	flatAppHook = {},
	app,
	serverBinding,
	contextPrototype = createWSContextPrototype(app),
	frozenSlots
}: BuildWSRoutePlanInput): FrozenWSRouteResult {
	const root = frozenRootOf(app)
	let validators = frozenSlots || !isTypeboxInitialized()
		? (buildFrozenRouteValidator(
				hook as any,
				app,
				'WS',
				path,
				frozenSlots
			) as RouteValidator<any> | undefined)
		: undefined
	if (!validators)
		validators = new RouteValidator(hook as any, {
			models: root['~ext']?.models,
			app,
			validationPlan: root['~config']?.experimental?.validationPlan,
			aot: { method: 'WS', path },
			frozenSlots
		})

	const responseValidator = validators.response as
		| { [status: number]: WSValidatorLike }
		| undefined
	const defaultResponseValidator = responseValidator
		? (responseValidator[200] ??
			responseValidator[Object.keys(responseValidator)[0] as any])
		: undefined
	const queryPlan = root['~config']?.experimental?.validationPlan
		? validators.queryPlan
		: undefined
	const queryChannels = queryPlan
		? undefined
		: getQueryParseChannels((validators.query as any)?.schema)
	const parseHooks = concatHooks(hook.parse as any)
	const transforms = concatHooks(
		flatAppHook.transform as any,
		hook.transform as any
	)
	const allBeforeHandles = concatHooks(
		flatAppHook.beforeHandle as any,
		hook.beforeHandle as any
	)
	const deriveEntries = [
		...(((flatAppHook as any)['~deriveEntries'] as DeriveEntry[] | undefined) ??
			[]),
		...(((hook as any)['~deriveEntries'] as DeriveEntry[] | undefined) ?? [])
	]
	const deriveSet = deriveEntries.length
		? new Set<Function>(deriveEntries.map(deriveEntryFn))
		: undefined
	const runtime = createWSRouteRuntime(
		createWSRoutePlan(
			{
				validators,
				responseValidator,
				defaultResponseValidator,
				queryPlan,
				fusedQuery:
					!!queryPlan?.fused && !!(validators.query as any)?.hasCodec,
				queryArray: queryChannels?.array,
				queryObject: queryChannels?.object,
				transforms,
				allBeforeHandles,
				messageBeforeHandles: Object.freeze(
					allBeforeHandles.filter((fn) => !deriveSet?.has(fn as Function))
				),
				afterHandles: concatHooks(
					flatAppHook.afterHandle as any,
					hook.afterHandle as any
				),
				mapResponses: concatHooks(
					flatAppHook.mapResponse as any,
					hook.mapResponse as any
				),
				afterResponses: concatHooks(
					flatAppHook.afterResponse as any,
					hook.afterResponse as any
				),
				errorHandlers: concatHooks(
					hook.error as any,
					flatAppHook.error as any
				),
				messageHandler: hook.message as WSAnyFn | undefined,
				openHandler: hook.open as WSAnyFn | undefined,
				drainHandler: hook.drain as WSAnyFn | undefined,
				closeHandler: hook.close as WSAnyFn | undefined,
				pingHandler: hook.ping as WSAnyFn | undefined,
				pongHandler: hook.pong as WSAnyFn | undefined,
				upgradeHook: hook.upgrade,
				allowUnsafeValidationDetails:
					root['~config']?.allowUnsafeValidationDetails === true,
				serverBinding
			},
			parseHooks,
			deriveEntries,
			app
		),
		contextPrototype
	)
	const options: Partial<WebSocketHandler<any>> = nullObject()
	for (const key of WS_OPTIONS)
		if ((hook as any)[key] !== undefined)
			(options as any)[key] = (hook as any)[key]

	return Object.freeze([
		createWSUpgradeHandler(runtime),
		options,
		runtime
	]) as FrozenWSRouteResult
}

export function buildFrozenWSRoute(
	_routeId: number,
	path: string,
	hook: AnyWSLocalHook,
	root: AnyElysia,
	serverBinding: RuntimeServerBinding | undefined,
	descriptor: FrozenWSRouteDescriptor,
	frozenSlots?: Partial<Record<ValidatorSlot, FrozenValidator>>
): FrozenWSRouteResult | undefined {
	if (
		!descriptor ||
		!Array.isArray(descriptor.roles) ||
		!descriptor.message ||
		!hook
	)
		return

	const roles = Object.keys(hook as any).sort()
	if (
		roles.length !== descriptor.roles.length ||
		roles.some((role, index) => role !== descriptor.roles[index])
	)
		return

	const result = buildWSRoutePlan({
		path,
		hook,
		app: root,
		serverBinding,
		frozenSlots
	})
	const plan = result[2].plan
	if (
		plan.certifiedSyncMessage !== descriptor.message.certifiedSync ||
		plan.needsMessageView !== descriptor.message.needsView
	)
		return

	return result
}

function retainContext(context: Context): Record<string, unknown> | undefined {
	const retained = Object.create(null) as Record<string, unknown>
	let count = 0

	const keys = Object.keys(context as any)
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i]
		if (key === 'ws' || key === 'body') continue
		retained[key] = (context as any)[key]
		count++
	}

	return count ? retained : undefined
}

function getElysia(ws: ServerWebSocket<WSConnectionData>): ElysiaWS<any> {
	let view = ws.data.view
	if (!view) {
		const runtime = ws.data.runtime
		if (!runtime) return new ElysiaWS(ws as any)
		view = new ElysiaWS(ws as any, ws.data.retained, runtime.contextPrototype)
		ws.data.view = view
		ws.data.retained = undefined
	}

	return view
}

async function applyMapResponse(
	ws: ElysiaWS<any>,
	value: unknown,
	mapResponses: readonly WSAnyFn[]
): Promise<unknown> {
	for (let i = 0; i < mapResponses.length; i++) {
		;(ws as any).responseValue = value
		const r = mapResponses[i](ws)
		const result = isThenable(r) ? await r : r
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
	return new Promise<void>((resolve) => {
		;(ws.raw.data.resumeWaiters ??= new Set()).add(resolve)
	})
}

export function drainWaiters(ws: ElysiaWS<any>) {
	const data = ws.raw.data
	const waiters = data.resumeWaiters
	if (!waiters || waiters.size === 0) return
	data.resumeWaiters = undefined
	for (const fn of waiters) fn()
}

type GeneratorPump =
	NonNullable<WSConnectionData['generatorPumps']> extends Set<infer Pump>
		? Pump
		: never

function detachGeneratorPump(pump: GeneratorPump, data: WSConnectionData) {
	if (pump.settled) return

	pump.settled = true
	const iterator = pump.iterator
	pump.iterator = undefined
	pump.ws = undefined
	data.generatorPumps?.delete(pump)

	if (data.generatorPumps?.size === 0) data.generatorPumps = undefined

	return iterator
}

async function runGeneratorPump(
	pump: GeneratorPump,
	data: WSConnectionData,
	mapResponses: readonly WSAnyFn[]
) {
	try {
		generatorLoop: while (pump.iterator && pump.ws) {
			const step = pump.iterator.next()
			const result = isThenable(step) ? await step : step
			const ws = pump.ws
			if (!ws || !pump.iterator || result.done) break
			if (result.value === undefined) continue

			const mapped = mapResponses.length
				? await applyMapResponse(ws, result.value, mapResponses)
				: result.value

			let status = (ws as any).send(mapped)
			const canBackpressure = !isEmptyPayload(mapped)

			while (canBackpressure && isBackpressured(status)) {
				if (ws.readyState >= 2) break generatorLoop
				await waitForDrain(ws)

				if (ws.readyState >= 2) break generatorLoop
				if (status === -1) break

				status = (ws as any).send(mapped)
			}
		}
	} catch (error) {
		const iterator = detachGeneratorPump(pump, data)
		if (typeof (iterator as any)?.return === 'function')
			try {
				await (iterator as any).return()
			} catch {}

		pump.reject(error)
		return
	}

	const iterator = detachGeneratorPump(pump, data)
	if (typeof (iterator as any)?.return === 'function')
		try {
			await (iterator as any).return()
		} catch {}
	pump.resolve()
}

function handleGeneratorResponse(
	ws: ElysiaWS<any>,
	iterator: Iterator<unknown> | AsyncIterator<unknown>,
	mapResponses: readonly WSAnyFn[]
) {
	const data = ws.raw.data
	let resolve!: () => void
	let reject!: (error: unknown) => void
	const result = new Promise<void>((done, fail) => {
		resolve = done
		reject = fail
	})
	const pump: GeneratorPump = {
		ws,
		iterator,
		settled: false,
		resolve,
		reject
	}
	;(data.generatorPumps ??= new Set()).add(pump)
	void runGeneratorPump(pump, data, mapResponses)
	return result
}

export async function handleWSResponse(
	ws: ElysiaWS<any>,
	value: unknown,
	mapResponses: readonly WSAnyFn[]
): Promise<void> {
	if (value === undefined) return

	if (isGeneratorObject(value)) {
		return handleGeneratorResponse(
			ws,
			value as Iterator<unknown> | AsyncIterator<unknown>,
			mapResponses
		)
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
								? error.response
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

async function handleError(
	ws: ElysiaWS<any>,
	plan: WSRoutePlan,
	error: unknown
) {
	const errCtx: any = createFrameView(ws)
	errCtx.error = error
	if (plan.allowUnsafeValidationDetails && error instanceof ValidationError)
		error.allowUnsafeValidationDetails = true

	for (let i = 0; i < plan.errorHandlers.length; i++) {
		let r: unknown

		try {
			r = plan.errorHandlers[i](errCtx)
			if (isThenable(r)) r = await r
		} catch {
			break
		}

		if (r !== undefined) {
			try {
				await handleWSResponse(ws, r, plan.mapResponses)
			} catch {}
			return
		}
	}

	sendErrorFrame(ws, error)
}

function validateMessageBody(plan: WSRoutePlan, message: unknown) {
	const validator = plan.validators.body as any
	if (!validator) return message
	if (validator.hasCodec || validator instanceof StandardValidator)
		return validator.From(message, 'body')
	return validator.EncodeFrom(message, 'body')
}

function validationError(
	ws: ElysiaWS<any>,
	plan: WSRoutePlan,
	error: unknown
): void | Promise<void> {
	if (plan.errorHandlers.length) return handleError(ws, plan, error)
	if (plan.allowUnsafeValidationDetails && error instanceof ValidationError)
		error.allowUnsafeValidationDetails = true
	return sendErrorFrame(ws, error)
}

function finishMessageResult(
	ws: ElysiaWS<any>,
	plan: WSRoutePlan,
	value: unknown
): void | Promise<void> {
	if (value === undefined) return
	if (isGeneratorObject(value))
		return handleWSResponse(ws, value, plan.mapResponses).catch((error) =>
			handleError(ws, plan, error)
		)
	try {
		;(ws as any).send(value)
	} catch (error) {
		return handleError(ws, plan, error)
	}
}

function invokeMessageSync(
	ws: ElysiaWS<any>,
	plan: WSRoutePlan,
	message: unknown
): void | Promise<void> {
	try {
		const result = plan.messageHandler!(ws, message)

		if (isThenable(result))
			return Promise.resolve(result).then(
				(resolved) => finishMessageResult(ws, plan, resolved),
				(error) => handleError(ws, plan, error)
			)

		return finishMessageResult(ws, plan, result)
	} catch (error) {
		return handleError(ws, plan, error)
	}
}

async function invokeMessageFull(
	ws: ElysiaWS<any>,
	plan: WSRoutePlan,
	message: unknown
) {
	try {
		ws.body = message as any
		for (let i = 0; i < plan.transforms.length; i++) {
			const r = plan.transforms[i](ws as any)
			if (isThenable(r)) await r
		}
		for (let i = 0; i < plan.messageBeforeHandles.length; i++) {
			let r: unknown = plan.messageBeforeHandles[i](ws as any)
			if (isThenable(r)) r = await r
			if (r !== undefined) {
				await handleWSResponse(ws, r, plan.mapResponses)
				return
			}
		}
		const result = plan.messageHandler!(ws, message)
		const resolved = isThenable(result) ? await result : result
		if (resolved !== undefined)
			await handleWSResponse(ws, resolved, plan.mapResponses)

		for (let i = 0; i < plan.afterHandles.length; i++) {
			const r = plan.afterHandles[i](ws as any)
			if (isThenable(r)) await r
		}
		for (let i = 0; i < plan.afterResponses.length; i++)
			try {
				const r = plan.afterResponses[i](ws as any)
				if (isThenable(r)) await r
			} catch {}
	} catch (error) {
		await handleError(ws, plan, error)
	}
}

function dispatchParsed(
	connection: ElysiaWS<any>,
	plan: WSRoutePlan,
	message: unknown
): void | Promise<void> {
	const validator = plan.validators.body as any
	if (validator)
		try {
			const decoded = validateMessageBody(plan, message)
			if (isThenable(decoded))
				return Promise.resolve(decoded).then(
					(value) => dispatchDecoded(connection, plan, value),
					(error) => validationError(connection, plan, error)
				)
			message = decoded
		} catch (error) {
			return validationError(connection, plan, error)
		}

	return dispatchDecoded(connection, plan, message)
}

function dispatchDecoded(
	connection: ElysiaWS<any>,
	plan: WSRoutePlan,
	message: unknown
) {
	if (plan.certifiedSyncMessage && !plan.needsMessageView)
		return invokeMessageSync(connection, plan, message)

	const ws = createFrameView(connection)
	if (
		plan.transforms.length === 0 &&
		plan.messageBeforeHandles.length === 0 &&
		plan.afterHandles.length === 0 &&
		plan.afterResponses.length === 0 &&
		plan.mapResponses.length === 0
	) {
		ws.body = message as any
		return invokeMessageSync(ws, plan, message)
	}
	return invokeMessageFull(ws, plan, message)
}

function dispatchMessage(
	ws: ServerWebSocket<WSConnectionData>,
	rawMessage: string | Buffer
): void | Promise<void> {
	const runtime = ws.data.runtime
	if (!runtime?.plan.messageHandler) return
	const connection = getElysia(ws)
	try {
		const parsed = runtime.plan.parseMessage(connection as any, rawMessage)
		if (isThenable(parsed))
			return Promise.resolve(parsed).then(
				(value) => dispatchParsed(connection, runtime.plan, value),
				(error) => handleError(connection, runtime.plan, error)
			)
		return dispatchParsed(connection, runtime.plan, parsed)
	} catch (error) {
		return handleError(connection, runtime.plan, error)
	}
}

function invokeLifecycle(
	connection: ElysiaWS<any>,
	plan: WSRoutePlan,
	fn: WSAnyFn | undefined,
	body?: unknown,
	withBody = false
): void | Promise<void> {
	if (!fn) return
	const ws = createFrameView(connection)
	try {
		if (withBody) ws.body = body as any
		const result = withBody ? fn(ws, body) : fn(ws)
		if (isThenable(result))
			return Promise.resolve(result)
				.then((resolved) => handleWSResponse(ws, resolved, plan.mapResponses))
				.catch((error) => handleError(ws, plan, error))
		return handleWSResponse(ws, result, plan.mapResponses).catch((error) =>
			handleError(ws, plan, error)
		)
	} catch (error) {
		return handleError(ws, plan, error)
	}
}

function invokeClose(
	connection: ElysiaWS<any>,
	plan: WSRoutePlan,
	code: number,
	reason: string
): void | Promise<void> {
	if (!plan.closeHandler) return
	const ws = createFrameView(connection)
	;(ws as any).code = code
	;(ws as any).reason = reason
	try {
		const result = plan.closeHandler(ws, code, reason)
		if (isThenable(result))
			return Promise.resolve(result)
				.then((resolved) => handleWSResponse(ws, resolved, plan.mapResponses))
				.catch((error) => handleError(ws, plan, error))
		return handleWSResponse(ws, result, plan.mapResponses).catch((error) =>
			handleError(ws, plan, error)
		)
	} catch (error) {
		return handleError(ws, plan, error)
	}
}

function requestClose(ws: ElysiaWS<any>, code?: number, reason?: string) {
	const data = ws.raw.data
	const runtime = data.runtime
	if (!runtime || data.closeHandlerInvoked) {
		ws.raw.close(code, reason)
		return
	}
	data.closeHandlerInvoked = true
	const result = invokeClose(ws, runtime.plan, code ?? 1000, reason ?? '')
	if (isThenable(result))
		Promise.resolve(result).then(
			() => ws.raw.close(code, reason),
			() => ws.raw.close(code, reason)
		)
	else ws.raw.close(code, reason)
}

function cleanupConnection(data: WSConnectionData) {
	if (data.closed) return
	data.closed = true
	const waiters = data.resumeWaiters
	data.resumeWaiters = undefined
	if (waiters) for (const resolve of waiters) resolve()
	const pumps = data.generatorPumps
	data.generatorPumps = undefined
	if (pumps)
		for (const pump of pumps) {
			if (pump.settled) continue
			pump.settled = true
			const generator = pump.iterator
			pump.iterator = undefined
			pump.ws = undefined
			if (typeof (generator as any)?.return === 'function')
				try {
					const result = (generator as any).return()
					if (isThenable(result)) Promise.resolve(result).catch(() => {})
				} catch {}
			pump.resolve()
		}
	const view = data.view
	if (view)
		for (const key of Object.keys(view as any))
			if (key !== 'raw') delete (view as any)[key]
	data.retained = undefined
	data.view = undefined
	data.runtime = undefined
}

function validateUpgradeChannel(
	validator: any,
	value: unknown,
	type: 'params' | 'query' | 'headers'
): unknown | Promise<unknown> {
	if (validator instanceof StandardValidator || validator.hasCodec)
		return validator.From(value, type)
	return validator.EncodeFrom(value, type)
}

export function createWSUpgradeHandler(runtime: WSRouteRuntime) {
	const plan = runtime.plan
	const handleUpgradeError = createErrorHandler(
		plan.errorHandlers.length ? (plan.errorHandlers as any) : undefined,
		((response: unknown, set: Context['set'], context?: Context) =>
			mapResponse(
				response,
				set,
				(context as { request?: Request } | undefined)?.request
			)) as any,
		plan.allowUnsafeValidationDetails
	)

	return async (context: Context) => {
		const request = context.request
		try {
			if (plan.validators.params) {
				let r = validateUpgradeChannel(
					plan.validators.params,
					context.params ?? nullObject(),
					'params'
				)
				if (isThenable(r)) r = await r
				context.params = r as any
			}
			if (plan.validators.query) {
				const url = request.url
				const query = plan.fusedQuery
					? plan.queryPlan.fromURL(url, (context as any).qi ?? url.indexOf('?'))
					: plan.queryPlan
						? plan.queryPlan.parse(
								url,
								(context as any).qi ?? url.indexOf('?'),
								plan.queryPlan.array,
								plan.queryPlan.object
							)
						: parseQueryFromURL(
								url,
								(context as any).qi ?? url.indexOf('?'),
								plan.queryArray,
								plan.queryObject
							)

				if (plan.fusedQuery) {
					;(context as any).query = plan.queryPlan.validate(
						query,
						plan.validators.query
					)
				} else {
					let r = validateUpgradeChannel(plan.validators.query, query, 'query')
					if (isThenable(r)) r = await r
					;(context as any).query = r
				}
			}
			if (plan.validators.headers) {
				const headers = isBun
					? request.headers.toJSON()
					: Object.fromEntries(request.headers)
				let r = validateUpgradeChannel(
					plan.validators.headers,
					headers,
					'headers'
				)
				if (isThenable(r)) r = await r
				;(context as any).headers = r
			}

			for (let i = 0; i < plan.transforms.length; i++) {
				const r = plan.transforms[i](context as any)
				if (isThenable(r)) await r
			}
			for (let i = 0; i < plan.allBeforeHandles.length; i++) {
				let r: unknown = plan.allBeforeHandles[i](context as any)
				if (isThenable(r)) r = await r
				const deriveMode = plan.upgradeDeriveModes?.[i]
				if (deriveMode !== undefined && !(r instanceof ElysiaStatus)) {
					if (r && typeof r === 'object') {
						if (deriveMode) context = replaceDeriveContext(context, r)
						else Object.assign(context as any, r)
					}
				} else if (r !== undefined) {
					if (r instanceof Response) return r
					return mapResponse(r, (context as any).set, (context as any).request)
				}
			}

			let upgradeHeaders: Record<string, string> | undefined
			if (plan.upgradeHook != null) {
				const r =
					typeof plan.upgradeHook === 'function'
						? (plan.upgradeHook as WSAnyFn)(context as any)
						: plan.upgradeHook
				const resolved = isThenable(r) ? await r : r
				if (resolved && typeof resolved === 'object')
					upgradeHeaders = resolved as Record<string, string>
			}

			const server =
				((context as any).server as Server | null | undefined) ??
				plan.serverBinding?.current ??
				null
			if (!server)
				return problemResponse({
					status: 500,
					type: 'internal-server-error',
					title: 'Internal Server Error',
					detail:
						'WebSocket upgrade requires a running server. Call .listen() first.'
				})

			const upgraded = server.upgrade(request, {
				headers: upgradeHeaders,
				data: {
					runtime,
					retained: retainContext(context)
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

export function buildGlobalWSHandler(): WebSocketHandler<WSConnectionData> {
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
			try {
				const data = ws.data
				const runtime = data.runtime
				if (!runtime) return
				const result = dispatchMessage(ws, message)
				if (isThenable(result))
					Promise.resolve(result).catch((error) => sendErrMsg(ws, error))
			} catch (error) {
				const data = ws.data
				const runtime = data.runtime
				if (!runtime) return sendErrMsg(ws, error)
				handleError(data.view ?? getElysia(ws), runtime.plan, error).catch(
					(nestedError) => sendErrMsg(ws, nestedError)
				)
			}
		},
		open(ws) {
			const runtime = ws.data.runtime
			if (runtime?.plan.openHandler)
				invokeLifecycle(getElysia(ws), runtime.plan, runtime.plan.openHandler)
		},
		drain(ws) {
			const runtime = ws.data.runtime
			if (!runtime) return
			const view = ws.data.view
			if (view) drainWaiters(view)
			if (runtime.plan.drainHandler)
				invokeLifecycle(
					view ?? getElysia(ws),
					runtime.plan,
					runtime.plan.drainHandler
				)
		},
		close(ws, code, reason) {
			const runtime = ws.data.runtime
			if (!runtime) return cleanupConnection(ws.data)

			const view = ws.data.view
			if (view) drainWaiters(view)
			if (ws.data.closeHandlerInvoked) return cleanupConnection(ws.data)

			ws.data.closeHandlerInvoked = true
			if (!runtime.plan.closeHandler) return cleanupConnection(ws.data)

			const result = invokeClose(
				view ?? getElysia(ws),
				runtime.plan,
				code,
				reason
			)

			if (isThenable(result))
				Promise.resolve(result).finally(() => cleanupConnection(ws.data))
			else cleanupConnection(ws.data)
		},
		ping(ws, data) {
			const runtime = ws.data.runtime
			if (runtime?.plan.pingHandler)
				invokeLifecycle(
					getElysia(ws),
					runtime.plan,
					runtime.plan.pingHandler,
					data,
					true
				)
		},
		pong(ws, data) {
			const runtime = ws.data.runtime
			if (runtime?.plan.pongHandler)
				invokeLifecycle(
					getElysia(ws),
					runtime.plan,
					runtime.plan.pongHandler,
					data,
					true
				)
		}
	}
}

export function buildWebSocketRuntime(
	config?: Partial<WebSocketHandler<WSConnectionData>>
): WebSocketHandler<WSConnectionData> {
	const handler = buildGlobalWSHandler()
	return config ? Object.assign(handler, config) : handler
}
