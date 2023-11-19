import type { ServerWebSocket, WebSocketHandler } from 'bun'

import type { TSchema } from '@sinclair/typebox'
import type { TypeCheck } from '@sinclair/typebox/compiler'

import type { ElysiaWS } from '.'
import type { Context } from '../context'

import type {
	DecoratorBase,
	Handler,
	VoidHandler,
	ErrorHandler,
	InputSchema,
	RouteSchema,
	Isolate,
	GetPathParameter,
	MaybeArray
} from '../types'

export namespace WS {
	export type Config = Omit<
		WebSocketHandler,
		'open' | 'message' | 'close' | 'drain'
	>

	export type LocalHook<
		LocalSchema extends InputSchema = {},
		Route extends RouteSchema = RouteSchema,
		Decorators extends DecoratorBase = {
			request: {}
			store: {}
		},
		Errors extends Record<string, Error> = {},
		Path extends string = '',
		TypedRoute extends RouteSchema = keyof Route['params'] extends never
			? Route & { 
				params: Record<GetPathParameter<Path>, string>
			}
			: Route
	> = (LocalSchema extends {} ? LocalSchema : Isolate<LocalSchema>) &
		Omit<
			Partial<WebSocketHandler<Context>>,
			'open' | 'message' | 'close' | 'drain' | 'publish' | 'publishToSelf'
		> &
		(ElysiaWS<
			ServerWebSocket<{
				validator?: TypeCheck<TSchema>
			}>,
			TypedRoute,
			Decorators
		> extends infer WS
			? {
					transform?: MaybeArray<VoidHandler<TypedRoute, Decorators>>
					transformMessage?: MaybeArray<
						VoidHandler<TypedRoute, Decorators>
					>
					beforeHandle?: MaybeArray<Handler<TypedRoute, Decorators>>
					/**
					 * Catch error
					 */
					error?: MaybeArray<ErrorHandler<Errors>>

					/**
					 * Headers to register to websocket before `upgrade`
					 */
					upgrade?: HeadersInit | ((context: Context) => HeadersInit)

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
