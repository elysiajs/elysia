import type { ServerWebSocket, WebSocketHandler } from 'bun'

import type { TSchema } from '@sinclair/typebox'
import type { TypeCheck } from '@sinclair/typebox/compiler'

import { ValidationError } from '../error'
import type { Context } from '../context'

import type { SingletonBase, RouteSchema } from '../types'
import { randomInt } from 'crypto'

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
		id?: number
		validator?: TypeCheck<TSchema>
	}>,
	Route extends RouteSchema = RouteSchema,
	Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
		resolve: {}
	}
> {
	get id(): number {
		return this.raw.data.id as number
	}
	set id(newID: number) {
		this.raw.data.id = newID
	}
	validator?: TypeCheck<TSchema>

	constructor(public raw: WS, public data: Context<Route, Singleton>) {
		this.validator = raw.data.validator
		this.id = raw.data.id ?? randomInt(Number.MAX_SAFE_INTEGER)
	}

	get publish() {
		return (
			topic: string,
			data: Route['response'] = undefined,
			compress?: boolean
		) => {
			if (this.validator?.Check(data) === false)
				throw new ValidationError('message', this.validator, data)

			if (typeof data === 'object') data = JSON.stringify(data)

			this.raw.publish(topic, data as unknown as string, compress)

			return this
		}
	}

	get send() {
		return (data: Route['response']) => {
			if (this.validator?.Check(data) === false)
				throw new ValidationError('message', this.validator, data)

			if (Buffer.isBuffer(data)) {
				this.raw.send(data as unknown as Buffer)

				return this
			}

			if (typeof data === 'object') data = JSON.stringify(data)

			this.raw.send(data as unknown as string)

			return this
		}
	}

	get subscribe() {
		return (room: string) => {
			this.raw.subscribe(room)

			return this
		}
	}

	get unsubscribe() {
		return (room: string) => {
			this.raw.unsubscribe(room)

			return this
		}
	}

	get cork() {
		return (callback: () => this) => {
			this.raw.cork(callback as any)

			return this
		}
	}

	get close() {
		return () => {
			this.raw.close()

			return this
		}
	}

	get terminate() {
		return this.raw.terminate.bind(this.raw)
	}

	get isSubscribed() {
		return this.raw.isSubscribed.bind(this.raw)
	}

	get remoteAddress() {
		return this.raw.remoteAddress
	}
}
