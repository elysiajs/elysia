import type { DecoratorBase, RouteSchema, Prettify } from './types'

export type Context<Route extends RouteSchema = RouteSchema> = {
	body: Route['body']
	query: undefined extends Route['query']
		? Record<string, string>
		: Route['query']
	params: Route['params']
	headers: undefined extends Route['headers']
		? Record<string, string>
		: Route['headers']

	set: {
		headers: Record<string, string>
		status?: number
		redirect?: string
	}

	path: string
	request: Request
	store: unknown
}

// Use to mimic request before mapping route
export type PreContext<
	Route extends RouteSchema = RouteSchema,
	Decorators extends DecoratorBase = {
		store: {}
	}
> = Prettify<
	{
		path: string
		request: Request
		headers: undefined extends Route['headers']
			? Record<string, string>
			: Route['headers']

		set: {
			headers: Record<string, string>
			status?: number
			redirect?: string
		}
	} & Decorators
>
