import type { Elysia, TypedRoute, DEFS, SCHEMA, TypedSchema } from '.'

export interface Context<
	Route extends TypedRoute = TypedRoute,
	Store extends Elysia['store'] = Elysia['store']
> {
	request: Request
	query: Route['query'] extends undefined
		? Record<string, unknown>
		: Route['query']
	params: Route['params']
	body: Route['body']
	store: Store

	[SCHEMA]?: TypedSchema
	[DEFS]?: {
        [index: string]: Record<string, unknown>;
    }

	set: {
		headers: Record<string, string>
		status?: number
		redirect?: string
	}
}

// Use to mimic request before mapping route
export type PreContext<
	Route extends TypedRoute = TypedRoute,
	Store extends Elysia['store'] = Elysia['store']
> = Omit<Context<Route, Store>, 'query' | 'params' | 'body'>
