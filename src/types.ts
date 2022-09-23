import type KingWorld from './index'
import type Context from './context'

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
	BaseInstance extends KingWorldInstance = KingWorldInstance,
	ReturnedInstance extends KingWorld<
		BaseInstance & PluginInstance
	> = KingWorld<BaseInstance & PluginInstance>
> = (
	app: KingWorld<BaseInstance & PluginInstance>,
	config?: T
) => ReturnedInstance

export type ComposedHandler = { handle: Handler<any, any>; hooks: Hook<any> }

export interface KingWorldConfig {
	/**
	 * Defines the maximum payload, in bytes, the server is allowed to accept.
	 *
	 * @default 1048576 (1MB)
	 */
	bodyLimit: number
	/**
	 * If set to `true`, path will **NOT** try to map trailing slash with none.
	 * 
	 * For example: `/group/` will not be map to `/group` or vice versa.
	 * 
	 * @default false
	 */
	strictPath: boolean
}

export type IsKWPathParameter<Part> = Part extends `:${infer Parameter}`
	? Parameter
	: never
export type ExtractKWPath<Path> = Path extends `${infer A}/${infer B}`
	? IsKWPathParameter<A> | ExtractKWPath<B>
	: IsKWPathParameter<Path>

export interface InternalRoute<Instance extends KingWorldInstance> {
	method: HTTPMethod
	path: string
	handler: Handler<any, Instance>
	hooks: RegisterHook<any, Instance>
}

export type HTTPMethod =
	| 'ACL'
	| 'BIND'
	| 'CHECKOUT'
	| 'CONNECT'
	| 'COPY'
	| 'DELETE'
	| 'GET'
	| 'HEAD'
	| 'LINK'
	| 'LOCK'
	| 'M-SEARCH'
	| 'MERGE'
	| 'MKACTIVITY'
	| 'MKCALENDAR'
	| 'MKCOL'
	| 'MOVE'
	| 'NOTIFY'
	| 'OPTIONS'
	| 'PATCH'
	| 'POST'
	| 'PROPFIND'
	| 'PROPPATCH'
	| 'PURGE'
	| 'PUT'
	| 'REBIND'
	| 'REPORT'
	| 'SEARCH'
	| 'SOURCE'
	| 'SUBSCRIBE'
	| 'TRACE'
	| 'UNBIND'
	| 'UNLINK'
	| 'UNLOCK'
	| 'UNSUBSCRIBE'
