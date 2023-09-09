import { HTTPStatusName } from './utils'

import type {
	DecoratorBase,
	RouteSchema,
	Prettify,
	GetPathParameter
} from './types'
import { CookieSerializeOptions } from 'cookie'

export type Context<
	Route extends RouteSchema = RouteSchema,
	Decorators extends DecoratorBase = {
		request: {}
		store: {}
	},
	Path extends string = ''
> = Prettify<
	{
		body: Route['body']
		query: undefined extends Route['query']
			? Record<string, string | null>
			: Route['query']
		params: undefined extends Route['params']
			? Path extends `${string}/${':' | '*'}${string}`
				? Record<GetPathParameter<Path>, string>
				: never
			: Route['params']
		headers: undefined extends Route['headers']
			? Record<string, string | null>
			: Route['headers']

		cookie: Record<string, string | string[]>
		set: {
			headers: Record<string, string> & {
				'Set-Cookie'?: string | string[]
			}
			status?: number | HTTPStatusName
			redirect?: string
			cookie?: Record<
				string,
				Prettify<
					{
						value: string | string[]
					} & CookieSerializeOptions
				>
			>
		}

		path: string
		request: Request
		store: Decorators['store']
	} & Decorators['request']
>

// Use to mimic request before mapping route
export type PreContext<
	Route extends RouteSchema = RouteSchema,
	Decorators extends DecoratorBase = {
		request: {}
		store: {}
	}
> = Prettify<
	{
		headers: undefined extends Route['headers']
			? Record<string, string | null>
			: Route['headers']

		set: {
			headers: { [header: string]: string } & {
				['Set-Cookie']?: string | string[]
			}
			status?: number
			redirect?: string
		}

		path: string
		request: Request
		store: Decorators['store']
	} & Decorators['request']
>
