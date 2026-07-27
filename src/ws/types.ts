import type { AnyElysia } from '../base'
import type { Context } from '../context'
import type {
	BaseMacro,
	DocumentDecoration,
	ErrorHandler,
	InlineHandlerResponse,
	InternalRoute,
	MaybeArray,
	MaybePromise,
	OptionalHandler,
	Prettify,
	RouteSchema,
	SingletonBase,
	TransformHandler,
	AfterResponseHandler,
	MapResponse
} from '../types'

export type BufferSource = ArrayBufferView | ArrayBufferLike

export type ServerWebSocketSendStatus = number

export type WebSocketReadyState = 0 | 1 | 2 | 3

export interface ServerWebSocket<T = undefined> {
	send(
		data: string | BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus
	sendText(data: string, compress?: boolean): ServerWebSocketSendStatus
	sendBinary(
		data: BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus
	close(code?: number, reason?: string): void
	terminate(): void
	ping(data?: string | BufferSource): ServerWebSocketSendStatus
	pong(data?: string | BufferSource): ServerWebSocketSendStatus
	publish(
		topic: string,
		data: string | BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus
	publishText(
		topic: string,
		data: string,
		compress?: boolean
	): ServerWebSocketSendStatus
	publishBinary(
		topic: string,
		data: BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus
	subscribe(topic: string): void
	unsubscribe(topic: string): void
	isSubscribed(topic: string): boolean
	readonly subscriptions: string[]
	cork<R = unknown>(callback: (ws: ServerWebSocket<T>) => R): R
	readonly remoteAddress: string
	readonly readyState: WebSocketReadyState
	binaryType?: 'nodebuffer' | 'arraybuffer' | 'uint8array'
	data: T
}

export type WebSocketCompressor =
	| 'disable'
	| 'shared'
	| 'dedicated'
	| '3KB'
	| '4KB'
	| '8KB'
	| '16KB'
	| '32KB'
	| '64KB'
	| '128KB'
	| '256KB'

export interface WebSocketHandler<T = undefined> {
	message(
		ws: ServerWebSocket<T>,
		message: string | Buffer
	): void | Promise<void>
	open?(ws: ServerWebSocket<T>): void | Promise<void>
	drain?(ws: ServerWebSocket<T>): void | Promise<void>
	close?(
		ws: ServerWebSocket<T>,
		code: number,
		reason: string
	): void | Promise<void>
	ping?(ws: ServerWebSocket<T>, data: Buffer): void | Promise<void>
	pong?(ws: ServerWebSocket<T>, data: Buffer): void | Promise<void>
	maxPayloadLength?: number
	backpressureLimit?: number
	closeOnBackpressureLimit?: boolean
	idleTimeout?: number
	publishToSelf?: boolean
	sendPings?: boolean
	perMessageDeflate?:
		| boolean
		| {
				compress?: WebSocketCompressor | boolean
				decompress?: WebSocketCompressor | boolean
		  }
}

// Union of response shapes across all status codes.
export type FlattenResponse<Response extends RouteSchema['response']> =
	{} extends Response ? unknown : Response[keyof Response]

// Forward reference to the ElysiaWS class; the actual class is
// value-imported from `./context` to avoid a cycle.
export interface ElysiaWSLike<
	Context = unknown,
	Route extends RouteSchema = {}
> {
	send(
		data: FlattenResponse<Route['response']> | BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus
	close(code?: number, reason?: string): void
	terminate(): void
	publish(
		topic: string,
		data: FlattenResponse<Route['response']> | BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus
	subscribe(topic: string): void
	unsubscribe(topic: string): void
	isSubscribed(topic: string): boolean
	cork<R = unknown>(callback: (ws: ElysiaWSLike<Context, Route>) => R): R
	readonly subscriptions: string[]
	readonly remoteAddress: string
	readonly readyState: WebSocketReadyState
	readonly id: string
	body: Route['body']
}

export type WSHandlerResult<Response> = {} extends Response
	? unknown
	:
			| FlattenResponse<Response>
			| InlineHandlerResponse<Response>
			| void
			| Generator<
					FlattenResponse<Response>,
					FlattenResponse<Response> | void
			  >
			| AsyncGenerator<
					FlattenResponse<Response>,
					FlattenResponse<Response> | void
			  >

export type WSHandlerResponse<Handler> = Handler extends (
	...args: any[]
) => infer R
	? Awaited<R> extends
			| Generator<infer Yield, any, any>
			| AsyncGenerator<infer Yield, any, any>
		? Yield
		: Exclude<Awaited<R>, void | undefined>
	: never

export type WSParseHandler<Route extends RouteSchema, Context = {}> = (
	ws: Prettify<
		ElysiaWSLike<Context, Omit<Route, 'body'> & { body: unknown }>
	>,
	message: unknown
) => MaybePromise<Route['body'] | void | undefined>

type LifecycleFn<Ctx, Body, Response> = (
	this: void,
	ws: Ctx,
	body: Body
) => MaybePromise<WSHandlerResult<Response>>

interface TypedWebSocketHandler<
	in out Ctx,
	in out Route extends RouteSchema = {}
> {
	open?: LifecycleFn<Ctx, never, Route['response']>
	message?: LifecycleFn<
		Omit<Ctx, 'body'> & { body: Route['body'] },
		Route['body'],
		Route['response']
	>
	drain?: LifecycleFn<Ctx, never, Route['response']>
	close?: (
		this: void,
		ws: Ctx,
		code?: number,
		reason?: string
	) => MaybePromise<WSHandlerResult<Route['response']>>
	ping?: LifecycleFn<Ctx, Buffer | string, Route['response']>
	pong?: LifecycleFn<Ctx, Buffer | string, Route['response']>
}

export type WSLocalHook<
	Input extends BaseMacro,
	Schema extends RouteSchema,
	Singleton extends SingletonBase
> = Prettify<Input> & {
	detail?: DocumentDecoration

	// Object → static upgrade headers; function → computed from upgrade ctx.
	upgrade?: Record<string, unknown> | ((context: Context) => unknown)

	parse?: MaybeArray<WSParseHandler<Schema>>
	transform?: MaybeArray<TransformHandler<Schema, Singleton>>
	beforeHandle?: MaybeArray<OptionalHandler<Schema, Singleton>>
	afterHandle?: MaybeArray<OptionalHandler<Schema, Singleton>>
	mapResponse?: MaybeArray<MapResponse<Schema, Singleton>>
	afterResponse?: MaybeArray<AfterResponseHandler<Schema, Singleton>>
	error?: MaybeArray<ErrorHandler<[], Schema, Singleton>>
	tags?: DocumentDecoration['tags']

	// Bun server-level knobs (folded into the global `websocket: {...}` config).
	maxPayloadLength?: number
	backpressureLimit?: number
	closeOnBackpressureLimit?: boolean
	idleTimeout?: number
	publishToSelf?: boolean
	sendPings?: boolean
	perMessageDeflate?: WebSocketHandler['perMessageDeflate']
} & TypedWebSocketHandler<
		// The handler arg is the `ElysiaWS` instance: route context props
		// (params/query/headers/derive) are spread TOP-LEVEL alongside the ws
		// methods (send/publish/subscribe/…), matching the runtime instance.
		Omit<Context<Schema, Singleton>, 'body'> &
			Omit<ElysiaWSLike<Context<Schema, Singleton>, Schema>, 'body'> & {
				body: never
			},
		Schema
	>

export type AnyWSLocalHook = WSLocalHook<any, any, any>

export type WSMessageHandler<
	Schema extends RouteSchema,
	Singleton extends SingletonBase
> = LifecycleFn<
	Omit<Context<Schema, Singleton>, 'body'> &
		Omit<ElysiaWSLike<Context<Schema, Singleton>, Schema>, 'body'> & {
			body: Schema['body']
		},
	Schema['body'],
	Schema['response']
>

// Mirrors `Validator` from `src/validator/index.ts` to avoid circular import
export interface WSValidatorLike {
	Check(data: unknown): boolean
	Errors(data: unknown): any[]
}

export type WSResponseValidator =
	| { [status: number]: WSValidatorLike }
	| undefined

/**
 * App-wide WebSocket server-tuning options, the Bun server-level
 * `websocket: {...}` knobs (`maxPayloadLength`, `idleTimeout`,
 * `perMessageDeflate`, …). Lifecycle handlers are per-route only, so they are
 * omitted here. Formerly `ElysiaConfig.websocket`; now carried by the severable
 * WebSocket capability (`elysia/websocket`).
 */
export type WSOptions = Omit<
	WebSocketHandler<any>,
	'open' | 'close' | 'message' | 'drain' | 'ping' | 'pong'
>

/**
 * A single `websocket(options)` registration, tagged with its merge `depth`
 * (0 = registered directly on the consuming app; +1 per `.use()` hop) and a
 * DETERMINISTIC `origin` key (registrar name + module url + options checksum)
 * used to dedup diamond-dependency re-appends. See `plans/severability`.
 */
export interface WSOptionsEntry {
	depth: number
	value: WSOptions
	origin: string
}

/**
 * Runtime WebSocket capability provider, an immutable module-level singleton
 * produced by `elysia/websocket` and stored on `~ext.capability.ws.provider`.
 * Core reaches WS route construction and the global handler exclusively through
 * this object, so `src/ws/route` stays statically unreachable from the default
 * bundle. Signatures are declared explicitly here (never `typeof buildWSRoute`
 * at a core import site) so `import type { WSCapability }` in core is fully
 * erased and never re-pins the severed module.
 */
export interface WSCapability {
	readonly id: string
	buildWSRoute(
		route: InternalRoute,
		app: AnyElysia
	): [
		fetch: (
			context: Context
		) => Promise<Response | undefined> | Response | undefined,
		options: Partial<WebSocketHandler<any>>
	]
	buildGlobalWSHandler(): WebSocketHandler<any>
	/**
	 * Depth-precedence merge of registration entries (shallower wins per key;
	 * ties resolve to the last-registered; one warning per overridden key).
	 */
	resolveOptions(entries: WSOptionsEntry[]): WSOptions | undefined
	/**
	 * Fold a single route's server-tuning options into the build-local config,
	 * warning on conflicting keys (Bun uses one global config per server).
	 */
	accumulateOptions(
		target: WSOptions,
		routeOptions: WSOptions,
		path: string
	): void
}
