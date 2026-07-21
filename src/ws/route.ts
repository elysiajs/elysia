import { RouteValidator } from '../validator/route'
import { isTypeboxInitialized } from '../type/bridge'
import { buildFrozenRouteValidator } from '../compile/handler/frozen-validator'
import { deriveEntryFn, nullObject, type DeriveEntry } from '../utils'
import { frozenRootOf, type RuntimeServerBinding } from '../generation'
import { getQueryParseChannels } from '../parse-query'
import { deriveModes } from '../compile/handler/utils'
import { Capture } from '../compile/aot'
import {
	composeRouteHook,
	localMacroRoot,
	resolveWSLocalHook
} from '../compile/handler'

import { createMessageParser } from './parser'
import {
	createWSContextPrototype,
	createWSRouteRuntime,
	createWSUpgradeHandler,
	type FrozenWSRouteResult,
	type WSAnyFn,
	type WSContextAccess,
	type WSRoutePlan
} from './runtime'

import type { AnyElysia } from '../base'
import type { AnyWSLocalHook, WSValidatorLike, WebSocketHandler } from './types'
import type { InternalRoute, AppHook } from '../types'

export {
	buildGlobalWSHandler,
	buildWebSocketRuntime,
	createWSContextPrototype,
	drainWaiters,
	handleWSResponse
} from './runtime'

const EMPTY_HOOKS: readonly WSAnyFn[] = Object.freeze([]) as any

function concatHooks(
	...sources: Array<
		WSAnyFn | WSAnyFn[] | readonly WSAnyFn[] | undefined | null
	>
): readonly WSAnyFn[] {
	let result: WSAnyFn[] | undefined
	for (let i = 0; i < sources.length; i++) {
		const source = sources[i]
		if (source == null) continue
		const values: readonly WSAnyFn[] = Array.isArray(source)
			? (source as readonly WSAnyFn[])
			: [source as WSAnyFn]
		if (values.length === 0) continue
		result = result ? result.concat(values as WSAnyFn[]) : [...values]
	}
	return result ? Object.freeze(result) : EMPTY_HOOKS
}

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
		if (!arrow) return undefined
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
	if (close === -1) return undefined
	const parameters = source.slice(open + 1, close)
	const comma = parameters.indexOf(',')
	const parameter = (
		comma === -1 ? parameters : parameters.slice(0, comma)
	).trim()
	if (!parameter) return { bodyStart: close + 1 }
	if (!/^[A-Za-z_$][\w$]*$/.test(parameter)) return undefined
	return {
		name: parameter,
		bodyStart: close + 1,
		parameterTail: comma === -1 ? undefined : parameters.slice(comma + 1)
	}
}

/** Conservative: any source ambiguity retains the complete upgrade context. */
function analyzeFunction(fn: WSAnyFn | undefined): FunctionAccess {
	if (!fn) return { keys: new Set(), body: false, mutates: false }
	let source: string
	try {
		source = Function.prototype.toString.call(fn)
	} catch {
		return { keys: null, body: true, mutates: true }
	}
	if (
		source.includes('[native code]') ||
		/\barguments\b|\beval\s*\(/.test(source)
	)
		return { keys: null, body: true, mutates: true }

	const parameter = firstParam(source)
	if (!parameter) return { keys: null, body: true, mutates: true }
	if (!parameter.name) return { keys: new Set(), body: false, mutates: false }

	const body = source.slice(parameter.bodyStart)
	const name = parameter.name.replace(/[$]/g, '\\$&')
	const occurrence = new RegExp(`(^|[^\\w$])${name}(?![\\w$])`, 'g')
	if (parameter.parameterTail && occurrence.test(parameter.parameterTail))
		return { keys: null, body: true, mutates: true }
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
		if (!property) return { keys: null, body: true, mutates: true }
		keys.add(property)

		const consumed = (member?.[0] ?? computed![0]).length
		const after = tail.slice(consumed)
		if (/^\s*(?:\+\+|--|=(?!=)|\+=|-=|\*=|\/=|&&=|\|\|=|\?\?=)/.test(after))
			mutates = true
		const prefix = body.slice(Math.max(0, index - 8), index)
		if (/\bdelete\s*$/.test(prefix)) mutates = true
	}

	return { keys, body: keys.has('body'), mutates }
}

function mergeAccess(
	functions: readonly (WSAnyFn | undefined)[],
	app: AnyElysia
): WSContextAccess {
	const keys = new Set<string>()
	let body = false
	let mutates = false
	for (let i = 0; i < functions.length; i++) {
		const access = analyzeFunction(functions[i])
		body ||= access.body
		mutates ||= access.mutates
		if (access.keys === null)
			return Object.freeze({ keys: null, body: true, mutates: true })
		for (const key of access.keys) keys.add(key)
	}

	const decorators = frozenRootOf(app)['~ext']?.decorator as
		| Record<string, unknown>
		| undefined
	for (const key of keys)
		if (typeof decorators?.[key] === 'function')
			return Object.freeze({ keys: null, body: true, mutates: true })

	return Object.freeze({
		keys: Object.freeze([...keys]),
		body,
		mutates
	})
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

function handlerReturnsVoid(fn: WSAnyFn | undefined): boolean {
	if (!fn) return false
	try {
		const source = Function.prototype.toString.call(fn)
		const arrow = source.indexOf('=>')
		const bodyStart = source.indexOf('{', arrow === -1 ? 0 : arrow)
		return (
			bodyStart !== -1 &&
			!/\breturn\b/.test(
				source.slice(bodyStart + 1, source.lastIndexOf('}'))
			)
		)
	} catch {
		return false
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

interface PlanInput {
	path: string
	hook: AnyWSLocalHook
	flatAppHook: Partial<AppHook>
	app: AnyElysia
	serverBinding?: RuntimeServerBinding
	contextPrototype: object
}

function buildPlan({
	path,
	hook,
	flatAppHook,
	app,
	serverBinding,
	contextPrototype
}: PlanInput): FrozenWSRouteResult {
	const frozenRoot = frozenRootOf(app)
	const allowUnsafeValidationDetails =
		frozenRoot['~config']?.allowUnsafeValidationDetails === true
	const compatCancellation =
		frozenRoot['~config']?.experimental?.cancellation === 'compat'
	let validators = !isTypeboxInitialized()
		? (buildFrozenRouteValidator(hook as any, app, 'WS', path) as
				| RouteValidator<any>
				| undefined)
		: undefined
	if (!validators)
		validators = new RouteValidator(hook as any, {
			models: frozenRoot['~ext']?.models,
			app,
			validationPlan: frozenRoot['~config']?.experimental?.validationPlan,
			aot: { method: 'WS', path }
		})

	const responseValidator = validators.response as
		| { [status: number]: WSValidatorLike }
		| undefined
	const defaultResponseValidator = responseValidator
		? (responseValidator[200] ??
			responseValidator[Object.keys(responseValidator)[0] as any])
		: undefined
	const queryPlan = frozenRoot['~config']?.experimental?.validationPlan
		? validators.queryPlan
		: undefined
	const fusedQuery =
		!!queryPlan?.fused && !!(validators.query as any)?.hasCodec
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
		...(((flatAppHook as any)['~deriveEntries'] as
			| DeriveEntry[]
			| undefined) ?? []),
		...(((hook as any)['~deriveEntries'] as DeriveEntry[] | undefined) ??
			[])
	]
	const deriveSet = deriveEntries.length
		? new Set<Function>(deriveEntries.map(deriveEntryFn))
		: undefined
	const messageBeforeHandles = Object.freeze(
		allBeforeHandles.filter((fn) => !deriveSet?.has(fn as Function))
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
	const messageHandler = hook.message as WSAnyFn | undefined
	const lifecycle = [
		...transforms,
		...messageBeforeHandles,
		...afterHandles,
		...mapResponses,
		...afterResponses,
		...errorHandlers,
		messageHandler,
		hook.open as WSAnyFn | undefined,
		hook.drain as WSAnyFn | undefined,
		hook.close as WSAnyFn | undefined,
		hook.ping as WSAnyFn | undefined,
		hook.pong as WSAnyFn | undefined
	]
	const access = mergeAccess(lifecycle, app)
	const messageAccess = mergeAccess(
		[
			...transforms,
			...messageBeforeHandles,
			...afterHandles,
			...mapResponses,
			...afterResponses,
			...errorHandlers,
			messageHandler
		],
		app
	)
	const bodyValidator = validators.body as any
	const certifiedSyncMessage =
		parseHooks.length === 0 &&
		transforms.length === 0 &&
		messageBeforeHandles.length === 0 &&
		afterHandles.length === 0 &&
		mapResponses.length === 0 &&
		afterResponses.length === 0 &&
		errorHandlers.length === 0 &&
		(!bodyValidator ||
			(bodyValidator.isAsync === false &&
				bodyValidator.mayReturnPromise !== true)) &&
		handlerCertifiedSync(messageHandler)
	const voidMessageHandler = handlerReturnsVoid(messageHandler)
	const needsMessageView =
		messageAccess.body ||
		messageAccess.mutates ||
		transforms.length !== 0 ||
		messageBeforeHandles.length !== 0 ||
		afterHandles.length !== 0 ||
		mapResponses.length !== 0 ||
		afterResponses.length !== 0 ||
		errorHandlers.length !== 0

	const plan: WSRoutePlan = Object.freeze({
		validators,
		responseValidator,
		defaultResponseValidator,
		queryPlan,
		fusedQuery,
		queryArray: queryChannels?.array,
		queryObject: queryChannels?.object,
		transforms,
		allBeforeHandles,
		upgradeDeriveModes: deriveModes(
			allBeforeHandles as unknown as Function[],
			deriveEntries
		),
		messageBeforeHandles,
		afterHandles,
		mapResponses,
		afterResponses,
		errorHandlers,
		parseMessage: createMessageParser(parseHooks as any) as any,
		messageHandler,
		openHandler: hook.open as WSAnyFn | undefined,
		drainHandler: hook.drain as WSAnyFn | undefined,
		closeHandler: hook.close as WSAnyFn | undefined,
		pingHandler: hook.ping as WSAnyFn | undefined,
		pongHandler: hook.pong as WSAnyFn | undefined,
		upgradeHook: hook.upgrade,
		allowUnsafeValidationDetails,
		compatCancellation,
		serverBinding,
		access,
		certifiedSyncMessage,
		voidMessageHandler,
		needsMessageView
	})
	const runtime = createWSRouteRuntime(plan, contextPrototype)
	const options: Partial<WebSocketHandler<any>> = nullObject()
	for (const key of wsOptions)
		if ((hook as any)[key] !== undefined)
			(options as any)[key] = (hook as any)[key]
	return Object.freeze([
		createWSUpgradeHandler(runtime),
		options,
		runtime
	]) as FrozenWSRouteResult
}

export function buildWSRoute(
	route: InternalRoute,
	app: AnyElysia,
	serverBinding?: RuntimeServerBinding,
	contextPrototype = createWSContextPrototype(app)
): FrozenWSRouteResult {
	const localHook = route[4] as AnyWSLocalHook | undefined
	const hook = (resolveWSLocalHook(
		localMacroRoot(
			(route[7] as AnyElysia) ?? (route[3] as AnyElysia) ?? app,
			app
		),
		localHook,
		app
	) ?? nullObject()) as AnyWSLocalHook
	const flatAppHook =
		(composeRouteHook(
			(route[3] as AnyElysia | undefined) ?? app,
			undefined,
			route[5] as Parameters<typeof composeRouteHook>[2],
			route[6] as Parameters<typeof composeRouteHook>[3],
			app,
			route[7] as AnyElysia | undefined
		) as Partial<AppHook> | undefined) ?? {}
	const result = buildPlan({
		path: route[1] as string,
		hook,
		flatAppHook,
		app,
		serverBinding,
		contextPrototype
	})

	if (Capture.isCapturing()) {
		const ambient = [
			flatAppHook.transform,
			flatAppHook.beforeHandle,
			flatAppHook.afterHandle,
			flatAppHook.mapResponse,
			flatAppHook.afterResponse,
			flatAppHook.error
		].some((value) =>
			Array.isArray(value) ? value.length !== 0 : value != null
		)
		const path = route[1] as string
		if (hook !== localHook || ambient)
			Capture.ws({
				path,
				reason: 'WebSocket route has resolved macro, inherited, or ambient lifecycle state.'
			})
		else {
			const roles = Object.keys(hook as any).sort()
			const plan = result[2].plan
			const descriptor = {
				flags: 1,
				contextKeys: plan.access.keys,
				roles,
				message: {
					certifiedSync: plan.certifiedSyncMessage,
					returnsVoid: plan.voidMessageHandler,
					needsView: plan.needsMessageView
				}
			}
			Capture.ws({
				path,
				roles,
				source: `(i,p,h,r,s)=>buildFrozenWSRoute(i,p,h,r,s,${JSON.stringify(descriptor)})`
			})
		}
	}

	return result
}
