import { RouteValidator } from '../validator/route'
import { isTypeboxInitialized } from '../type/bridge'
import { buildFrozenRouteValidator } from '../compile/handler/frozen-validator'
import { deriveEntryFn, nullObject, type DeriveEntry } from '../utils'
import { frozenRootOf, type RuntimeServerBinding } from '../generation'
import { getQueryParseChannels } from '../parse-query'
import { Capture } from '../compile/aot'
import {
	composeRouteHook,
	localMacroRoot,
	resolveWSLocalHook
} from '../compile/handler'

import {
	createWSContextPrototype,
	createWSRoutePlan,
	createWSRouteRuntime,
	createWSUpgradeHandler,
	type FrozenWSRouteResult,
	type WSAnyFn
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
	...sources: Array<WSAnyFn | WSAnyFn[] | readonly WSAnyFn[] | undefined | null>
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
	const fusedQuery = !!queryPlan?.fused && !!(validators.query as any)?.hasCodec
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
	const errorHandlers = concatHooks(hook.error as any, flatAppHook.error as any)
	const messageHandler = hook.message as WSAnyFn | undefined

	const plan = createWSRoutePlan(
		{
			validators,
			responseValidator,
			defaultResponseValidator,
			queryPlan,
			fusedQuery,
			queryArray: queryChannels?.array,
			queryObject: queryChannels?.object,
			transforms,
			allBeforeHandles,
			messageBeforeHandles,
			afterHandles,
			mapResponses,
			afterResponses,
			errorHandlers,
			messageHandler,
			openHandler: hook.open as WSAnyFn | undefined,
			drainHandler: hook.drain as WSAnyFn | undefined,
			closeHandler: hook.close as WSAnyFn | undefined,
			pingHandler: hook.ping as WSAnyFn | undefined,
			pongHandler: hook.pong as WSAnyFn | undefined,
			upgradeHook: hook.upgrade,
			allowUnsafeValidationDetails,
			compatCancellation,
			serverBinding
		},
		parseHooks,
		deriveEntries,
		app
	)
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
				reason:
					'WebSocket route has resolved macro, inherited, or ambient lifecycle state.'
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
