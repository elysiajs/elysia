import type { ServerWebSocket, WebSocketHandler } from 'bun'

import type { TSchema } from '@sinclair/typebox'
import type { TypeCheck } from '@sinclair/typebox/compiler'

import { ValidationError } from '../error'
import type { Context } from '../context'

import type { SingletonBase, RouteSchema, Prettify } from '../types'
import { randomId } from '../utils'

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
		id?: string
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
	validator?: TypeCheck<TSchema>
	_validator?: Prettify<Route>

	constructor(
		public raw: WS,
		public data: Context<Route, Singleton>
	) {
		this.validator = raw.data.validator
		if (raw.data.id) {
			this.id = raw.data.id
		} else {
			this.id = randomId().toString()
		}
	}

	get id() {
		return this.raw.data.id!
	}

	set id(newID: string) {
		this.raw.data.id = newID
	}

	get publish() {
		return (
			topic: string,
			data: {} extends Route['response']
				? unknown
				: Route['response'] extends Record<200, unknown>
					? Route['response'][200]
					: unknown = undefined,
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
		return (
			data: {} extends Route['response']
				? unknown
				: Route['response'] extends Record<200, unknown>
					? Route['response'][200]
					: unknown
		) => {
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
