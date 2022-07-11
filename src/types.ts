import { type ParsedUrlQuery } from 'querystring'

import type KingWorld from './index'
import { type JSONSchema } from 'fluent-json-schema'

export interface KingWorldInstance<
	Store extends Record<string, any> = {},
	Request extends Record<string, any> = {}
> {
	Request?: Request
	Store: Store
}

// @ts-ignore
export interface KingWorldRequest<Body extends unknown = unknown>
	extends Request {
	json(): Promise<Body>
}

export type ParsedRequest<Route extends TypedRoute = TypedRoute> = {
	request: KingWorldRequest<Route['body']>
	query: ParsedUrlQuery & Route['query']
	params: Route['params']
	readonly headers: () => Route['header']
	readonly body: () => Promise<Route['body']>
	responseHeader: Record<string, any>
} & Omit<Route, 'body' | 'query' | 'header' | 'body'>

export type EmptyHandler = (request: Request) => Response | Promise<Response>
export type Handler<
	Route extends TypedRoute = TypedRoute,
	Instance extends KingWorldInstance = KingWorldInstance
> = (
	request: ParsedRequest<Route & Instance['Request']>,
	store: Instance['Store']
) => any | Promise<any>

export type HookEvent = 'onRequest' | 'transform' | 'preHandler'

export type PreRequestHandler<Store extends Record<string, any> = {}> = (
	request: Request,
	store: Store
) => void

export interface Hook<Instance extends KingWorldInstance = KingWorldInstance> {
	onRequest: PreRequestHandler<Instance['Store']>[]
	transform: Handler<{}, Instance>[]
	preHandler: Handler<{}, Instance>[]
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
	query?: Record<string, unknown>
	params?: Record<string, unknown>
}

export type Plugin<
	T = Record<string, unknown>,
	PluginInstance extends KingWorldInstance = KingWorldInstance,
	BaseInstance extends KingWorldInstance = KingWorldInstance<{
		Request: {}
		Store: {}
	}>
> = (
	app: KingWorld<BaseInstance & PluginInstance>,
	config?: T
) => KingWorld<BaseInstance & PluginInstance>

export type ComposedHandler = [Handler<any, any>, Hook<any>]
