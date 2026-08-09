import type {
	ServerWebSocket,
	ServerWebSocketSendStatus,
	BufferSource,
	WebSocketReadyState,
	FlattenResponse,
	WSResponseValidator,
	WSValidatorLike
} from './types'

import { ValidationError, ElysiaStatus } from '../error'
import type { RouteSchema } from '../types'
import { requestId } from '../utils'

function pickValidator(
	validators:
		| {
				[status: number]: {
					Check(v: unknown): boolean
					Errors(v: unknown): any[]
				}
		  }
		| undefined,
	defaultValidator: WSValidatorLike | undefined,
	data: unknown
) {
	if (!validators) return
	if (data instanceof ElysiaStatus) return validators[data.status]

	return defaultValidator
}

export interface WSConnectionData {
	id: string | undefined
	open?: (elysia: ElysiaWS<any>) => void | Promise<void>
	message?: (
		elysia: ElysiaWS<any>,
		rawMessage: string | Buffer
	) => void | Promise<void>
	drain?: (elysia: ElysiaWS<any>) => void | Promise<void>
	close?: (
		elysia: ElysiaWS<any>,
		code: number,
		reason: string
	) => void | Promise<void>
	ping?: (elysia: ElysiaWS<any>, data: Buffer) => void | Promise<void>
	pong?: (elysia: ElysiaWS<any>, data: Buffer) => void | Promise<void>

	closeHandlerInvoked?: boolean
	/** in-flight `message` handlers, bounded by `MAX_INFLIGHT_MESSAGES` */
	inflight?: number
	/** settles when an async `open` hook finished; dispatch chains onto it */
	opening?: Promise<void>
	elysia?: ElysiaWS<any>
	context?: Record<string, unknown>

	resumeWaiters?: Set<() => void>

	validator?: WSResponseValidator
	defaultValidator?: WSValidatorLike
}

function memoize<T>(view: ElysiaWS<any>, key: string, value: T): T {
	const self = view.raw.data.elysia ?? view

	Object.defineProperty(self, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true
	})

	return value
}

export class ElysiaWS<Route extends RouteSchema = {}> {
	raw: ServerWebSocket<WSConnectionData>
	body: Route['body'] = undefined as any

	constructor(
		raw: ServerWebSocket<WSConnectionData>,
		context?: Record<string, unknown>
	) {
		this.raw = raw

		if (context)
			for (const key in context) {
				if (key === 'ws' || key === 'body') continue

				if (key === '__proto__') {
					Object.defineProperty(this, key, {
						value: context[key],
						writable: true,
						enumerable: true,
						configurable: true
					})
					continue
				}

				;(this as any)[key] = context[key]
			}
	}

	get ws(): this {
		return this
	}

	// Raw-passthrough memoizing getters: installed on the prototype by the
	// rawPassthroughKeys loop below the class body.
	declare readonly sendText: ServerWebSocket['sendText']
	declare readonly sendBinary: ServerWebSocket['sendBinary']
	declare readonly terminate: ServerWebSocket['terminate']
	declare readonly publishText: ServerWebSocket['publishText']
	declare readonly publishBinary: ServerWebSocket['publishBinary']
	declare readonly subscribe: ServerWebSocket['subscribe']
	declare readonly unsubscribe: ServerWebSocket['unsubscribe']
	declare readonly isSubscribed: ServerWebSocket['isSubscribed']
	declare readonly cork: ServerWebSocket['cork']
	declare readonly remoteAddress: string
	declare readonly binaryType:
		| 'nodebuffer'
		| 'arraybuffer'
		| 'uint8array'
		| undefined

	get send(): (
		data: FlattenResponse<Route['response']> | BufferSource,
		compress?: boolean
	) => ServerWebSocketSendStatus {
		const self = (this.raw.data.elysia as ElysiaWS<Route>) ?? this
		return memoize(this, 'send', self.#send.bind(self))
	}

	get ping(): (
		data?: FlattenResponse<Route['response']> | BufferSource
	) => ServerWebSocketSendStatus {
		const self = (this.raw.data.elysia as ElysiaWS<Route>) ?? this
		return memoize(this, 'ping', self.#ping.bind(self))
	}

	get pong(): (
		data?: FlattenResponse<Route['response']> | BufferSource
	) => ServerWebSocketSendStatus {
		const self = (this.raw.data.elysia as ElysiaWS<Route>) ?? this
		return memoize(this, 'pong', self.#pong.bind(self))
	}

	get publish(): (
		topic: string,
		data: FlattenResponse<Route['response']> | BufferSource,
		compress?: boolean
	) => ServerWebSocketSendStatus {
		const self = (this.raw.data.elysia as ElysiaWS<Route>) ?? this
		return memoize(this, 'publish', self.#publish.bind(self))
	}

	get close(): (code?: number, reason?: string) => void {
		const self = (this.raw.data.elysia as ElysiaWS<Route>) ?? this
		return memoize(this, 'close', self.#close.bind(self))
	}

	get id(): string {
		return (this.raw.data.id ??= requestId())
	}

	get readyState(): WebSocketReadyState {
		return this.raw.readyState
	}

	get subscriptions(): string[] {
		return this.raw.subscriptions
	}

	get data(): WSConnectionData {
		return this.raw.data
	}

	/**
	 * Validate, redact and serialize an outbound value, or return the
	 * `ValidationError` the payload was refused with.
	 */
	#frame(data: unknown) {
		const connectionData = this.raw.data
		const v = pickValidator(
			connectionData?.validator as any,
			connectionData?.defaultValidator,
			data
		)

		const status = data instanceof ElysiaStatus ? data : undefined
		let value = status ? status.response : data

		if (v) {
			const encode = (v as any).EncodeFrom
			let redacted: unknown

			if (
				typeof encode === 'function' &&
				!(v as any).hasCodec &&
				!(v as any).mayReturnPromise
			)
				try {
					redacted = encode.call(v, value, 'message')
				} catch {}

			if (redacted !== undefined) value = redacted
			else if (!v.Check(value))
				return new ValidationError('message', value, v.Errors(value))
		}

		if (status)
			return JSON.stringify({
				status: status.status,
				error: value
			})

		if (value === undefined) return null
		if (typeof value === 'object') return JSON.stringify(value)

		return value as string
	}

	#send(
		data: FlattenResponse<Route['response']> | BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus {
		if (data === undefined) return 0
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
			return this.raw.send(data as unknown as BufferSource, compress)

		const frame = this.#frame(data)
		if (frame instanceof ValidationError)
			return this.raw.send(frame.message)

		return this.raw.send(frame!, compress)
	}

	#ping(
		data?: FlattenResponse<Route['response']> | BufferSource
	): ServerWebSocketSendStatus {
		if (data === undefined) return this.raw.ping()
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
			return this.raw.ping(data as unknown as BufferSource)

		const frame = this.#frame(data)
		if (frame instanceof ValidationError)
			return this.raw.send(frame.message)

		return this.raw.ping(frame!)
	}

	#pong(
		data?: FlattenResponse<Route['response']> | BufferSource
	): ServerWebSocketSendStatus {
		if (data === undefined) return this.raw.pong()
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
			return this.raw.pong(data as unknown as BufferSource)

		const frame = this.#frame(data)
		if (frame instanceof ValidationError)
			return this.raw.send(frame.message)

		return this.raw.pong(frame!)
	}

	#publish(
		topic: string,
		data: FlattenResponse<Route['response']> | BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus {
		if (data === undefined) return 0
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
			return this.raw.publish(
				topic,
				data as unknown as BufferSource,
				compress
			)

		// validate before stringifying (matches #ping/#pong)
		const frame = this.#frame(data)
		if (frame instanceof ValidationError)
			return this.raw.send(frame.message)

		return this.raw.publish(topic, frame!, compress)
	}

	#close(code?: number, reason?: string): void {
		const data = this.raw.data
		if (!data.closeHandlerInvoked && data.close) {
			data.closeHandlerInvoked = true
			try {
				const result = data.close(this, code ?? 1000, reason ?? '')
				if (result instanceof Promise)
					result
						.then(() => this.raw.close(code, reason))
						.catch(() => this.raw.close(code, reason))

				return
			} catch {}
		}
		this.raw.close(code, reason)
	}
}

const rawPassthroughKeys = [
	'sendText',
	'sendBinary',
	'terminate',
	'publishText',
	'publishBinary',
	'subscribe',
	'unsubscribe',
	'isSubscribed',
	'cork',
	'remoteAddress',
	'binaryType'
] as const

for (const key of rawPassthroughKeys)
	Object.defineProperty(ElysiaWS.prototype, key, {
		// Match the class-getter descriptor the loop replaces.
		configurable: true,
		enumerable: false,
		get(this: ElysiaWS<any>) {
			const raw = this.raw
			const value = (raw as any)[key]

			return memoize(
				this,
				key,
				typeof value === 'function' ? value.bind(raw) : value
			)
		}
	})

export function isGeneratorObject(value: unknown): boolean {
	if (value == null || typeof value !== 'object') return false

	const v = value as any
	return (
		typeof v.next === 'function' &&
		(typeof v[Symbol.iterator] === 'function' ||
			typeof v[Symbol.asyncIterator] === 'function')
	)
}
