import type { Server } from 'bun'
import type { Cookie, ElysiaCookie } from './cookies'
import type {
	StatusMap,
	InvertedStatusMap,
	redirect as Redirect
} from './utils'

import { error, type ELYSIA_RESPONSE } from './error'
import type {
	RouteSchema,
	Prettify,
	GetPathParameter,
	SingletonBase,
	HTTPHeaders
} from './types'

type InvertedStatusMapKey = keyof InvertedStatusMap

type WithoutNullableKeys<Type> = {
	[Key in keyof Type]-?: NonNullable<Type[Key]>
}

export type ErrorContext<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string = ''
> = Prettify<
	{
		body: Route['body']
		query: undefined extends Route['query']
			? Record<string, string | string[] | undefined>
			: Route['query']
		params: undefined extends Route['params']
			? Path extends `${string}/${':' | '*'}${string}`
				? Record<GetPathParameter<Path>, string>
				: never
			: Route['params']
		headers: undefined extends Route['headers']
			? Record<string, string | undefined>
			: Route['headers']
		cookie: undefined extends Route['cookie']
			? Record<string, Cookie<string>>
			: Record<string, Cookie<string>> &
					Prettify<
						WithoutNullableKeys<{
							[key in keyof Route['cookie']]: Cookie<
								Route['cookie'][key]
							>
						}>
					>

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

		path: string
		request: Request
		store: Singleton['store']
		response: Route['response']
	} & Singleton['decorator'] &
		Singleton['derive'] &
		Singleton['resolve']
>

export type Context<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	},
	Path extends string = ''
> = Prettify<
	{
		body: Route['body']
		query: undefined extends Route['query']
			? Record<string, string | string[] | undefined>
			: Route['query']
		params: undefined extends Route['params']
			? Path extends `${string}/${':' | '*'}${string}`
				? { [path in GetPathParameter<Path>]: string }
				: never
			: Route['params']
		headers: undefined extends Route['headers']
			? Record<string, string | undefined>
			: Route['headers']
		cookie: undefined extends Route['cookie']
			? Record<string, Cookie<string>>
			: Record<string, Cookie<string>> &
					Prettify<
						WithoutNullableKeys<{
							[key in keyof Route['cookie']]: Cookie<
								Route['cookie'][key]
							>
						}>
					>

		server: Server | null
		redirect: Redirect

		set: {
			headers: HTTPHeaders
			status?: number | keyof StatusMap
			/**
			 * @deprecated Use inline redirect instead
			 *
			 * Will be removed in 1.2.0
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

		path: string
		request: Request
		store: Singleton['store']
		response?: Route['response']
	} & (Route['response'] extends { 200: unknown }
		? {
				error: <
					const Code extends
						| keyof Route['response']
						| InvertedStatusMap[Extract<
								InvertedStatusMapKey,
								keyof Route['response']
						  >],
					const T extends Code extends keyof Route['response']
						? Route['response'][Code]
						: Code extends keyof StatusMap
						? // @ts-ignore StatusMap[Code] always valid because Code generic check
						  Route['response'][StatusMap[Code]]
						: never
				>(
					code: Code,
					response: T
				) => {
					[ELYSIA_RESPONSE]: Code extends keyof StatusMap
						? StatusMap[Code]
						: Code
					response: T
					_type: {
						[ERROR_CODE in Code extends keyof StatusMap
							? StatusMap[Code]
							: Code]: T
					}
				}
		  }
		: {
				error: typeof error
		  }) &
		Singleton['decorator'] &
		Singleton['derive'] &
		Singleton['resolve']
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

		error: typeof error
	} & Singleton['decorator']
>
