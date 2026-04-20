import { TSchema } from '@sinclair/typebox'

import type { ElysiaWS } from './index'
import { WebSocketHandler } from './bun'

import type { Context } from '../context'
import {
	AfterResponseHandler,
	BaseMacro,
	DocumentDecoration,
	ErrorHandler,
	InputSchema,
	MacroToContext,
	MapResponse,
	MaybeArray,
	MaybePromise,
	MetadataBase,
	OptionalHandler,
	Prettify,
	RouteSchema,
	SingletonBase,
	TransformHandler,
	UnwrapSchema
} from '../types'

type TypedWebSocketMethod =
	| 'open'
	| 'message'
	| 'drain'
	| 'close'
	| 'ping'
	| 'pong'

export type FlattenResponse<Response extends RouteSchema['response']> =
	{} extends Response ? unknown : Response[keyof Response]

interface TypedWebSocketHandler<
	in out Context,
	in out Route extends RouteSchema = {}
> extends Omit<WebSocketHandler<Context>, TypedWebSocketMethod> {
	open?(
		ws: Prettify<ElysiaWS<Context, Omit<Route, 'body'> & { body: never }>>
	): MaybePromise<FlattenResponse<Route['response']> | void>
	message?(
		ws: Prettify<ElysiaWS<Context, Route>>,
		message: Route['body']
	): MaybePromise<
		| FlattenResponse<Route['response']>
		| void
		| Generator<
				FlattenResponse<Route['response']>,
				void | FlattenResponse<Route['response']>
		  >
		| AsyncGenerator<
				FlattenResponse<Route['response']>,
				void | FlattenResponse<Route['response']>
		  >
	>
	drain?(
		ws: Prettify<ElysiaWS<Context, Omit<Route, 'body'> & { body: never }>>
	): MaybePromise<
		| FlattenResponse<Route['response']>
		| void
		| Generator<
				FlattenResponse<Route['response']>,
				void | FlattenResponse<Route['response']>
		  >
		| AsyncGenerator<
				FlattenResponse<Route['response']>,
				void | FlattenResponse<Route['response']>
		  >
	>
	close?(
		ws: Prettify<ElysiaWS<Context, Omit<Route, 'body'> & { body: never }>>,
		code: number,
		reason: string
	): MaybePromise<
		| FlattenResponse<Route['response']>
		| void
		| Generator<
				FlattenResponse<Route['response']>,
				void | FlattenResponse<Route['response']>
		  >
		| AsyncGenerator<
				FlattenResponse<Route['response']>,
				void | FlattenResponse<Route['response']>
		  >
	>
	ping?(
		ws: Prettify<ElysiaWS<Context>>,
		message: Route['body']
	): MaybePromise<
		| FlattenResponse<Route['response']>
		| void
		| Generator<
				FlattenResponse<Route['response']>,
				void | FlattenResponse<Route['response']>
		  >
		| AsyncGenerator<
				FlattenResponse<Route['response']>,
				void | FlattenResponse<Route['response']>
		  >
	>
	pong?(
		ws: Prettify<ElysiaWS<Context>>,
		message: Route['body']
	): MaybePromise<
		| FlattenResponse<Route['response']>
		| void
		| Generator<
				FlattenResponse<Route['response']>,
				void | FlattenResponse<Route['response']>
		  >
		| AsyncGenerator<
				FlattenResponse<Route['response']>,
				void | FlattenResponse<Route['response']>
		  >
	>
}

export type WSParseHandler<Route extends RouteSchema, Context = {}> = (
	ws: Prettify<ElysiaWS<Context, Omit<Route, 'body'> & { body: unknown }>>,
	message: unknown
) => MaybePromise<Route['body'] | void | undefined>

export type AnyWSLocalHook = WSLocalHook<any, any, any>

export type WSLocalHook<
	Input extends BaseMacro,
	Schema extends RouteSchema,
	Singleton extends SingletonBase
> = Prettify<Input> & {
	detail?: DocumentDecoration
	/**
	 * Headers to register to websocket before `upgrade`
	 */
	upgrade?: Record<string, unknown> | ((context: Context) => unknown)
	parse?: MaybeArray<WSParseHandler<Schema>>

	/**
	 * Transform context's value
	 */
	transform?: MaybeArray<TransformHandler<Schema, Singleton>>
	/**
	 * Execute before main handler
	 */
	beforeHandle?: MaybeArray<OptionalHandler<Schema, Singleton>>
	/**
	 * Execute after main handler
	 */
	afterHandle?: MaybeArray<OptionalHandler<Schema, Singleton>>
	/**
	 * Execute after main handler
	 */
	mapResponse?: MaybeArray<MapResponse<Schema, Singleton>>
	/**
	 * Execute after response is sent
	 */
	afterResponse?: MaybeArray<AfterResponseHandler<Schema, Singleton>>
	/**
	 * Catch error
	 */
	error?: MaybeArray<ErrorHandler<{}, Schema, Singleton>>
	tags?: DocumentDecoration['tags']
} & TypedWebSocketHandler<
		Omit<Context<Schema, Singleton>, 'body'> & {
			body: never
		},
		Schema
	>
