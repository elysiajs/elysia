import type { ServerWebSocket, WebSocketHandler } from 'bun'

import type { TSchema } from '@sinclair/typebox'
import type { TypeCheck } from '@sinclair/typebox/compiler'

import type { ElysiaWS } from '.'
import type { Context } from '../context'

import type {
	SingletonBase,
	Handler,
	VoidHandler,
	ErrorHandler,
	InputSchema,
	RouteSchema,
	Isolate,
	GetPathParameter,
	MaybeArray,
	BaseMacro
} from '../types'

export namespace WS {
	export type Config = Omit<
		WebSocketHandler,
		'open' | 'message' | 'close' | 'drain'
	>

	export type LocalHook<
		LocalSchema extends InputSchema,
		Route extends RouteSchema,
		Singleton extends SingletonBase,
		Errors extends Record<string, Error>,
		Extension extends BaseMacro,
		Path extends string = '',
		TypedRoute extends RouteSchema = keyof Route['params'] extends never
			? Route & {
					params: Record<GetPathParameter<Path>, string>
			  }
			: Route
	> = (LocalSchema extends {} ? LocalSchema : Isolate<LocalSchema>) &
		Extension &
		Omit<
			Partial<WebSocketHandler<Context>>,
			'open' | 'message' | 'close' | 'drain' | 'publish' | 'publishToSelf'
		> &
		(ElysiaWS<
			ServerWebSocket<{
				validator?: TypeCheck<TSchema>
			}>,
			TypedRoute,
			Singleton
		> extends infer WS
			? {
					transform?: MaybeArray<VoidHandler<TypedRoute, Singleton>>
					transformMessage?: MaybeArray<
						VoidHandler<TypedRoute, Singleton>
					>
					beforeHandle?: MaybeArray<Handler<TypedRoute, Singleton>>
					/**
					 * Catch error
					 */
					error?: MaybeArray<ErrorHandler<Errors>>

					/**
					 * Headers to register to websocket before `upgrade`
					 */
					upgrade?:
						| Bun.HeadersInit
						| ((context: Context) => Bun.HeadersInit)

					/**
					 * The {@link ServerWebSocket} has been opened
					 *
					 * @param ws The {@link ServerWebSocket} that was opened
					 */
					open?: (ws: WS) => void | Promise<void>

					/**
					 * Handle an incoming message to a {@link ServerWebSocket}
					 *
					 * @param ws The {@link ServerWebSocket} that received the message
					 * @param message The message received
					 *
					 * To change `message` to be an `ArrayBuffer` instead of a `Uint8Array`, set `ws.binaryType = "arraybuffer"`
					 */
					message?: (ws: WS, message: Route['body']) => any

					/**
					 * The {@link ServerWebSocket} is being closed
					 * @param ws The {@link ServerWebSocket} that was closed
					 * @param code The close code
					 * @param message The close message
					 */
					close?: (
						ws: WS,
						code: number,
						message: string
					) => void | Promise<void>

					/**
					 * The {@link ServerWebSocket} is ready for more data
					 *
					 * @param ws The {@link ServerWebSocket} that is ready
					 */
					drain?: (ws: WS) => void | Promise<void>
			  }
			: {})
}
