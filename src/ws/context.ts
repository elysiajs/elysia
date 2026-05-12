import type {
	ServerWebSocket,
	ServerWebSocketSendStatus,
	BufferSource,
	WebSocketReadyState,
	FlattenResponse,
	WSResponseValidator
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
	data: unknown
) {
	if (!validators) return undefined
	if (data instanceof ElysiaStatus) {
		const v = validators[data.status]
		if (v) return v
	}
	return validators[200] ?? validators[Object.keys(validators)[0] as any]
}

export interface WSConnectionData {
	id: string
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
	elysia?: ElysiaWS<any>
	context: Record<string, unknown>

	validator?: WSResponseValidator
}

export class ElysiaWS<Route extends RouteSchema = {}> {
	raw: ServerWebSocket<WSConnectionData>
	body: Route['body'] = undefined as any

	sendText!: ServerWebSocket['sendText']
	sendBinary!: ServerWebSocket['sendBinary']
	terminate!: ServerWebSocket['terminate']
	publishText!: ServerWebSocket['publishText']
	publishBinary!: ServerWebSocket['publishBinary']
	subscribe!: ServerWebSocket['subscribe']
	unsubscribe!: ServerWebSocket['unsubscribe']
	isSubscribed!: ServerWebSocket['isSubscribed']
	cork!: ServerWebSocket['cork']
	remoteAddress!: string
	binaryType?: 'nodebuffer' | 'arraybuffer' | 'uint8array'

	constructor(
		raw: ServerWebSocket<WSConnectionData>,
		context?: Record<string, unknown>
	) {
		this.raw = raw

		if (context)
			for (const key in context) {
				if (key === 'ws' || key === 'body') continue
				;(this as any)[key] = context[key]
			}

		this.sendText = raw.sendText.bind(raw)
		this.sendBinary = raw.sendBinary.bind(raw)
		this.terminate = raw.terminate.bind(raw)
		this.publishText = raw.publishText.bind(raw)
		this.publishBinary = raw.publishBinary.bind(raw)
		this.subscribe = raw.subscribe.bind(raw)
		this.unsubscribe = raw.unsubscribe.bind(raw)
		this.isSubscribed = raw.isSubscribed.bind(raw)
		this.cork = raw.cork.bind(raw) as any
		this.remoteAddress = raw.remoteAddress
		this.binaryType = raw.binaryType

		this.send = this.send.bind(this)
		this.ping = this.ping.bind(this)
		this.pong = this.pong.bind(this)
		this.publish = this.publish.bind(this)
		this.close = this.close.bind(this)
	}

	get ws(): this {
		return this
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

	#prepare(data: unknown): { wire: string; toValidate: unknown } | null {
		if (data === undefined) return null

		if (data instanceof ElysiaStatus)
			return {
				wire: JSON.stringify({
					status: data.status,
					error: data.response
				}),
				toValidate: data.response
			}

		if (typeof data === 'object')
			return { wire: JSON.stringify(data), toValidate: data }

		return { wire: data as string, toValidate: data }
	}

	#validatedOrError(data: unknown): string | undefined {
		const v = pickValidator(this.raw.data?.validator as any, data)
		if (!v) return undefined
		const value = data instanceof ElysiaStatus ? data.response : data
		if (v.Check(value)) return undefined
		return new ValidationError('message', value, v.Errors(value)).message
	}

	send(
		data: FlattenResponse<Route['response']> | BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus {
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
			return this.raw.send(data as unknown as BufferSource, compress)

		const prepared = this.#prepare(data)
		if (!prepared) return 0

		const err = this.#validatedOrError(data)
		if (err !== undefined) return this.raw.send(err)

		return this.raw.send(prepared.wire, compress)
	}

	ping(
		data?: FlattenResponse<Route['response']> | BufferSource
	): ServerWebSocketSendStatus {
		if (data === undefined) return this.raw.ping()
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
			return this.raw.ping(data as unknown as BufferSource)

		const err = this.#validatedOrError(data)
		if (err !== undefined) return this.raw.send(err)

		const prepared = this.#prepare(data)!
		return this.raw.ping(prepared.wire)
	}

	pong(
		data?: FlattenResponse<Route['response']> | BufferSource
	): ServerWebSocketSendStatus {
		if (data === undefined) return this.raw.pong()
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
			return this.raw.pong(data as unknown as BufferSource)

		const err = this.#validatedOrError(data)
		if (err !== undefined) return this.raw.send(err)

		const prepared = this.#prepare(data)!
		return this.raw.pong(prepared.wire)
	}

	publish(
		topic: string,
		data: FlattenResponse<Route['response']> | BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus {
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
			return this.raw.publish(
				topic,
				data as unknown as BufferSource,
				compress
			)

		const prepared = this.#prepare(data)
		if (!prepared) return 0

		const err = this.#validatedOrError(data)
		if (err !== undefined) return this.raw.send(err)

		return this.raw.publish(topic, prepared.wire, compress)
	}

	close(code?: number, reason?: string): void {
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
			} catch {
			}
		}
		this.raw.close(code, reason)
	}
}

export function isGeneratorFunction(fn: unknown): boolean {
	if (typeof fn !== 'function') return false

	const name = (fn as Function).constructor?.name
	return name === 'GeneratorFunction' || name === 'AsyncGeneratorFunction'
}

export function isGeneratorObject(value: unknown): boolean {
	if (value == null || typeof value !== 'object') return false

	const v = value as any
	return (
		typeof v.next === 'function' &&
		(typeof v[Symbol.iterator] === 'function' ||
			typeof v[Symbol.asyncIterator] === 'function')
	)
}
