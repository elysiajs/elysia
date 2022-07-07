import { type ParsedUrlQuery } from './lib/find-my-world'

import type KingWorld from './index'
import { type JSONSchema } from 'fluent-json-schema'

// @ts-ignore
export interface KingWorldRequest<Body extends unknown = unknown> extends Request {
    json(): Promise<Body>;
}

export type ParsedRequest<Route extends TypedRoute = TypedRoute, Additional extends Record<string, unknown> = {}> = {
    request: KingWorldRequest<Route['body']>
    query: ParsedUrlQuery & Route['query']
    params: Route['params']
    readonly headers: () => Route['header']
    readonly body: () => Promise<Route['body']>
} & Omit<Route, 'body' | 'query' | 'header' | 'body'> & Additional

export type EmptyHandler = (request: Request) => Response
export type Handler<
    Route extends TypedRoute = TypedRoute,
    Store extends Record<string, any> = Record<string, any>,
    Additional extends Record<string, any> = Record<string, any>
> = (request: ParsedRequest<Route& Additional>, store: Store) => any

export type HookEvent = 'onRequest' | 'transform' | 'transform'

export type PreRequestHandler<Store = Record<string, any>> = (
    request: Request,
    store: Store
) => void

export interface Hook<Store = Record<string, any>> {
    onRequest: PreRequestHandler<Store>[]
    transform: Handler<Store>[]
    preHandler: Handler<Store>[]
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
    Store = Record<string, any>
> {
    transform?: Handler<Route, Store> | Handler<Route, Store>[]
    onRequest?: PreRequestHandler<Store> | PreRequestHandler<Store>[]
    preHandler?: Handler<Route, Store> | Handler<Route, Store>[]
    schema?: Schemas
}

export interface TypedRoute {
    body?: unknown
    header?: Record<string, unknown>
    query?: ParsedRequest & Record<string, unknown>
    params?: Record<string, unknown>
}

export type Plugin<
    T = Object,
    PluginStore = Record<string, any>,
    InstanceStore extends Record<string, any> = {}
> = (
    app: KingWorld<PluginStore & InstanceStore>,
    config?: T
) => KingWorld<PluginStore & InstanceStore>
