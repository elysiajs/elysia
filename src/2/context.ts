import { ElysiaStatus, status, type SelectiveStatus } from './error'
import { checksum, redirect } from './utils'

import type { AnyElysia } from '.'
import type { Server } from './universal/server'
import type { StatusMap, StatusMapBack } from './constants'
import type { Cookie, ElysiaCookie } from './cookie'

import type {
	RouteSchema,
	Prettify,
	SingletonBase,
	ResolvePath,
	HTTPHeaders,
	InputSchema
} from './types'

let createBaseContextCount = 0
let createContextCount = 0

let baseCache: Map<number, new () => any>
let contextCache: Map<number, new () => any>

function getBaseKey(app: AnyElysia) {
	const ext = app['~ext']
	if (!ext) return 0

	return checksum(
		(ext.decorator ? checksum(JSON.stringify(ext.decorator)) : '') +
			'-' +
			(ext.store ? checksum(JSON.stringify(ext.store)) : '')
	)
}

function getContextKey(app: AnyElysia) {
	const ext = app['~ext']
	if (!ext) return 0

	return checksum(
		(ext.decorator ? checksum(JSON.stringify(ext.decorator)) : '') +
			'-' +
			(ext.store ? checksum(JSON.stringify(ext.store)) : '') +
			'-' +
			(ext.headers ? checksum(JSON.stringify(ext.headers)) : '')
	)
}

export function createBaseContext(app: AnyElysia) {
	const key = baseCache ? getBaseKey(app) : undefined
	if (key !== undefined && baseCache.has(key)) return baseCache.get(key)!

	class Decorator {}
	Object.assign(Decorator.prototype, {
		...app['~ext']?.decorator,
		store: app['~ext']?.store,
		status,
		redirect
	})

	if (createBaseContextCount > 2) {
		baseCache ??= new Map()
		baseCache.set(key ?? getBaseKey(app), Decorator)
	} else createBaseContextCount++

	return Decorator
}

export function clearContextCache() {
	// @ts-expect-error
	baseCache = contextCache = undefined
	createBaseContextCount = createContextCount = 0
}

export function createContext(
	app: AnyElysia
): new (request: Request) => Context {
	const key = contextCache ? getContextKey(app) : undefined
	if (key !== undefined && contextCache.has(key))
		return contextCache.get(key)!

	const headers = app['~ext']?.headers
		? Object.assign(Object.create(null), app['~ext'].headers)
		: null

	const context = class Context extends createBaseContext(app) {
		params?: Record<string, string>
		headers?: Record<string, string>
		qi!: number
		set: { headers: Record<string, string> }

		constructor(public request: Request) {
			super()

			this.set = {
				headers: Object.create(headers)
			}
		}
	} as any

	if (createContextCount > 2) {
		contextCache ??= new Map()
		contextCache.set(key ?? getContextKey(app), context)
	} else createContextCount++

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
			cookie?: Record<string, ElysiaCookie>
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
		 * Represent a path registered to a router, not a URL
		 *
		 * @example '/id/:id'
		 */
		route: string
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
			cookie?: Record<string, ElysiaCookie>
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
		 * Represent a path registered to a router, not a URL
		 *
		 * @example '/id/:id'
		 */
		route: string
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
