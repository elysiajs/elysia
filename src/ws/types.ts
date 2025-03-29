import type { ElysiaWS } from './index'
import { WebSocketHandler } from './bun'

import type { Context } from '../context'
import {
	AfterResponseHandler,
	BaseMacro,
	DocumentDecoration,
	ErrorHandler,
	InputSchema,
	MapResponse,
	MaybeArray,
	MaybePromise,
	OptionalHandler,
	Prettify,
	RouteSchema,
	SingletonBase,
	TransformHandler
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

type TypedWebSocketHandler<Context, Route extends RouteSchema = {}> = Prettify<
	Omit<WebSocketHandler<Context>, TypedWebSocketMethod> & {
		open?(
			ws: ElysiaWS<Context, Omit<Route, 'body'> & { body: never }>
		): MaybePromise<FlattenResponse<Route['response']> | void>
		message?(
			ws: ElysiaWS<Context, Route>,
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
			ws: ElysiaWS<Context, Omit<Route, 'body'> & { body: never }>
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
			ws: ElysiaWS<Context, Omit<Route, 'body'> & { body: never }>,
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
>

export type WSParseHandler<Route extends RouteSchema, Context = {}> = (
	ws: ElysiaWS<Context, Omit<Route, 'body'> & { body: unknown }>,
	message: unknown
) => MaybePromise<Route['body'] | void | undefined>

export type AnyWSLocalHook = WSLocalHook<any, any, any, any>

type WSLocalHookKey =
	| keyof TypedWebSocketHandler<any, any>
	| 'detail'
	| 'upgrade'
	| 'parse'
	| 'transform'
	| 'beforeHandle'
	| 'afterHandle'
	| 'mapResponse'
	| 'afterResponse'
	| 'error'
	| 'tags'
	| keyof InputSchema<any>

export type WSLocalHook<
	LocalSchema extends InputSchema,
	Schema extends RouteSchema,
	Singleton extends SingletonBase,
	Macro extends BaseMacro
> = (LocalSchema extends any ? LocalSchema : Prettify<LocalSchema>) &
	Macro & {
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
