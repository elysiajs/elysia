import { Elysia } from '.'
import type { TypedRoute } from './types'

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

	set: {
		headers: Record<string, string>
		status?: number
		redirect?: string
	}
}

// Use to mimic request before mapping route
export type PreContext<Store extends Elysia['store'] = Elysia['store']> = Omit<
	Context<{}, Store>,
	'query' | 'params' | 'body'
>
