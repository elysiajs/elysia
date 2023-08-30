import type {
	DecoratorBase,
	RouteSchema,
	Prettify,
	GetPathParameter
} from './types'

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
			? Record<GetPathParameter<Path>, string>
			: Route['params']
		headers: undefined extends Route['headers']
			? Record<string, string | null>
			: Route['headers']

		set: {
			headers: Record<string, string>
			status?: number
			redirect?: string
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
			headers: Record<string, string>
			status?: number
			redirect?: string
		}

		path: string
		request: Request
		store: Decorators['store']
	} & Decorators['request']
>
