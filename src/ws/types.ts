import type { TSchema } from 'typebox'

import type { Context } from '../context'
import type {
	BaseMacro,
	DocumentDecoration,
	ErrorHandler,
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

// Bun WebSocket types — local copy so Elysia type-checks without @types/bun
// and so we can parameterize `data` with our per-connection ctx.

type TypedArray =
	| Uint8Array
	| Uint8ClampedArray
	| Uint16Array
	| Uint32Array
	| Int8Array
	| Int16Array
	| Int32Array
	| BigUint64Array
	| BigInt64Array
	| Float32Array
	| Float64Array

export type BufferSource = TypedArray | DataView | ArrayBufferLike

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

// Yields and returns are both sent as outbound messages.
export type WSHandlerResult<Response> =
	| Response
	| void
	| Generator<Response, Response | void>
	| AsyncGenerator<Response, Response | void>

// Returning non-undefined overrides the default-parsed message.
export type WSParseHandler<Route extends RouteSchema, Context = {}> = (
	ws: Prettify<ElysiaWSLike<Context, Omit<Route, 'body'> & { body: unknown }>>,
	message: unknown
) => MaybePromise<Route['body'] | void | undefined>

// Accepts both `(ctx)` (new destructured) and `(ws, body)` (legacy positional).
// Calling convention is picked at runtime by `fn.length`.
type LifecycleFn<Ctx, Body, Response> = (
	this: void,
	ws: Ctx,
	body?: Body
) => MaybePromise<WSHandlerResult<Response>>

interface TypedWebSocketHandler<
	in out Ctx,
	in out Route extends RouteSchema = {}
> {
	open?: LifecycleFn<
		Ctx,
		never,
		FlattenResponse<Route['response']>
	>
	message?: LifecycleFn<
		Ctx,
		Route['body'],
		FlattenResponse<Route['response']>
	>
	drain?: LifecycleFn<
		Ctx,
		never,
		FlattenResponse<Route['response']>
	>
	close?: (
		this: void,
		ws: Ctx,
		code?: number,
		reason?: string
	) => MaybePromise<WSHandlerResult<FlattenResponse<Route['response']>>>
	ping?: LifecycleFn<
		Ctx,
		Buffer | string,
		FlattenResponse<Route['response']>
	>
	pong?: LifecycleFn<
		Ctx,
		Buffer | string,
		FlattenResponse<Route['response']>
	>
}

// Options passed to `.ws(path, options)` or the 3rd arg of the 3-arg form.
// `.ws(path, handler, opts)` is normalized to `{...opts, message: handler}`
// before reaching `buildWSRoute`.
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
		Omit<Context<Schema, Singleton>, 'body'> & {
			body: never
			ws: ElysiaWSLike<Context<Schema, Singleton>, Schema>
		},
		Schema
	>

export type AnyWSLocalHook = WSLocalHook<any, any, any>

// 2nd positional arg of the 3-arg `.ws()` form — same shape as `WSLocalHook['message']`.
export type WSMessageHandler<
	Schema extends RouteSchema,
	Singleton extends SingletonBase
> = LifecycleFn<
	Omit<Context<Schema, Singleton>, 'body'> & {
		body: Schema['body']
		ws: ElysiaWSLike<Context<Schema, Singleton>, Schema>
	},
	Schema['body'],
	FlattenResponse<Schema['response']>
>

// Mirrors `Validator` from `src/validator/index.ts` — kept structural to
// avoid a circular import.
export interface WSValidatorLike {
	Check(data: unknown): boolean
	Errors(data: unknown): any[]
}

// Status-keyed schemas. `send` picks `validators[status]` for ElysiaStatus
// payloads, falling back to `validators[200]` (or the first entry) for plain values.
export type WSResponseValidator =
	| { [status: number]: WSValidatorLike }
	| undefined

export type { TSchema }
