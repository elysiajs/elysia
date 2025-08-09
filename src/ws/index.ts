import { isNumericString } from '../utils'

import type {
	ServerWebSocket,
	ServerWebSocketSendStatus,
	BufferSource,
	WebSocketHandler
} from './bun'

import type { TSchema } from '@sinclair/typebox'
import type { TypeCheck } from '../type-system'
import type { ElysiaTypeCheck } from '../schema'

import type { FlattenResponse, WSParseHandler } from './types'
import type { MaybeArray, Prettify, RouteSchema } from '../types'
import { ValidationError } from '../error'

export const websocket: WebSocketHandler<any> = {
	open(ws) {
		ws.data.open?.(ws)
	},
	message(ws, message) {
		ws.data.message?.(ws, message)
	},
	drain(ws) {
		ws.data.drain?.(ws)
	},
	close(ws, code, reason) {
		ws.data.close?.(ws, code, reason)
	}
}

type ElysiaServerWebSocket = Omit<
	ServerWebSocket<unknown>,
	'send' | 'ping' | 'pong' | 'publish'
>

export class ElysiaWS<Context = unknown, Route extends RouteSchema = {}>
	implements ElysiaServerWebSocket
{
	constructor(
		public raw: ServerWebSocket<{
			id?: string
			validator?: TypeCheck<TSchema>
		}>,
		public data: Prettify<
			Omit<Context, 'body' | 'error' | 'status' | 'redirect'>
		>,
		public body: Route['body'] = undefined
	) {
		this.validator = raw.data?.validator

		this.sendText = raw.sendText.bind(raw)
		this.sendBinary = raw.sendBinary.bind(raw)
		this.close = raw.close.bind(raw)
		this.terminate = raw.terminate.bind(raw)
		this.publishText = raw.publishText.bind(raw)
		this.publishBinary = raw.publishBinary.bind(raw)
		this.subscribe = raw.subscribe.bind(raw)
		this.unsubscribe = raw.unsubscribe.bind(raw)
		this.isSubscribed = raw.isSubscribed.bind(raw)
		this.cork = raw.cork.bind(raw)
		this.remoteAddress = raw.remoteAddress
		this.binaryType = raw.binaryType
		this.data = raw.data as any

		this.send = this.send.bind(this)
		this.ping = this.ping.bind(this)
		this.pong = this.pong.bind(this)
		this.publish = this.publish.bind(this)
	}

	/**
	 * Sends a message to the client.
	 *
	 * @param data The data to send.
	 * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
	 * @example
	 * ws.send("Hello!");
	 * ws.send("Compress this.", true);
	 * ws.send(new Uint8Array([1, 2, 3, 4]));
	 */
	send(
		data: FlattenResponse<Route['response']> | BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus {
		if (Buffer.isBuffer(data))
			return this.raw.send(data as unknown as BufferSource, compress)

		if (this.validator?.Check(data) === false)
			return this.raw.send(
				new ValidationError('message', this.validator, data).message
			)

		if (typeof data === 'object') data = JSON.stringify(data) as any

		return this.raw.send(data as unknown as string, compress)
	}

	/**
	 * Sends a ping.
	 *
	 * @param data The data to send
	 */
	ping(
		data?: FlattenResponse<Route['response']> | BufferSource
	): ServerWebSocketSendStatus {
		if (Buffer.isBuffer(data))
			return this.raw.ping(data as unknown as BufferSource)

		if (this.validator?.Check(data) === false)
			return this.raw.send(
				new ValidationError('message', this.validator, data).message
			)

		if (typeof data === 'object') data = JSON.stringify(data) as any

		return this.raw.ping(data as string)
	}

	/**
	 * Sends a pong.
	 *
	 * @param data The data to send
	 */
	pong(
		data?: FlattenResponse<Route['response']> | BufferSource
	): ServerWebSocketSendStatus {
		if (Buffer.isBuffer(data))
			return this.raw.pong(data as unknown as BufferSource)

		if (this.validator?.Check(data) === false)
			return this.raw.send(
				new ValidationError('message', this.validator, data).message
			)

		if (typeof data === 'object') data = JSON.stringify(data) as any

		return this.raw.pong(data as string)
	}

	/**
	 * Sends a message to subscribers of the topic.
	 *
	 * @param topic The topic name.
	 * @param data The data to send.
	 * @param compress Should the data be compressed? If the client does not support compression, this is ignored.
	 * @example
	 * ws.publish("chat", "Hello!");
	 * ws.publish("chat", "Compress this.", true);
	 * ws.publish("chat", new Uint8Array([1, 2, 3, 4]));
	 */
	publish(
		topic: string,
		data: FlattenResponse<Route['response']> | BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus {
		if (Buffer.isBuffer(data))
			return this.raw.publish(
				topic,
				data as unknown as BufferSource,
				compress
			)

		if (this.validator?.Check(data) === false)
			return this.raw.send(
				new ValidationError('message', this.validator, data).message
			)

		if (typeof data === 'object') data = JSON.stringify(data) as any

		return this.raw.publish(topic, data as unknown as string, compress)
	}

	sendText: ServerWebSocket['sendText']
	sendBinary: ServerWebSocket['sendBinary']
	close: ServerWebSocket['close']
	terminate: ServerWebSocket['terminate']
	publishText: ServerWebSocket['publishText']
	publishBinary: ServerWebSocket['publishBinary']
	subscribe: ServerWebSocket['subscribe']
	unsubscribe: ServerWebSocket['unsubscribe']
	isSubscribed: ServerWebSocket['isSubscribed']
	cork: ServerWebSocket['cork']
	remoteAddress: ServerWebSocket['remoteAddress']
	binaryType: ServerWebSocket['binaryType']

	get readyState() {
		return this.raw.readyState
	}

	validator?: TypeCheck<TSchema>;
	['~types']?: {
		validator: Prettify<Route>
	}

	get id(): string {
		// @ts-ignore
		return this.data.id
	}
}

export const createWSMessageParser = (
	parse: MaybeArray<WSParseHandler<any>>
) => {
	const parsers = typeof parse === 'function' ? [parse] : parse

	return async function parseMessage(ws: ServerWebSocket<any>, message: any) {
		if (typeof message === 'string') {
			const start = message?.charCodeAt(0)

			if (start === 34 || start === 47 || start === 91 || start === 123)
				try {
					message = JSON.parse(message)
				} catch {
					// Not empty
				}
			else if (isNumericString(message)) message = +message
			else if (message === 'true') message = true
			else if (message === 'false') message = false
			else if (message === 'null') message = null
		}

		if (parsers)
			for (let i = 0; i < parsers.length; i++) {
				let temp = parsers[i](ws as any, message)
				if (temp instanceof Promise) temp = await temp

				if (temp !== undefined) return temp
			}

		return message
	}
}

export const createHandleWSResponse = (
	validateResponse: TypeCheck<any> | ElysiaTypeCheck<any> | undefined
) => {
	const handleWSResponse = (
		ws: ServerWebSocket<any>,
		data: unknown
	): unknown => {
		if (data instanceof Promise)
			return data.then((data) => handleWSResponse(ws, data))

		if (Buffer.isBuffer(data)) return ws.send(data.toString())

		if (data === undefined) return

		const send = (datum: unknown) => {
			if (validateResponse?.Check(datum) === false)
				return ws.send(
					new ValidationError('message', validateResponse, datum)
						.message
				)

			if (typeof datum === 'object') return ws.send(JSON.stringify(datum))

			ws.send(datum)
		}

		if (typeof (data as Generator)?.next !== 'function')
			return void send(data)

		const init = (data as Generator | AsyncGenerator).next()

		if (init instanceof Promise)
			return (async () => {
				const first = await init

				if (validateResponse?.Check(first) === false)
					return ws.send(
						new ValidationError('message', validateResponse, first)
							.message
					)

				send(first.value as any)

				if (!first.done)
					for await (const datum of data as Generator) send(datum)
			})()

		send(init.value)

		if (!init.done) for (const datum of data as Generator) send(datum)
	}

	return handleWSResponse
}

export type { WSLocalHook } from './types'
