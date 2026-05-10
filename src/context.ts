import { ElysiaStatus, status, type SelectiveStatus } from './error'
import { nullObject, redirect } from './utils'

import type { AnyElysia } from './base'
import type { Server } from './universal/server'
import type { StatusMap, StatusMapBack } from './constants'
import type { Cookie } from './cookie'
import type { BaseCookie } from './cookie/types'

import type {
	RouteSchema,
	Prettify,
	SingletonBase,
	ResolvePath,
	HTTPHeaders,
	InputSchema
} from './types'

let baseCache = new WeakMap<AnyElysia, new () => any>()
let contextCache = new WeakMap<AnyElysia, new (request: Request) => any>()

export function createBaseContext(app: AnyElysia) {
	const cached = baseCache.get(app)
	if (cached) return cached

	class Decorator {}
	Object.assign(Decorator.prototype, {
		...app['~ext']?.decorator,
		store: app['~ext']?.store,
		status,
		redirect
	})

	baseCache.set(app, Decorator)
	return Decorator
}

export function clearContextCache() {
	// `WeakMap` has no `clear()`. Drop the references so cached classes
	// become eligible for GC alongside their owning apps; subsequent
	// `createBaseContext`/`createContext` calls rebuild on miss.
	baseCache = new WeakMap()
	contextCache = new WeakMap()
}

export function createContext(
	app: AnyElysia
): new (request: Request) => Context {
	const cached = contextCache.get(app)
	if (cached) return cached

	const headers = app['~ext']?.headers
		? Object.assign(nullObject(), app['~ext'].headers)
		: null

	const context = class Context extends createBaseContext(app) {
		params?: Record<string, string>
		headers?: Record<string, string>
		qi!: number
		set: { headers: Record<string, string> }
		// Trace fields — populated only when `.trace(...)` is registered.
		rid?: string
		route?: string
		trace?: any[]

		constructor(public request: Request) {
			super()

			this.set = {
				headers: Object.create(headers)
			}
		}
	} as any

	contextCache.set(app, context)
	return context
}

type CheckExcessProps<T, U> = 0 extends 1 & T
	? T // T is any
	: U extends U
		? Exclude<keyof T, keyof U> extends never
			? T
			: { [K in keyof U]: U[K] } & {
					[K in Exclude<keyof T, keyof U>]: never
				}
		: never

export type ErrorContext<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
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
			: <
					const Code extends
						| keyof Route['response']
						| StatusMapBack[Extract<
								keyof StatusMapBack,
								keyof Route['response']
						  >],
					T extends Code extends keyof Route['response']
						? Route['response'][Code]
						: Code extends keyof StatusMap
							? // @ts-ignore StatusMap[Code] always valid because Code generic check
								Route['response'][StatusMap[Code]]
							: never
				>(
					code: Code,
					response: CheckExcessProps<
						T,
						Code extends keyof Route['response']
							? Route['response'][Code]
							: Code extends keyof StatusMap
								? // @ts-ignore StatusMap[Code] always valid because Code generic check
									Route['response'][StatusMap[Code]]
								: never
					>
				) => ElysiaStatus<
					// @ts-ignore trust me bro
					Code,
					T
				>

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
		Singleton['derive'] &
		Singleton['resolve']
>

type PrettifyIfObject<T> = T extends object ? Prettify<T> : T

export type Context<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string | undefined = undefined
> = Prettify<
	{
		body: PrettifyIfObject<Route['body'] & Singleton['resolve']['body']>
		query: undefined extends Route['query']
			? {} extends NonNullable<Singleton['resolve']['query']>
				? Record<string, string>
				: Singleton['resolve']['query']
			: PrettifyIfObject<Route['query'] & Singleton['resolve']['query']>
		params: undefined extends Route['params']
			? undefined extends Path
				? {} extends NonNullable<Singleton['resolve']['params']>
					? Record<string, string>
					: Singleton['resolve']['params']
				: Path extends `${string}/${':' | '*'}${string}`
					? ResolvePath<Path>
					: never
			: PrettifyIfObject<Route['params'] & Singleton['resolve']['params']>
		headers: undefined extends Route['headers']
			? {} extends NonNullable<Singleton['resolve']['headers']>
				? Record<string, string | undefined>
				: Singleton['resolve']['headers']
			: PrettifyIfObject<
					Route['headers'] & Singleton['resolve']['headers']
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
							[key in keyof Singleton['resolve']['cookie']]-?: Cookie<
								Singleton['resolve']['cookie'][key]
							>
						}
					>

		server: Server | null
		redirect: redirect

		set: {
			headers: HTTPHeaders
			status?: number | keyof StatusMap
			/**
			 * @deprecated Use inline redirect instead
			 *
			 * @example Migration example
			 * ```ts
			 * new Elysia()
			 *     .get(({ redirect }) => redirect('/'))
			 * ```
			 */
			redirect?: string
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
		Singleton['derive'] &
		Omit<Singleton['resolve'], keyof InputSchema>
>

// Mimic request before mapping route
export type PreContext<
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
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
			redirect?: string
		}

		status: typeof status
	} & Singleton['decorator']
>
