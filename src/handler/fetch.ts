import Memoirist, {
	type Node as MemoiristNode,
	type ParamNode as MemoiristParamNode
} from 'memoirist'

import { getDefaultAdapter } from '../adapter/constants'

import type { AnyElysia } from '../base'
import {
	NOT_FOUND_BODY,
	getNotFound,
	frameworkNotFound,
	settleResponse,
	assimilateThenable
} from './utils'

import { createContext, type Context } from '../context'
import { createErrorHandler } from './error'
import {
	requestId,
	flattenChain,
	nullObject,
	isNotEmpty,
	decodeURIComponentSafe
} from '../utils'
import { handleSet, materializeSetHeaders } from '../adapter/utils'
import {
	NotFound,
	PROBLEM_JSON,
	internalServerErrorResponse,
	isProduction
} from '../error'
import { createTraceHandles, unionTracePhases } from '../trace'

import type {
	AppHook,
	CompiledHandler,
	MaybePromise,
	WrapFn
} from '../types'
import type { RouteErrorFinalizer } from './utils'

export type FetchContextConstructor = new (request: Request) => Context

export type FetchRouteMap = Readonly<{
	[method: string]:
		| Readonly<{ [path: string]: CompiledHandler }>
		| undefined
}>

export interface FetchRuntimeImage {
	readonly Context: FetchContextConstructor
	readonly map: FetchRouteMap
	readonly router?: Memoirist<CompiledHandler>
	readonly strictPath: boolean
	readonly pathStart: number
	readonly hasWS: boolean
	readonly hasDynamicWS: boolean
	readonly hasRoutes: boolean
	readonly hasDefaultHeaders: boolean
	readonly requestHooks?: AppHook['request']
	readonly mapResponseHooks?: AppHook['mapResponse']
	readonly errorHooks?: AppHook['error']
	readonly afterResponseHooks?: AppHook['afterResponse']
	readonly traceHooks?: AppHook['trace']
	readonly hoc?: readonly WrapFn<any>[]
	readonly allowUnsafeValidationDetails: boolean
	readonly baseMapResponse: (
		response: unknown,
		set: Context['set'],
		request?: Request,
		owned?: boolean
	) => unknown
	/** Legacy authoring adapter only; AppPlan publication owns its cell separately. */
	readonly errorFinalizer?: FetchErrorFinalizerCell
}

export interface FetchErrorFinalizerCell {
	current?: RouteErrorFinalizer
}

export interface FetchRuntimeImageInput extends Omit<
	FetchRuntimeImage,
	'map' | 'router' | 'hasRoutes' | 'requestHooks' | 'mapResponseHooks' |
	'errorHooks' | 'afterResponseHooks' | 'traceHooks' | 'hoc'
> {
	readonly map: AnyElysia['~map']
	readonly router: AnyElysia['~router']
	readonly requestHooks?: AppHook['request']
	readonly mapResponseHooks?: AppHook['mapResponse']
	readonly errorHooks?: AppHook['error']
	readonly afterResponseHooks?: AppHook['afterResponse']
	readonly traceHooks?: AppHook['trace']
	readonly hoc?: readonly WrapFn<any>[]
}

export interface FetchKernel {
	readonly fetch: FetchHandler
	readonly finalizeError: RouteErrorFinalizer
}

type FetchHandler = (
	request: Request,
	...rest: any[]
) => MaybePromise<Response>

const snapshotHooks = <T extends readonly unknown[]>(hooks: T | undefined) =>
	hooks?.length ? (Object.freeze([...hooks]) as unknown as T) : undefined

function snapshotRouteMap(map: AnyElysia['~map']): FetchRouteMap {
	const snapshot: Record<
		string,
		Readonly<Record<string, CompiledHandler>> | undefined
	> = nullObject()

	if (map)
		for (const method in map) {
			const routes = map[method]
			if (routes)
				snapshot[method] = Object.freeze(
					Object.assign(nullObject(), routes)
				)
		}

	return Object.freeze(snapshot)
}

function snapshotRouter(
	router: AnyElysia['~router']
): Memoirist<CompiledHandler> | undefined {
	if (!router) return

	const cloneParam = (
		node: MemoiristParamNode<CompiledHandler>
	): MemoiristParamNode<CompiledHandler> =>
		Object.freeze({
			store: node.store,
			storeNames: node.storeNames
				? Object.freeze([...node.storeNames]) as string[]
				: null,
			inert: node.inert ? cloneNode(node.inert) : null
		})
	const cloneNode = (
		node: MemoiristNode<CompiledHandler>
	): MemoiristNode<CompiledHandler> => {
		let inert: Record<number, MemoiristNode<CompiledHandler>> | null = null
		if (node.inert) {
			const nextInert = nullObject() as Record<
				number,
				MemoiristNode<CompiledHandler>
			>
			for (const key in node.inert)
				nextInert[+key] = cloneNode(node.inert[key])
			inert = Object.freeze(nextInert)
		}

		return Object.freeze({
			part: node.part,
			store: node.store,
			storeNames: node.storeNames
				? Object.freeze([...node.storeNames]) as string[]
				: null,
			inert,
			params: node.params ? cloneParam(node.params) : null,
			wildcardStore: node.wildcardStore,
			wildcardStoreNames: node.wildcardStoreNames
				? Object.freeze([...node.wildcardStoreNames]) as string[]
				: null
		})
	}

	const snapshot = new Memoirist<CompiledHandler>({
		loosePath: router.loosePath,
		onParam: router.onParam
	})
	const root = nullObject() as typeof snapshot.root
	for (const method in router.root) root[method] = cloneNode(router.root[method])
	snapshot.root = Object.freeze(root)

	return Object.freeze(snapshot)
}

function hasMappedRoute(map: FetchRouteMap) {
	for (const method in map) {
		const routes = map[method]
		if (routes)
			for (const _path in routes) return true
	}

	return false
}

export function createFetchRuntimeImage(app: AnyElysia): FetchRuntimeImage {
	const hook = flattenChain(app['~hookChain'])
	return createFetchRuntimeImageFromBindings({
		Context: createContext(app),
		map: app['~map'],
		router: app['~router'],
		strictPath: !!app['~config']?.strictPath,
		pathStart:
			app['~config']?.handler?.standardHostname === false ? 7 : 11,
		hasWS: !!app['~hasWS'],
		hasDynamicWS: !!app['~hasWS'] && !!app['~hasDynamicWS'],
		hasDefaultHeaders: !!app['~ext']?.headers,
		requestHooks: hook?.request,
		mapResponseHooks: hook?.mapResponse,
		errorHooks: hook?.error,
		afterResponseHooks: hook?.afterResponse,
		traceHooks: hook?.trace,
		hoc: app['~ext']?.hoc,
		allowUnsafeValidationDetails:
			!!app['~config']?.allowUnsafeValidationDetails,
		baseMapResponse: (app['~config']?.adapter ?? getDefaultAdapter()).response
			.map as FetchRuntimeImage['baseMapResponse'],
		errorFinalizer: app['~runtimeBindings'].error
	})
}

export function createFetchRuntimeImageFromBindings(
	input: FetchRuntimeImageInput
): FetchRuntimeImage {
	const map = snapshotRouteMap(input.map)
	const router = snapshotRouter(input.router)
	return Object.freeze({
		...input,
		map,
		router,
		hasRoutes: hasMappedRoute(map) || !!router,
		requestHooks: snapshotHooks(input.requestHooks),
		mapResponseHooks: snapshotHooks(input.mapResponseHooks),
		errorHooks: snapshotHooks(input.errorHooks),
		afterResponseHooks: snapshotHooks(input.afterResponseHooks),
		traceHooks: snapshotHooks(input.traceHooks),
		hoc: snapshotHooks(input.hoc)
	})
}

// Extract path and query-index from a full URL string.
// Scalar params only — monomorphic so V8/JSC can inline at each call site.
function extractPath(url: string, context: any, pathStart: number): string {
	const s = url.indexOf('/', pathStart)
	return (context.path = url.substring(
		s,
		(context.qi = url.indexOf('?', s)) === -1 ? url.length : context.qi
	))
}

// Default 404 that still emits `Elysia.headers` defaults / hook-set headers + cookies.
function notFound(context: Context): Response {
	const set = context.set

	if (set.cookie || isNotEmpty(set.headers)) {
		handleSet(set)

		if (!(set.headers as any)['content-type'])
			(materializeSetHeaders(set) as any)['content-type'] = PROBLEM_JSON

		return new Response(NOT_FOUND_BODY, {
			status: 404,
			headers: set.headers as any
		})
	}

	return getNotFound()
}

function decodeParams(params: Record<string, string>) {
	for (const key in params) {
		const value = params[key]
		if (value.indexOf('%') !== -1)
			params[key] = decodeURIComponentSafe(value) ?? value
	}

	return params
}

function finalizeError(
	context: Context,
	handleError: (context: Context, error: Error) => unknown,
	afterResponse: ((context: Context, status?: number) => void) | undefined,
	error: unknown
): Response | Promise<Response> {
	if (error === frameworkNotFound) error = new NotFound()
	let resp: Response | Promise<Response>
	try {
		resp = handleError(context, error as Error) as
			| Response
			| Promise<Response>
	} catch (errorPipelineThrow) {
		if (!isProduction()) console.error(errorPipelineThrow)
		resp = internalServerErrorResponse(error as Error)
	}

	const pending = assimilateThenable(resp)
	if (pending)
		return pending.then(
			(r) => {
				afterResponse?.(context)
				return r
			},
			(errorPipelineThrow) => {
				if (!isProduction()) console.error(errorPipelineThrow)
				const r = internalServerErrorResponse(error as Error)
				afterResponse?.(context)
				return r
			}
		)

	afterResponse?.(context)

	return resp
}

const catchError =
	(
		context: Context,
		handleError: (context: Context, error: Error) => unknown,
		afterResponse: ((context: Context, status?: number) => void) | undefined
	) =>
	(error: Error) =>
		finalizeError(context, handleError, afterResponse, error)

function dispatchResult(
	result: unknown,
	context: Context,
	handleError: (context: Context, error: Error) => unknown,
	afterResponse: ((context: Context, status?: number) => void) | undefined
): MaybePromise<Response> {
	const pending = assimilateThenable(result)
	if (pending)
		return pending.catch(
			catchError(context, handleError, afterResponse)
		) as Promise<Response>

	return result as Response
}

function findRoute(
	context: Context,
	request: Request,
	map: FetchRouteMap,
	router: FetchRuntimeImage['router'],
	hasError: boolean,
	handleError: (context: Context, error: Error) => unknown,
	afterResponse: ((context: Context, status?: number) => void) | undefined,
	strictPath: boolean,
	hasWS?: boolean,
	hasDynamicWS?: boolean
): Response | Promise<Response> {
	const path = context.path

	if (hasWS && request.method === 'GET') {
		const handler = map['WS']?.[path]
		const found =
			handler === undefined && hasDynamicWS
				? router?.find('WS', path)
				: undefined

		if (handler !== undefined || found) {
			const upgrade = request.headers.get('upgrade')
			if (upgrade && upgrade.toLowerCase() === 'websocket') {
				if (handler)
					return dispatchResult(
						handler(context),
						context,
						handleError,
						afterResponse
					)

				context.params = decodeParams(found!.params)
				return dispatchResult(
					found!.store(context),
					context,
					handleError,
					afterResponse
				)
			}
		}
	}

	const method = request.method
	const methodMap = map[method]
	let handler: CompiledHandler | undefined = methodMap?.[path]

	if (!handler) {
		if (
			!strictPath &&
			path.length > 1 &&
			path.charCodeAt(path.length - 1) === 47
		) {
			const loose = path.slice(0, -1)
			handler = methodMap?.[loose]

			if (!handler) {
				const anyMap = map['*']
				handler = anyMap?.[path] ?? anyMap?.[loose]
			}
		} else handler = map['*']?.[path]
	}

	if (handler)
		return dispatchResult(
			handler(context),
			context,
			handleError,
			afterResponse
		)

	const found = router?.find(method, path) ?? router?.find('*', path)

	if (found) {
		context.params = decodeParams(found.params)

		return dispatchResult(
			found.store(context),
			context,
			handleError,
			afterResponse
		)
	}

	if (hasError) throw new NotFound()

	afterResponse?.(context, 404)
	return notFound(context)
}

export function createFetchKernel(
	runtime: FetchRuntimeImage
): FetchKernel {
	const {
		Context,
		map,
		router,
		hasWS,
		hasDynamicWS,
		hasRoutes,
		hasDefaultHeaders,
		strictPath,
		pathStart,
		requestHooks,
		mapResponseHooks: configuredMapResponseHooks,
		errorHooks,
		afterResponseHooks,
		traceHooks,
		hoc,
		allowUnsafeValidationDetails,
		baseMapResponse
	} = runtime
	const hasError = !!errorHooks?.length
	const mapResponseHooks = configuredMapResponseHooks as
		| ((context: Context) => unknown)[]
		| undefined
	const settleMapResponse = (mapped: unknown, request?: Request) => {
		if (!request) return mapped
		const pending = assimilateThenable(mapped)
		return pending ? settleResponse(request, pending) : mapped
	}
	const mapResponse = mapResponseHooks?.length
		? (response: unknown, set: Context['set'], context?: Context) => {
				if (!context)
					return baseMapResponse(response, set, undefined, true)
				;(context as { responseValue?: unknown }).responseValue =
					response

				const request = context.request

				const run = (i: number): unknown => {
					for (; i < mapResponseHooks.length; i++) {
						const result = mapResponseHooks[i](context)

						const pending = assimilateThenable(result)
						if (pending)
							// eslint-disable-next-line sonarjs/function-inside-loop -- promise continuation for the hook at index i
							return pending.then(
								// eslint-disable-next-line sonarjs/function-inside-loop
								(resolved) => {
								if (context.request.signal.aborted)
										return new Response()

									if (resolved !== undefined)
										return settleMapResponse(
											baseMapResponse(
												resolved,
												set,
												request,
												true
											),
											request
										)

									return run(i + 1)
								},
								(error) => {
								if (context.request.signal.aborted)
										return new Response()

									throw error
								}
							)

						if (result !== undefined)
							return settleMapResponse(
								baseMapResponse(result, set, request, true),
								request
							)
					}

					return settleMapResponse(
						baseMapResponse(response, set, request, true),
						request
					)
				}

				return run(0)
			}
		: (response: unknown, set: Context['set'], context?: Context) => {
				const request = context?.request
				return settleMapResponse(
					baseMapResponse(response, set, request, true),
					request
				)
			}

	const handleError = createErrorHandler(
		errorHooks,
		mapResponse as any,
		allowUnsafeValidationDetails
	)

	const traceHandlers = traceHooks as
		| ((context: any) => unknown)[]
		| undefined

	const hasTrace = !!traceHandlers?.length

	const tracePhases = hasTrace
		? unionTracePhases(traceHandlers as unknown as Function[])
		: null

	const traceRequestPhase =
		hasTrace && (tracePhases === null || tracePhases.has('request'))

	const traceAfterResponsePhase =
		hasTrace && (tracePhases === null || tracePhases.has('afterResponse'))

	const afterResponses = afterResponseHooks
	const afterResponse =
		afterResponses?.length || traceAfterResponsePhase
			? (context: Context, status?: number) => {
					if ((context as any)._arf) return
					;(context as any)._arf = true

					if (status !== undefined) context.set.status = status

					queueMicrotask(async () => {
						if (afterResponses) {
							materializeSetHeaders(context.set)
							for (let i = 0; i < afterResponses.length; i++)
								try {
									await afterResponses[i](context as any)
								} catch (e) {
									console.error(e)
								}
						}

						if (traceAfterResponsePhase) {
							let cache = (context as any).trace as
								| any[]
								| undefined

							if (!cache && traceHandlers) {
								context.rid ??= requestId()
								cache = createTraceHandles(
									context as any,
									traceHandlers as any
								)
								;(context as any).trace = cache
							}

							if (cache)
								for (let i = 0; i < cache.length; i++) {
									// subscription-gated: unsubscribed = flat
									// timestamps only (no recorder/literal)
									const fast = cache[i].b(
										7,
										afterResponses?.length ?? 0
									)
									if (fast) {
										cache[i].r(fast)
										continue
									}

									const r = cache[i].begin(7, {
										id: context.rid ?? '',
										event: 'afterResponse',
										name: 'afterResponse',
										begin: performance.now(),
										total: afterResponses?.length ?? 0
									})
									r.resolve()
								}
						}
					})
				}
			: undefined
	const fast404 = !hasError && !afterResponse && !hasDefaultHeaders

	const applicationFinalizeError: RouteErrorFinalizer = (context, error) =>
		finalizeError(context, handleError, afterResponse, error)
	const finish = (fetch: FetchHandler): FetchKernel =>
		Object.freeze({
			fetch: applyHocFromRuntime(hoc, fetch),
			finalizeError: applicationFinalizeError
		})

	if (traceRequestPhase) {
		const onRequests = requestHooks ?? []

		return finish(async (
			request: Request,
			server?: unknown
		): Promise<Response> => {
			const context = new Context(request)
			materializeSetHeaders(context.set)

			extractPath(request.url, context, pathStart)
			// @ts-expect-error
			context.server = server ?? null

			context.rid = requestId()

			const trace = createTraceHandles(
				context as any,
				traceHandlers as any
			)
			const traceLength = trace.length

			// @ts-expect-error private property
			context.trace = trace

			const requestReports = new Array(traceLength)
			for (let i = 0; i < traceLength; i++)
				requestReports[i] =
					trace[i].b(0, onRequests.length) ||
					trace[i].begin(0, {
						id: context.rid,
						event: 'request',
						name: 'request',
						begin: performance.now(),
						total: onRequests.length
					})

			try {
				const endReports = new Array(traceLength)
				for (let i = 0; i < onRequests.length; i++) {
					for (let j = 0; j < traceLength; j++)
						endReports[j] = requestReports[
							j
						].resolveChild?.shift?.()?.({
							id: context.rid,
							event: 'request',
							name: (onRequests[i] as any).name || 'anonymous',
							begin: performance.now()
						})

					let result = onRequests[i](context as any)
					const pending = assimilateThenable(result)
					if (pending)
						try {
							result = await pending
						} catch (error) {
							if (request.signal.aborted) {
								for (let j = 0; j < traceLength; j++) {
									endReports[j]?.()
									trace[j].r(requestReports[j])
								}

								return new Response()
							}

							for (let j = 0; j < traceLength; j++)
								endReports[j]?.(error as Error)

							throw error
						}

					for (let i = 0; i < traceLength; i++) endReports[i]?.()

					if (pending && request.signal.aborted) {
						for (let j = 0; j < traceLength; j++)
							trace[j].r(requestReports[j])

						return new Response()
					}

					if (result !== undefined) {
						for (let j = 0; j < traceLength; j++)
							trace[j].r(requestReports[j])

						const response = (await mapResponse(
							result,
							context.set,
							context
						)) as Response

						afterResponse?.(context)
						return response
					}
				}

				for (let i = 0; i < traceLength; i++)
					trace[i].r(requestReports[i])

				return await findRoute(
					context,
					request,
					map,
					router,
					hasError,
					handleError,
					afterResponse,
					strictPath,
					hasWS,
					hasDynamicWS
				)
			} catch (error) {
				for (let i = 0; i < traceLength; i++)
					trace[i].r(requestReports[i], error as Error)

				return finalizeError(
					context,
					handleError,
					afterResponse,
					error as Error
				)
			}
		})
	}

	if (requestHooks) {
		const onRequests = requestHooks

		return finish((request: Request, server?: unknown): MaybePromise<Response> => {
			const context = new Context(request)
			materializeSetHeaders(context.set)

			extractPath(request.url, context, pathStart)
			// @ts-expect-error
			context.server = server ?? null

			try {
				const run = (start: number): MaybePromise<Response> => {
					for (let i = start; i < onRequests.length; i++) {
						const result = onRequests[i](context)
						const pending = assimilateThenable(result)
						if (pending)
							return pending
								.then((resolved) => {
									if (request.signal.aborted) return new Response()
									if (resolved === undefined) return run(i + 1)

									return mapResponse(
										resolved,
										context.set,
										context
									)
								})
								.then((response) => {
									afterResponse?.(context)
									return response as Response
								})
								.catch(
									catchError(context, handleError, afterResponse)
								)

						if (result !== undefined) {
							const response = mapResponse(
								result,
								context.set,
								context
							) as Response | Promise<Response>

							const mapped = assimilateThenable(response)
							if (mapped)
								return mapped.then(
									(response) => {
										afterResponse?.(context)
										return response
									},
									catchError(context, handleError, afterResponse)
								)

							afterResponse?.(context)
							return response
						}
					}

					return findRoute(
						context,
						request,
						map,
						router,
						hasError,
						handleError,
						afterResponse,
						strictPath,
						hasWS,
						hasDynamicWS
					)
				}

				return run(0)
			} catch (error) {
				return finalizeError(
					context,
					handleError,
					afterResponse,
					error as Error
				)
			}
		})
	}

	if (fast404 && !router && !hasWS && !hasRoutes)
		return finish(() => getNotFound())

	return finish((request: Request, server?: unknown): MaybePromise<Response> => {
		const context = new Context(request)
		extractPath(request.url, context, pathStart)
		// @ts-expect-error
		context.server = server ?? null

		try {
			return findRoute(
				context,
				request,
				map,
				router,
				hasError,
				handleError,
				afterResponse,
				strictPath,
				hasWS,
				hasDynamicWS
			)
		} catch (error) {
			return finalizeError(
				context,
				handleError,
				afterResponse,
				error as Error
			)
		}
	})
}

/** Temporary authoring-state adapter; the returned kernel retains only its image. */
export function createFetchHandler(
	app: AnyElysia
): (request: Request, server?: unknown) => MaybePromise<Response> {
	const runtime = createFetchRuntimeImage(app)
	const kernel = createFetchKernel(runtime)

	if (runtime.errorFinalizer)
		runtime.errorFinalizer.current = kernel.finalizeError
	app['~runtimeBindings'].error.current = kernel.finalizeError
	app['~finalizeError'] = kernel.finalizeError

	return kernel.fetch
}

export function applyHocFromRuntime(
	hoc: readonly WrapFn<any>[] | undefined,
	fetch: FetchHandler
): FetchHandler {
	if (!hoc?.length) return fetch

	let handler = fetch
	for (let i = hoc.length - 1; i >= 0; i--) {
		const wrapped = hoc[i](handler)
		if (typeof wrapped !== 'function')
			throw new TypeError('[Elysia] HOC must return a fetch function')
		handler = wrapped
	}

	return handler
}
