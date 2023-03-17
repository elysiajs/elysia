import type { ServerWebSocket, WebSocketHandler } from 'bun'
import type { TypeCheck } from '@sinclair/typebox/compiler'

import type { ElysiaWS } from '.'
import type { Context } from '../context'
import type { DEFS } from '../utils'
import type {
	ElysiaInstance,
	UnwrapSchema,
	TypedSchema,
	ExtractPath,
	WithArray,
	NoReturnHandler,
	HookHandler
} from '../types'

export type WSTypedSchema<ModelName extends string = string> = Omit<
	TypedSchema<ModelName>,
	'response'
> & {
	response?: TypedSchema<ModelName>['body']
}

export type TypedWSSchemaToRoute<
	Schema extends WSTypedSchema = WSTypedSchema,
	Definitions extends ElysiaInstance['meta'][typeof DEFS] = {}
> = {
	body: UnwrapSchema<Schema['body'], Definitions>
	headers: UnwrapSchema<
		Schema['headers'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	query: UnwrapSchema<
		Schema['query'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	params: UnwrapSchema<
		Schema['params'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	response: UnwrapSchema<
		Schema['params'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
}

export type WebSocketSchemaToRoute<
	Schema extends WSTypedSchema,
	Definitions extends ElysiaInstance['meta'][typeof DEFS] = {}
> = {
	body: UnwrapSchema<
		Schema['body'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	headers: UnwrapSchema<
		Schema['headers'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	query: UnwrapSchema<
		Schema['query'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	params: UnwrapSchema<
		Schema['params'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
	response: UnwrapSchema<
		Schema['response'],
		Definitions
	> extends infer Result extends Record<string, any>
		? Result
		: undefined
}

export type TransformMessageHandler<Message extends WSTypedSchema['body']> = (
	message: UnwrapSchema<Message>
) => void | UnwrapSchema<Message>

export type ElysiaWSContext<
	Schema extends WSTypedSchema = WSTypedSchema,
	Path extends string = string
> = ServerWebSocket<
	Context<
		ExtractPath<Path> extends never
			? WebSocketSchemaToRoute<Schema>
			: Omit<WebSocketSchemaToRoute<Schema>, 'params'> & {
					params: Record<ExtractPath<Path>, string>
			  }
	> & {
		id: string
		message: TypeCheck<any>
		transformMessage: TransformMessageHandler<Schema['body']>[]
	}
>

export type WebSocketHeaderHandler<
	Schema extends WSTypedSchema = WSTypedSchema,
	Path extends string = string
> = (
	context: TypedWSSchemaToRoute<Schema>['params'] extends {}
		? Omit<TypedWSSchemaToRoute<Schema>, 'response'> & {
				response: void | TypedWSSchemaToRoute<Schema>['response']
		  }
		: Omit<
				Omit<TypedWSSchemaToRoute<Schema>, 'response'> & {
					response: void | TypedWSSchemaToRoute<Schema>['response']
				},
				'params'
		  > & {
				params: Record<ExtractPath<Path>, string>
		  }
) => HeadersInit

type PartialWebSocketHandler = Omit<
	Partial<WebSocketHandler<Context>>,
	'open' | 'message' | 'close' | 'drain' | 'publish' | 'publishToSelf'
>

export type ElysiaWSOptions<
	Path extends string = '',
	Schema extends WSTypedSchema = {},
	Definitions extends ElysiaInstance['meta'][typeof DEFS] = {}
> = PartialWebSocketHandler &
	ElysiaWS<
		ElysiaWSContext<Schema, Path>,
		Schema,
		Definitions
	> extends infer WS
	? {
			schema?: Schema
			beforeHandle?: WithArray<HookHandler<Schema>>
			transform?: WithArray<NoReturnHandler<TypedWSSchemaToRoute<Schema>>>
			transformMessage?: WithArray<
				TransformMessageHandler<Schema['body']>
			>

			/**
			 * Headers to register to websocket before `upgrade`
			 */
			headers?: HeadersInit | WebSocketHeaderHandler<Schema>

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
			message?: (
				ws: WS,
				message: UnwrapSchema<Schema['body'], Definitions>,
			) => any

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
	: never
