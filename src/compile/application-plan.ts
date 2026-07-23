import type Memoirist from 'memoirist'

import type { AnyElysia } from '../base'
import type { CompiledHandler, AppHook, WrapFn } from '../types'
import type { RuntimeBindings } from '../generation'
import {
	contextDefaults,
	defaultHeaders as defaultHeaderMarker
} from '../adapter/default-headers'
import { getDefaultAdapter } from '../adapter/constants'
import { createContextFromBindings } from '../context'
import { flattenChain } from '../utils'
import {
	createFetchKernel,
	createFetchRuntimeImageFromBindings,
	type FetchKernel
} from '../handler/fetch'
import {
	balancedAdapterPlan
} from './handler/balanced-program'
import type {
	AppPlan,
	ApplicationPolicyInput,
	ExternalBindingInput
} from './app-plan'

type RouteMap = AnyElysia['~map']
type RouteRouter = Memoirist<CompiledHandler> | undefined

const values = <T>(value: T | readonly T[] | undefined): readonly T[] =>
	value == null ? [] : Array.isArray(value) ? value : [value as T]

const entries = (value: Record<string, string> | null) =>
	value ? Object.entries(value).sort(([a], [b]) => a.localeCompare(b)) : []

export interface ApplicationPlanResult {
	readonly application: ApplicationPolicyInput
	readonly adapter: ReturnType<typeof balancedAdapterPlan>['adapter']
}

export function planApplicationRuntime(
	app: AnyElysia,
	bindings: RuntimeBindings,
	features: { readonly hasWS: boolean; readonly hasDynamicWS: boolean }
): ApplicationPlanResult {
	const hook = flattenChain(app['~hookChain'])
	const adapter = app['~config']?.adapter ?? getDefaultAdapter()
	const adapterPlan = balancedAdapterPlan(adapter)
	const request = values(hook?.request)
	const mapResponse = values(hook?.mapResponse)
	const error = values(hook?.error)
	const afterResponse = values(hook?.afterResponse)
	const trace = values(hook?.trace)
	const hoc = values(app['~ext']?.hoc)
	const defaults = contextDefaults(app)
	const applicationBindings: ExternalBindingInput[] = [
		{ role: 'routeErrorFinalizer', value: bindings.finalizeError }
	]
	for (const value of request)
		applicationBindings.push({ role: 'request', value })
	for (const value of mapResponse)
		applicationBindings.push({ role: 'mapResponse', value })
	for (const value of error)
		applicationBindings.push({ role: 'error', value })
	for (const value of afterResponse)
		applicationBindings.push({ role: 'afterResponse', value })
	for (const value of trace)
		applicationBindings.push({ role: 'tracer', value })
	for (const value of hoc)
		applicationBindings.push({ role: 'hoc', value })
	if (app['~ext']?.decorator !== undefined)
		applicationBindings.push({ role: 'decorator', value: app['~ext']?.decorator })
	if (app['~ext']?.store !== undefined)
		applicationBindings.push({ role: 'store', value: app['~ext']?.store })
	applicationBindings.push({ role: 'server', value: bindings.server })
	applicationBindings.push(...adapterPlan.bindings)

	return Object.freeze({
		application: {
			fetch: {
				strictPath: app['~config']?.strictPath === true,
				pathStart:
					app['~config']?.handler?.standardHostname === false ? 7 : 11,
				hasWS: features.hasWS,
				hasDynamicWS: features.hasDynamicWS,
				hasDefaultHeaders: !!app['~ext']?.headers,
				defaultHeaders: entries(defaults.headers),
				allowUnsafeValidationDetails:
					app['~config']?.allowUnsafeValidationDetails === true
			},
			lifecycle: {
				request: request.length,
				mapResponse: mapResponse.length,
				error: error.length,
				afterResponse: afterResponse.length,
				trace: trace.length,
				hoc: hoc.length
			},
			bindings: Object.freeze(applicationBindings)
		},
		adapter: adapterPlan.adapter
	})
}

const integer = (value: unknown) =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function lowerApplicationRuntime(
	plan: AppPlan,
	routing: {
		readonly map: RouteMap
		readonly router: RouteRouter
	}
): FetchKernel {
	const fetch = plan.application.fetch as any
	const lifecycle = plan.application.lifecycle as any
	if (
		!fetch ||
		!lifecycle ||
		typeof fetch.strictPath !== 'boolean' ||
		(fetch.pathStart !== 7 && fetch.pathStart !== 11) ||
		typeof fetch.hasWS !== 'boolean' ||
		typeof fetch.hasDynamicWS !== 'boolean' ||
		typeof fetch.hasDefaultHeaders !== 'boolean' ||
		!Array.isArray(fetch.defaultHeaders) ||
		typeof fetch.allowUnsafeValidationDetails !== 'boolean'
	)
		throw new Error('[APP_PLAN_APPLICATION] invalid fetch policy')

	const byRole = (role: string) =>
		plan.application.bindingIndices
			.filter((index) => plan.bindingLayout[index]?.role === role)
			.map((index) => plan.externalBindings[index])
	const counted = (
		role: string,
		policy: string,
		callable = true
	): readonly any[] => {
		const result = byRole(role)
		if (!integer(lifecycle[policy]) || result.length !== lifecycle[policy])
			throw new Error(`[APP_PLAN_APPLICATION] invalid ${role} count`)
		if (callable && result.some((value) => typeof value !== 'function'))
			throw new Error(`[APP_PLAN_APPLICATION] ${role} must be callable`)
		return result
	}
	const request = counted('request', 'request') as AppHook['request']
	const mapResponse = counted('mapResponse', 'mapResponse') as AppHook['mapResponse']
	const error = counted('error', 'error') as AppHook['error']
	const afterResponse = counted('afterResponse', 'afterResponse') as AppHook['afterResponse']
	const trace = counted('tracer', 'trace') as AppHook['trace']
	const hoc = counted('hoc', 'hoc') as readonly WrapFn<any>[]
	const singleton = (role: string) => {
		const values = byRole(role)
		if (values.length > 1)
			throw new Error(`[APP_PLAN_APPLICATION] multiple ${role} bindings`)
		return values[0]
	}
	const adapterMap = singleton('adapterMap')
	if (typeof adapterMap !== 'function')
		throw new Error('[APP_PLAN_APPLICATION] adapterMap must be callable')
	const defaultHeaders: Record<string, string> = Object.create(null)
	for (const pair of fetch.defaultHeaders) {
		if (
			!Array.isArray(pair) ||
			pair.length !== 2 ||
			typeof pair[0] !== 'string' ||
			typeof pair[1] !== 'string'
		)
			throw new Error('[APP_PLAN_APPLICATION] invalid default headers')
		defaultHeaders[pair[0]] = pair[1]
	}
	const headers = fetch.defaultHeaders.length ? defaultHeaders : null
	if (headers && plan.adapter.capabilities.defaultHeaders) {
		Object.defineProperty(headers, defaultHeaderMarker, { value: headers })
		Object.freeze(headers)
	}
	const Context = createContextFromBindings({
		decorator: singleton('decorator'),
		store: singleton('store'),
		headers,
		warnPathMutation: request.length > 0
	})
	const runtime = createFetchRuntimeImageFromBindings({
		Context,
		map: routing.map,
		router: routing.router,
		strictPath: fetch.strictPath,
		pathStart: fetch.pathStart,
		hasWS: fetch.hasWS,
		hasDynamicWS: fetch.hasDynamicWS,
		hasDefaultHeaders: fetch.hasDefaultHeaders,
		requestHooks: request,
		mapResponseHooks: mapResponse,
		errorHooks: error,
		afterResponseHooks: afterResponse,
		traceHooks: trace,
		hoc,
		allowUnsafeValidationDetails: fetch.allowUnsafeValidationDetails,
		baseMapResponse: adapterMap as any
	})
	return createFetchKernel(runtime)
}
