import type KingWorld from './index'
import { type JSONSchema } from 'fluent-json-schema'
import { type ParsedUrlQuery } from 'querystring'

export interface KingWorldInstance<
	Instance extends {
		store: Record<string, any>
		request: Record<string, any>
	} = {
		store: Record<string, any>
		request: Record<string, any>
	}
> {
	request?: Instance['request']
	store: Instance['store']
}

export type Context<Route extends TypedRoute = TypedRoute> = {
	request: Request
	query: Route['query'] extends Record<string, any>
		? Route['query']
		: ParsedUrlQuery
	params: Route['params']
	headers: Route['header']
	body: Promise<Route['body']>
	responseHeaders: Headers
} & Omit<Route, 'body' | 'query' | 'header' | 'body'>

export type EmptyHandler = (request: Request) => Response | Promise<Response>
export type Handler<
	Route extends TypedRoute = TypedRoute,
	Instance extends KingWorldInstance = KingWorldInstance
> = (
	context: Context<Route & Instance['request']>,
	store: Instance['store']
) => any | Promise<any>

export type HookEvent = 'onRequest' | 'transform' | 'preHandler'

export type PreRequestHandler<Store extends Record<string, any> = {}> = (
	request: Request,
	store: Store
) => void

export interface Hook<Instance extends KingWorldInstance = KingWorldInstance> {
	onRequest: PreRequestHandler<Instance['store']>[]
	transform: Handler<any, Instance>[]
	preHandler: Handler<any, Instance>[]
	schema: {
		body: JSONSchema[]
		header: JSONSchema[]
		query: JSONSchema[]
		params: JSONSchema[]
	}
}

export interface Schemas {
	body?: JSONSchema | JSONSchema[]
	header?: JSONSchema | JSONSchema[]
	query?: JSONSchema | JSONSchema[]
	params?: JSONSchema | JSONSchema[]
}

export interface RegisterHook<
	Route extends TypedRoute = TypedRoute,
	Instance extends KingWorldInstance = KingWorldInstance
> {
	transform?: Handler<Route, Instance> | Handler<Route, Instance>[]
	onRequest?: PreRequestHandler<Instance> | PreRequestHandler<Instance>[]
	preHandler?: Handler<Route, Instance> | Handler<Route, Instance>[]
	schema?: Schemas
}

export interface TypedRoute {
	body?: unknown
	header?: Record<string, unknown>
	query?: ParsedUrlQuery
	params?: Record<string, unknown>
}

export type Plugin<
	T = Record<string, unknown>,
	PluginInstance extends KingWorldInstance = KingWorldInstance,
	BaseInstance extends KingWorldInstance = KingWorldInstance
> = (
	app: KingWorld<BaseInstance & PluginInstance>,
	config?: T
) => KingWorld<BaseInstance & PluginInstance>

export type ComposedHandler = [Handler<any, any>, Hook<any>]
