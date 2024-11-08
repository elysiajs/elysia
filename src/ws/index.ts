import { randomId } from '../utils'

import type {
	ServerWebSocket,
	ServerWebSocketSendStatus,
	BufferSource,
	WebSocketHandler
} from './bun'

import type { TSchema } from '@sinclair/typebox'
import type { TypeCheck } from '../type-system'

import type { Prettify, RouteSchema } from '../types'
import { ValidationError } from '../error'
import { FlattenResponse } from './types'

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

export class ElysiaWebSocket<Context = unknown, Route extends RouteSchema = {}>
	implements ElysiaServerWebSocket
{
	validator?: TypeCheck<TSchema>;
	['~types']?: {
		validator: Prettify<Route>
	}

	id: string

	constructor(
		public raw: ServerWebSocket<{
			id?: string
			validator?: TypeCheck<TSchema>
		}>,
		public data: Context,
		public body: Route['body'] = undefined
	) {
		this.validator = raw.data?.validator

		if (raw.data.id) this.id = raw.data.id
		else this.id = randomId().toString()

		this.sendText = raw.sendText.bind(this)
		this.sendBinary = raw.sendBinary.bind(this)
		this.close = raw.close.bind(this)
		this.terminate = raw.terminate.bind(this)
		this.publishText = raw.publishText.bind(this)
		this.publishBinary = raw.publishBinary.bind(this)
		this.subscribe = raw.subscribe.bind(this)
		this.unsubscribe = raw.unsubscribe.bind(this)
		this.isSubscribed = raw.isSubscribed.bind(this)
		this.cork = raw.cork.bind(this)
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
			throw new ValidationError('message', this.validator, data)

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
			throw new ValidationError('message', this.validator, data)

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
			throw new ValidationError('message', this.validator, data)

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
			throw new ValidationError('message', this.validator, data)

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
}
