import { status, type SelectiveStatus } from './error'
import { nullObject, redirect } from './utils'

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
	DefaultSingleton
} from './types'

let baseCache = new WeakMap<AnyElysia, new () => any>()
let contextCache = new WeakMap<AnyElysia, new (request: Request) => any>()

let sharedEmptyDecorator: any = null
let sharedEmptyContext: any = null

function buildEmptyDecorator() {
	class Decorator {}
	Object.assign(Decorator.prototype, { status, redirect })
	return Decorator
}

export function createBaseContext(app: AnyElysia) {
	const cached = baseCache.get(app)
	if (cached) return cached

	const ext = app['~ext']
	const decorator = ext?.decorator
	const store = ext?.store

	if (!decorator && !store) {
		sharedEmptyDecorator ??= buildEmptyDecorator()
		baseCache.set(app, sharedEmptyDecorator)
		return sharedEmptyDecorator
	}

	class Decorator {}
	Object.assign(Decorator.prototype, {
		...decorator,
		store,
		status,
		redirect
	})

	baseCache.set(app, Decorator)
	return Decorator
}

export function clearContextCache() {
	baseCache = new WeakMap()
	contextCache = new WeakMap()
	sharedEmptyDecorator = null
	sharedEmptyContext = null
}

function buildEmptyContext(Base: any, headers: object | null = null) {
	return class Context extends Base {
		params?: Record<string, string>
		headers?: Record<string, string>
		qi!: number
		set: {
			headers: Record<string, string>
			status?: number | string
			cookie?: Record<string, unknown>
		}
		rid?: string
		route?: string
		trace?: any[]

		constructor(public request: Request) {
			super()
			this.set = {
				headers: Object.create(headers),
				status: undefined,
				cookie: undefined
			}
		}
	}
}

export function createContext(
	app: AnyElysia
): new (request: Request) => Context {
	const cached = contextCache.get(app)
	if (cached) return cached

	const ext = app['~ext']
	const headers = ext?.headers
		? Object.assign(nullObject(), ext.headers)
		: null

	if (headers === null && !ext?.decorator && !ext?.store) {
		sharedEmptyDecorator ??= buildEmptyDecorator()
		sharedEmptyContext ??= buildEmptyContext(sharedEmptyDecorator)
		contextCache.set(app, sharedEmptyContext)

		return sharedEmptyContext
	}

	const context = buildEmptyContext(createBaseContext(app), headers) as any

	contextCache.set(app, context)
	return context
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
		 * Path extracted from incoming URL
		 *
		 * Represent a value extracted from URL
		 *
		 * @example '/id/9'
		 */
		path: string
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
	} & Singleton['decorator'] &
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
				? Record<string, string>
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

		/**
		 * Path extracted from incoming URL
		 *
		 * Represent a value extracted from URL
		 *
		 * @example '/id/9'
		 */
		path: string
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

		status: {} extends Route['response']
			? typeof status
			: SelectiveStatus<Route['response']>
	} & Singleton['decorator'] &
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
