import { status, type SelectiveStatus } from './error'
import { flattenChain, isNotEmpty, nullObject, redirect } from './utils'
import { isProduction } from './universal/is-production'

import { defaultHeaders } from './adapter/default-headers'
import type { AnyElysia } from './base'
import type { Server } from './universal/server'
import type { StatusMap } from './constants'
import type { Cookie } from './cookie'
import type { BaseCookie } from './cookie/types'

import type {
	RouteSchema,
	Prettify,
	SingletonBase,
	ResolvePath,
	HTTPHeaders,
	InputSchema,
	DefaultSingleton,
	AfterResponseHandler,
	MaybePromise
} from './types'

let contextCache = new WeakMap<AnyElysia, new (request: Request) => any>()

let sharedEmptyDecorator: any = null
let sharedEmptyContext: any = null

const defer = {
	configurable: true,
	get(this: any) {
		const queue = (this['~afterResponse'] ??= [])
		const append = (fn: Function) => queue.push(fn)
		Object.defineProperty(this, 'defer', { value: append })

		return append
	}
}

function buildEmptyDecorator() {
	class Decorator {}
	Object.assign(Decorator.prototype, { status, redirect })
	Object.defineProperty(Decorator.prototype, 'defer', defer)
	return Decorator
}

export function createBaseContext(app: AnyElysia) {
	const ext = app['~ext']
	const decorator = ext?.decorator
	const store = ext?.store

	if (!decorator && !store)
		return (sharedEmptyDecorator ??= buildEmptyDecorator())

	class Decorator {}
	Object.assign(Decorator.prototype, {
		...decorator,
		store,
		status,
		redirect
	})
	Object.defineProperty(Decorator.prototype, 'defer', defer)

	return Decorator
}

export function clearContextCache() {
	contextCache = new WeakMap()
	sharedEmptyDecorator = null
	sharedEmptyContext = null
}

function buildEmptyContext(
	Base: any,
	headers: object | null = null,
	warnPathMutation = false
) {
	const immutableHeaders = headers !== null && Object.isFrozen(headers)
	let warnedPathMutation = false
	const pathDescriptor: PropertyDescriptor | undefined = warnPathMutation
		? {
				enumerable: true,
				configurable: true,
				get(this: any) {
					return this['~path']
				},
				set(this: any, value: string) {
					if ('~path' in this && !warnedPathMutation) {
						warnedPathMutation = true
						console.warn(
							'[elysia] context.path is readonly; request-hook rerouting will stop working in a future release.'
						)
					}

					this['~path'] = value
				}
			}
		: undefined

	class Context extends Base {
		declare params?: Record<string, string>
		declare headers?: Record<string, string>
		declare qi: number
		declare set: {
			headers: Record<string, string>
			status?: number | string
			cookie?: Record<string, unknown>
		}
		declare rid?: string
		declare route?: string
		declare trace?: any[]
		declare '~sig'?: AbortSignal

		constructor(public request: Request) {
			super()

			if (pathDescriptor)
				Object.defineProperty(this, 'path', pathDescriptor)

			if (immutableHeaders)
				this.set = {
					headers: headers!,
					status: undefined,
					cookie: undefined
				} as any
			else
				this.set = {
					headers:
						headers === null
							? Object.create(null)
							: Object.assign(Object.create(null), headers),
					status: undefined,
					cookie: undefined
				}
		}
	}

	return Context
}

export function createContext(
	app: AnyElysia
): new (request: Request) => Context {
	const cached = contextCache.get(app)
	if (cached) return cached

	const ext = app['~ext']
	const adapter = app['~config']?.adapter
	const warnPathMutation =
		!isProduction() && !!flattenChain(app['~hookChain'])?.request?.length
	const headers =
		ext?.headers && isNotEmpty(ext.headers)
			? Object.assign(nullObject(), ext.headers)
			: null

	if (headers && (!adapter || adapter.response.supportsDefaultHeaderSink)) {
		Object.defineProperty(headers, defaultHeaders, { value: headers })
		Object.freeze(headers)
	}

	if (headers === null && !ext?.decorator && !ext?.store) {
		sharedEmptyDecorator ??= buildEmptyDecorator()
		const context = warnPathMutation
			? buildEmptyContext(sharedEmptyDecorator, null, true)
			: (sharedEmptyContext ??= buildEmptyContext(sharedEmptyDecorator))
		contextCache.set(app, context)

		return context
	}

	const context = buildEmptyContext(
		createBaseContext(app),
		headers,
		warnPathMutation
	) as any

	contextCache.set(app, context)
	return context
}

interface ContextBase<
	in out Route extends RouteSchema,
	in out Singleton extends SingletonBase
> {
	server: Server | null
	redirect: redirect

	set: {
		headers: HTTPHeaders
		status?: number | keyof StatusMap
		/**
		 * ! Internal Property
		 *
		 * Use `Context.cookie` instead
		 */
		cookie?: Record<string, BaseCookie>
	}

	status: {} extends Route['response']
		? typeof status
		: SelectiveStatus<Route['response']>

	/**
	 * Append a callback to run after the response is sent
	 */
	defer(fn: AfterResponseHandler<Route, Singleton>): MaybePromise<void>

	/**
	 * Path extracted from incoming URL
	 *
	 * Represent a value extracted from URL
	 *
	 * @example '/id/9'
	 */
	readonly path: string
	/**
	 * Path as registered to router
	 *
	 * Represent a path registered to a router, not a URL.
	 * Set only for dynamic routes; for static routes, fall back to `path`.
	 *
	 * @example '/id/:id'
	 */
	route?: string
	/**
	 * Per-request id, populated when `.trace(...)` is registered.
	 */
	rid?: string
	request: Request
	store: Singleton['store']
}

export type ErrorContext<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = DefaultSingleton,
	Path extends string | undefined = undefined
> = Prettify<
	{
		body: Route['body']
		query: undefined extends Route['query']
			? Record<string, string | undefined>
			: Route['query']
		params: undefined extends Route['params']
			? Path extends `${string}/${':' | '*'}${string}`
				? ResolvePath<Path>
				: { [key in string]: string }
			: Route['params']
		headers: undefined extends Route['headers']
			? Record<string, string | undefined>
			: Route['headers']
		cookie: undefined extends Route['cookie']
			? Record<string, Cookie<string | undefined>>
			: Record<string, Cookie<string | undefined>> & {
					[key in keyof Route['cookie']]-?: NonNullable<
						Cookie<Route['cookie'][key]>
					>
				}
	} & ContextBase<Route, Singleton> &
		Singleton['decorator'] &
		Singleton['derive']
>

type PrettifyIfObject<T> = T extends object ? Prettify<T> : T

export type Context<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = DefaultSingleton,
	Path extends string | undefined = undefined
> = Prettify<
	{
		body: PrettifyIfObject<Route['body'] & Singleton['derive']['body']>
		query: undefined extends Route['query']
			? {} extends NonNullable<Singleton['derive']['query']>
				? Record<string, string | undefined>
				: Singleton['derive']['query']
			: PrettifyIfObject<Route['query'] & Singleton['derive']['query']>
		params: undefined extends Route['params']
			? undefined extends Path
				? {} extends NonNullable<Singleton['derive']['params']>
					? Record<string, string>
					: Singleton['derive']['params']
				: Path extends `${string}/${':' | '*'}${string}`
					? ResolvePath<Path>
					: never
			: PrettifyIfObject<Route['params'] & Singleton['derive']['params']>
		headers: undefined extends Route['headers']
			? {} extends NonNullable<Singleton['derive']['headers']>
				? Record<string, string | undefined>
				: Singleton['derive']['headers']
			: PrettifyIfObject<
					Route['headers'] & Singleton['derive']['headers']
				>
		cookie: undefined extends Route['cookie']
			? Record<string, Cookie<unknown>>
			: Record<string, Cookie<unknown>> &
					Prettify<
						{
							[key in keyof Route['cookie']]-?: Cookie<
								Route['cookie'][key]
							>
						} & {
							[key in keyof Singleton['derive']['cookie']]-?: Cookie<
								Singleton['derive']['cookie'][key]
							>
						}
					>
	} & ContextBase<Route, Singleton> &
		Singleton['decorator'] &
		Omit<Singleton['derive'], keyof InputSchema>
>

export type LifecycleContext<
	Route extends RouteSchema = {},
	Singleton extends SingletonBase = DefaultSingleton,
	Path extends string | undefined = undefined,
	ParamsScope extends 'local' | 'plugin' | 'global' = 'local'
> = [ParamsScope] extends ['local']
	? Context<Route, Singleton, Path>
	: Omit<Context<Route, Singleton, Path>, 'params'> & {
			params: { [name: string]: string | undefined }
		}

// Mimic request before mapping route
export type PreContext<
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
	}
> = Prettify<
	{
		store: Singleton['store']
		request: Request

		redirect: redirect
		server: Server | null

		set: {
			headers: HTTPHeaders
			status?: number
		}

		status: typeof status
	} & Singleton['decorator']
>
