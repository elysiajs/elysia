import type { Server } from './universal/server'
import type { Cookie, ElysiaCookie } from './cookies'
import type {
	StatusMap,
	InvertedStatusMap,
	redirect as Redirect
} from './utils'

import { ElysiaCustomStatusResponse, status } from './error'
import type {
	RouteSchema,
	Prettify,
	ResolvePath,
	SingletonBase,
	HTTPHeaders,
	InputSchema,
	PossibleResponse
} from './types'

type InvertedStatusMapKey = keyof InvertedStatusMap

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
		redirect: Redirect

		set: {
			headers: HTTPHeaders
			status?: number | keyof StatusMap
			redirect?: string
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
						| InvertedStatusMap[Extract<
								InvertedStatusMapKey,
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
					response: T
					// @ts-ignore trust me bro
				) => ElysiaCustomStatusResponse<Code, T>

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

export type SelectiveStatus<Res> = <
	const Code extends
		| keyof Res
		| InvertedStatusMap[Extract<InvertedStatusMapKey, keyof Res>]
>(
	code: Code,
	response: Code extends keyof Res
		? Res[Code]
		: Code extends keyof StatusMap
			? // @ts-ignore StatusMap[Code] always valid because Code generic check
				Res[StatusMap[Code]]
			: never
	// @ts-ignore trust me bro
) => ElysiaCustomStatusResponse<Code, T>

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
			? {} extends NonNullable<Singleton['resolve']['query']>
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
		redirect: Redirect

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

// Use to mimic request before mapping route
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

		redirect: Redirect
		server: Server | null

		set: {
			headers: HTTPHeaders
			status?: number
			redirect?: string
		}

		status: typeof status
	} & Singleton['decorator']
>
