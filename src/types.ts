import type KingWorld from './index'

export type KWKey = string | number | symbol

export interface KingWorldInstance<
	Instance extends {
		store: Record<KWKey, any>
		request: Record<KWKey, any>
	} = {
		store: Record<KWKey, any>
		request: Record<KWKey, any>
	}
> {
	request?: Instance['request']
	store: Instance['store']
}

export type Context<Route extends TypedRoute = TypedRoute> = {
	request: Request
	query: Route['query'] extends Record<string, any>
		? Route['query']
		: Record<string, string>
	params: Route['params']
	body: Route['body']
	status(statusCode: number): void
	responseHeaders: Headers
} & Omit<Route, 'body' | 'query' | 'header' | 'body'>

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
) => void | Promise<void>

export interface Hook<Instance extends KingWorldInstance = KingWorldInstance> {
	onRequest: PreRequestHandler<Instance['store']>[]
	transform: Handler<any, Instance>[]
	preHandler: Handler<any, Instance>[]
}

export interface RegisterHook<
	Route extends TypedRoute = TypedRoute,
	Instance extends KingWorldInstance = KingWorldInstance
> {
	transform?: Handler<Route, Instance> | Handler<Route, Instance>[]
	onRequest?: PreRequestHandler<Instance> | PreRequestHandler<Instance>[]
	preHandler?: Handler<Route, Instance> | Handler<Route, Instance>[]
}

export interface TypedRoute {
	body?: string | Record<string, any>
	header?: Map<string, unknown>
	query?: Record<string, string>
	params?: {}
}

export type Plugin<
	T = Record<string, unknown>,
	PluginInstance extends KingWorldInstance = KingWorldInstance,
	BaseInstance extends KingWorldInstance = KingWorldInstance
> = (
	app: KingWorld<BaseInstance & PluginInstance>,
	config?: T
) => KingWorld<BaseInstance & PluginInstance>

export type ComposedHandler = [handle: Handler<any, any>, hooks: Hook<any>]

export interface KingWorldConfig {
	bodyLimit: number
}

export type IsKWPathParameter<Part> = Part extends `:${infer Parameter}` ? Parameter : never;
export type ExtractKWPath<Path> = Path extends `${infer A}/${infer B}`
  ? IsKWPathParameter<A> | ExtractKWPath<B>
  : IsKWPathParameter<Path>;
