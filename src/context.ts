import { Elysia } from '.'
import type { TypedRoute } from './types'

type UnwrapFn<T> = T extends (...params: any) => any ? ReturnType<T> : T

export interface Context<
	Route extends TypedRoute = TypedRoute,
	Store extends Elysia['store'] = Elysia['store']
> {
	request: Request
	query: UnwrapFn<Route['query']> extends undefined
		? Record<string, unknown>
		: UnwrapFn<Route['query']>
	params: UnwrapFn<Route['params']>
	body: UnwrapFn<Route['body']>
	store: Store

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
