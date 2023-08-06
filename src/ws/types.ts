import type { ServerWebSocket, WebSocketHandler } from 'bun'
import type { TObject, TSchema } from '@sinclair/typebox'
import type { TypeCheck } from '@sinclair/typebox/compiler'

import type { Context } from '../context'
import type {
	ElysiaInstance,
	UnwrapSchema,
	ExtractPath,
	WithArray,
	NoReturnHandler,
	HookHandler,
	TypedRoute
} from '../types'
import type { ElysiaWS } from '.'

export interface WSTypedSchema<ModelName extends string = string> {
	body?: TSchema | ModelName
	headers?: TObject | ModelName
	query?: TObject | ModelName
	params?: TObject | ModelName
	response?: TSchema | ModelName
}

export type TypedWSSchemaToRoute<
	Schema extends WSTypedSchema = WSTypedSchema,
	Definitions extends ElysiaInstance['meta']['defs'] = {}
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
	Definitions extends ElysiaInstance['meta']['defs'] = {}
> = {
	body: UnwrapSchema<Schema['body'], Definitions, undefined>
	headers: UnwrapSchema<Schema['headers'], Definitions, undefined>
	query: UnwrapSchema<Schema['query'], Definitions, undefined>
	params: UnwrapSchema<Schema['params'], Definitions, undefined>
	response: UnwrapSchema<Schema['response'], Definitions, undefined>
}

export type TransformMessageHandler<Message extends WSTypedSchema['body']> = (
	message: UnwrapSchema<Message>
) => void | UnwrapSchema<Message>

export type ElysiaWSContext<
	Schema extends WSTypedSchema<any> = WSTypedSchema<never>,
	Definitions extends ElysiaInstance['meta']['defs'] = {},
	Path extends string = never
> = ServerWebSocket<
	Context<{
		body: UnwrapSchema<Schema['body'], Definitions>
		headers: UnwrapSchema<Schema['headers'], Definitions, Record<string, string>>
		query: UnwrapSchema<Schema['query'], Definitions, Record<string, string>>
		params: ExtractPath<Path> extends infer Params extends string
			? Record<Params, string>
			: UnwrapSchema<Schema['params'], Definitions, Record<string, string>>
		response: UnwrapSchema<Schema['response'], Definitions>
	}> & {
		id: number
		message: TypeCheck<any>
		transformMessage: TransformMessageHandler<Schema['body']>[]
		schema: TypedRoute
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

export type ElysiaWSOptions<
	Path extends string,
	Schema extends WSTypedSchema<any>,
	Definitions extends ElysiaInstance['meta']['defs']
> = Omit<
	Partial<WebSocketHandler<Context>>,
	'open' | 'message' | 'close' | 'drain' | 'publish' | 'publishToSelf'
> &
	(ElysiaWS<ElysiaWSContext<Schema, Definitions, Path>> extends infer WS
		? Partial<Schema> & {
				beforeHandle?: WithArray<HookHandler<Schema>>
				transform?: WithArray<
					NoReturnHandler<TypedWSSchemaToRoute<Schema>>
				>
				transformMessage?: WithArray<
					TransformMessageHandler<Schema['body']>
				>

				/**
				 * Headers to register to websocket before `upgrade`
				 */
				upgrade?: HeadersInit | WebSocketHeaderHandler<Schema>

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
					message: UnwrapSchema<Schema['body'], Definitions>
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
		: never)
