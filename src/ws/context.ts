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
import type { WSRouteRuntime } from './runtime'

function pickValidator(
	validators:
		| {
				[status: number]: WSValidatorLike
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
	id?: string
	runtime?: WSRouteRuntime
	fastMessage?: WSRouteRuntime['fastMessage']
	closeHandlerInvoked?: boolean
	view?: ElysiaWS<any>
	retained?: Record<string, unknown>
	resumeWaiters?: Set<() => void>
	generatorPumps?: Set<{
		ws?: ElysiaWS<any>
		iterator?: Iterator<unknown> | AsyncIterator<unknown>
		settled: boolean
		resolve: () => void
		reject: (error: unknown) => void
	}>
	closed?: boolean
	/** Direct ElysiaWS construction compatibility; live routes use runtime.plan. */
	validator?: WSResponseValidator
	defaultValidator?: WSValidatorLike
}

function memoize<T>(view: ElysiaWS<any>, key: string, value: T): T {
	const self = view.raw.data.view ?? view

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
	declare body: Route['body']

	constructor(
		raw: ServerWebSocket<WSConnectionData>,
		retained?: Record<string, unknown>,
		prototype?: object
	) {
		if (prototype) Object.setPrototypeOf(this, prototype)
		this.raw = raw
		if (retained)
			for (const key of Object.keys(retained))
				Object.defineProperty(this, key, {
					value: retained[key],
					enumerable: true,
					writable: true,
					configurable: true
				})
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
		const self = (this.raw.data.view as ElysiaWS<Route>) ?? this
		return memoize(this, 'send', self.#send.bind(self))
	}

	get ping(): (
		data?: FlattenResponse<Route['response']> | BufferSource
	) => ServerWebSocketSendStatus {
		const self = (this.raw.data.view as ElysiaWS<Route>) ?? this
		return memoize(this, 'ping', self.#ping.bind(self))
	}

	get pong(): (
		data?: FlattenResponse<Route['response']> | BufferSource
	) => ServerWebSocketSendStatus {
		const self = (this.raw.data.view as ElysiaWS<Route>) ?? this
		return memoize(this, 'pong', self.#pong.bind(self))
	}

	get publish(): (
		topic: string,
		data: FlattenResponse<Route['response']> | BufferSource,
		compress?: boolean
	) => ServerWebSocketSendStatus {
		const self = (this.raw.data.view as ElysiaWS<Route>) ?? this
		return memoize(this, 'publish', self.#publish.bind(self))
	}

	get close(): (code?: number, reason?: string) => void {
		const self = (this.raw.data.view as ElysiaWS<Route>) ?? this
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

	#prepare(data: unknown, value: unknown): string | null {
		if (data === undefined) return null

		if (data instanceof ElysiaStatus)
			return JSON.stringify({
				status: data.status,
				error: value
			})

		if (typeof value === 'object') return JSON.stringify(value)

		return value as string
	}

	#encodeOrError(data: unknown): { value: unknown } | { error: string } {
		const connectionData = this.raw.data
		const plan = connectionData.runtime?.plan
		const v = pickValidator(
			(plan?.responseValidator ?? connectionData.validator) as any,
			plan?.defaultResponseValidator ?? connectionData.defaultValidator,
			data
		)

		const value = data instanceof ElysiaStatus ? data.response : data
		if (!v) return { value }
		if (!v.EncodeFrom)
			return v.Check(value)
				? { value }
				: {
						error: new ValidationError('message', value, v.Errors(value))
							.message
					}

		try {
			const encoded = v.EncodeFrom(value, 'message')
			if (typeof (encoded as any)?.then === 'function') {
				Promise.resolve(encoded).catch(() => {})

				throw new Error(
					'[Elysia] An asynchronous Standard Schema was used where only synchronous validation is supported.'
				)
			}

			return { value: encoded }
		} catch (error) {
			if (error instanceof ValidationError) return { error: error.message }

			throw error
		}
	}

	#send(
		data: FlattenResponse<Route['response']> | BufferSource,
		compress?: boolean
	): ServerWebSocketSendStatus {
		if (data === undefined) return 0
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
			return this.raw.send(data as unknown as BufferSource, compress)

		const result = this.#encodeOrError(data)

		if ('error' in result) return this.raw.send(result.error)
		if (
			!(data instanceof ElysiaStatus) &&
			(result.value instanceof ArrayBuffer || ArrayBuffer.isView(result.value))
		)
			return this.raw.send(
				result.value as unknown as BufferSource,
				compress
			)

		return this.raw.send(this.#prepare(data, result.value)!, compress)
	}

	#ping(
		data?: FlattenResponse<Route['response']> | BufferSource
	): ServerWebSocketSendStatus {
		if (data === undefined) return this.raw.ping()
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
			return this.raw.ping(data as unknown as BufferSource)

		const result = this.#encodeOrError(data)
		if ('error' in result) return this.raw.send(result.error)
		if (
			!(data instanceof ElysiaStatus) &&
			(result.value instanceof ArrayBuffer || ArrayBuffer.isView(result.value))
		)
			return this.raw.ping(result.value as unknown as BufferSource)

		return this.raw.ping(this.#prepare(data, result.value)!)
	}

	#pong(
		data?: FlattenResponse<Route['response']> | BufferSource
	): ServerWebSocketSendStatus {
		if (data === undefined) return this.raw.pong()
		if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
			return this.raw.pong(data as unknown as BufferSource)

		const result = this.#encodeOrError(data)
		if ('error' in result) return this.raw.send(result.error)
		if (
			!(data instanceof ElysiaStatus) &&
			(result.value instanceof ArrayBuffer || ArrayBuffer.isView(result.value))
		)
			return this.raw.pong(result.value as unknown as BufferSource)

		return this.raw.pong(this.#prepare(data, result.value)!)
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

		const result = this.#encodeOrError(data)
		if ('error' in result) return this.raw.send(result.error)
		if (
			!(data instanceof ElysiaStatus) &&
			(result.value instanceof ArrayBuffer || ArrayBuffer.isView(result.value))
		)
			return this.raw.publish(
				topic,
				result.value as unknown as BufferSource,
				compress
			)

		return this.raw.publish(
			topic,
			this.#prepare(data, result.value)!,
			compress
		)
	}

	#close(code?: number, reason?: string): void {
		const runtime = this.raw.data.runtime
		if (runtime) runtime.close(this, code, reason)
		else this.raw.close(code, reason)
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
