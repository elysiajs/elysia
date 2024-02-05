import type { HTTPStatusName } from './utils'
import type { Cookie, ElysiaCookie } from './cookies'

type WithoutNullableKeys<Type> = {
	[Key in keyof Type]-?: NonNullable<Type[Key]>
}

import type {
	RouteSchema,
	Prettify,
	GetPathParameter,
	SingletonBase
} from './types'

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
			? Record<string, string | undefined>
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
			? Record<string, Cookie<any>>
			: Record<string, Cookie<any>> &
					WithoutNullableKeys<{
						[key in keyof Route['cookie']]: Cookie<
							Route['cookie'][key]
						>
					}>

		set: {
			headers: Record<string, string> & {
				'Set-Cookie'?: string | string[]
			}
			status?: number | HTTPStatusName
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
	} & Singleton['decorator'] &
		Singleton['derive'] &
		Singleton['resolve']
>

// Use to mimic request before mapping route
export type PreContext<
	Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> = Prettify<
	{
		store: Singleton['store']
		request: Request

		set: {
			headers: { [header: string]: string } & {
				['Set-Cookie']?: string | string[]
			}
			status?: number
			redirect?: string
		}
	} & Singleton['decorator']
>
