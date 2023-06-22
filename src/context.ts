import type { Elysia, TypedRoute, SCHEMA, HTTPStatus } from '.'

export type Context<
	Route extends TypedRoute = TypedRoute,
	Store extends Elysia['store'] = Elysia['store']
> = {
	request: Request
	headers: undefined extends Route['headers']
		? Record<string, string | null>
		: Route['headers']
	query: undefined extends Route['query']
		? Record<string, unknown>
		: Route['query']
	params: Route['params']
	body: Route['body']
	store: Store

	set: {
		headers: Record<string, string>
		status?: HTTPStatus
		redirect?: string
	}
} & Record<typeof SCHEMA, Route>

// Use to mimic request before mapping route
export type PreContext<
	Route extends TypedRoute = TypedRoute,
	Store extends Elysia['store'] = Elysia['store']
> = Omit<Context<Route, Store>, 'query' | 'params' | 'body'>
