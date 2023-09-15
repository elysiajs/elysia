import type { ServerWebSocket, WebSocketHandler } from 'bun'

import type { TSchema } from '@sinclair/typebox'
import type { TypeCheck } from '@sinclair/typebox/compiler'

import { ValidationError } from '../error'
import type { Context } from '../context'

import type { RouteSchema } from '../types'

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

export class ElysiaWS<
	WS extends ServerWebSocket<{
		validator?: TypeCheck<TSchema>
	}>,
	Route extends RouteSchema = RouteSchema
> {
	validator?: TypeCheck<TSchema>

	constructor(public raw: WS, public data: Context<Route>) {
		this.validator = raw.data.validator
	}

	publish(
		topic: string,
		data: Route['response'] = undefined,
		compress?: boolean
	) {
		if (this.validator?.Check(data) === false)
			throw new ValidationError('message', this.validator, data)

		if (typeof data === 'object') data = JSON.stringify(data)

		this.raw.publish(topic, data as unknown as string, compress)

		return this
	}

	send(data: Route['response']) {
		if (this.validator?.Check(data) === false)
			throw new ValidationError('message', this.validator, data)

		if (typeof data === 'object') data = JSON.stringify(data)

		this.raw.send(data as unknown as string)

		return this
	}

	subscribe(room: string) {
		this.raw.subscribe(room)

		return this
	}

	unsubscribe(room: string) {
		this.raw.unsubscribe(room)

		return this
	}

	cork(callback: (ws: WS) => this) {
		this.raw.cork(callback as any)

		return this
	}

	close() {
		this.raw.close()

		return this
	}

	terminate() {
		this.raw.terminate()
	}

	isSubscribed(room: string) {
		// get isSubscribed() { return this.raw.isSubscribed } -> Expected 'this' to be instanceof ServerWebSocket
		return this.raw.isSubscribed(room)
	}

	get remoteAddress() {
		return this.raw.remoteAddress
	}
}
