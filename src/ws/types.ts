import type { ElysiaWS } from './index'
import { WebSocketHandler } from './bun'

import type { Context } from '../context'
import {
	AfterHandler,
	AfterResponseHandler,
	BaseMacro,
	ContentType,
	DocumentDecoration,
	ErrorHandler,
	InputSchema,
	Isolate,
	MapResponse,
	MaybeArray,
	MaybePromise,
	OptionalHandler,
	Prettify,
	ResolveHandler,
	ResolvePath,
	ResolveResolutions,
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

export type WSLocalHook<
	LocalSchema extends InputSchema,
	Schema extends RouteSchema,
	Singleton extends SingletonBase,
	Extension extends BaseMacro,
	Resolutions extends MaybeArray<ResolveHandler<Schema, Singleton>>,
	Path extends string = '',
	TypedRoute extends RouteSchema = Prettify<
		Schema extends {
			params: Record<string, unknown>
		}
			? Schema
			: Schema & {
					params: undefined extends Schema['params']
						? ResolvePath<Path>
						: Schema['params']
				}
	>
> = (LocalSchema extends {} ? LocalSchema : Isolate<LocalSchema>) &
	Extension & {
		/**
		 * Short for 'Content-Type'
		 *
		 * Available:
		 * - 'none': do not parse body
		 * - 'text' / 'text/plain': parse body as string
		 * - 'json' / 'application/json': parse body as json
		 * - 'formdata' / 'multipart/form-data': parse body as form-data
		 * - 'urlencoded' / 'application/x-www-form-urlencoded: parse body as urlencoded
		 * - 'arraybuffer': parse body as readable stream
		 */
		type?: ContentType
		detail?: DocumentDecoration
		/**
		 * Headers to register to websocket before `upgrade`
		 */
		upgrade?: Record<string, unknown> | ((context: Context) => unknown)
		parse?: MaybeArray<WSParseHandler<TypedRoute>>

		/**
		 * Transform context's value
		 */
		transform?: MaybeArray<
			TransformHandler<
				TypedRoute,
				{
					decorator: Singleton['decorator']
					store: Singleton['decorator']
					derive: Singleton['derive']
					resolve: {}
				}
			>
		>
		resolve?: Resolutions
		/**
		 * Execute before main handler
		 */
		beforeHandle?: MaybeArray<
			OptionalHandler<
				TypedRoute,
				{
					decorator: Singleton['decorator']
					store: Singleton['decorator']
					derive: Singleton['derive']
					resolve: Singleton['resolve'] &
						ResolveResolutions<Resolutions>
				}
			>
		>
		/**
		 * Execute after main handler
		 */
		afterHandle?: MaybeArray<
			AfterHandler<
				TypedRoute,
				{
					decorator: Singleton['decorator']
					store: Singleton['decorator']
					derive: Singleton['derive']
					resolve: Singleton['resolve'] &
						ResolveResolutions<Resolutions>
				}
			>
		>
		/**
		 * Execute after main handler
		 */
		mapResponse?: MaybeArray<
			MapResponse<
				TypedRoute,
				{
					decorator: Singleton['decorator']
					store: Singleton['decorator']
					derive: Singleton['derive']
					resolve: Singleton['resolve'] &
						ResolveResolutions<Resolutions>
				}
			>
		>
		/**
		 * Execute after response is sent
		 */
		afterResponse?: MaybeArray<
			AfterResponseHandler<
				TypedRoute,
				{
					decorator: Singleton['decorator']
					store: Singleton['decorator']
					derive: Singleton['derive']
					resolve: Singleton['resolve'] &
						ResolveResolutions<Resolutions>
				}
			>
		>
		/**
		 * Catch error
		 */
		error?: MaybeArray<ErrorHandler<{}, TypedRoute, Singleton>>
		tags?: DocumentDecoration['tags']
	} & TypedWebSocketHandler<
		Omit<
			Context<
				TypedRoute,
				Singleton & {
					resolve: ResolveResolutions<Resolutions>
				}
			>,
			'body'
		> & {
			body: never
		},
		TypedRoute
	>
