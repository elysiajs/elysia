import type { Context } from './context'
import type { Prettify, RouteSchema, SingletonBase } from './types'

export type TraceEvent =
	| 'request'
	| 'parse'
	| 'transform'
	| 'beforeHandle'
	| 'handle'
	| 'afterHandle'
	| 'mapResponse'
	| 'afterResponse'
	| 'error'

export interface TraceStream {
	id: number
	event: TraceEvent
	begin: number
	name?: string
	total?: number
}

interface TraceEndDetail {
	/**
	 * Timestamp of a function after it's executed since the server start
	 */
	end: TraceProcess<'end'>
	/**
	 * Error that was thrown in the lifecycle
	 */
	error: Error | null
	/**
	 * Elapsed time of the lifecycle
	 */
	elapsed: number
}

export type TraceProcess<
	Type extends 'begin' | 'end' = 'begin' | 'end',
	WithChildren extends boolean = true
> = Type extends 'begin'
	? Prettify<
			{
				/**
				 * Function name
				 */
				name: string
				/**
				 * Timestamp of a function is called since the server start
				 */
				begin: number
				/**
				 * Timestamp of a function after it's executed since the server start
				 */
				end: Promise<number>
				/**
				 * Error that was thrown in the lifecycle
				 */
				error: Promise<Error | null>
				/**
				 * Listener to intercept the end of the lifecycle
				 *
				 * If you want to mutate the context, you must do it in this function
				 * as there's a lock mechanism to ensure the context is mutate successfully
				 */
				onStop(
					/**
					 * A callback function that will be called when the function ends
					 *
					 * If you want to mutate the context, you must do it in this function
					 * as there's a lock mechanism to ensure the context is mutate successfully
					 */
					callback?: (detail: TraceEndDetail) => unknown
				): Promise<void>
			} & (WithChildren extends true
				? {
						/**
						 * total number of lifecycle's children and
						 * total number of `onEvent` will be called
						 * if there were no early exists or error thrown
						 */
						total: number
						/**
						 * Listener to intercept each child lifecycle
						 */
						onEvent(
							/**
							 * Callback function that will be called for when each child start
							 */
							callback?: (
								process: TraceProcess<'begin', false>
							) => unknown
						): Promise<void>
					}
				: {
						/**
						 * Index of the child event
						 */
						index: number
					})
		>
	: number

export type TraceListener = (
	callback?: (process: TraceProcess<'begin'>) => unknown
) => Promise<TraceProcess<'begin'>>

export type TraceHandler<
	in out Route extends RouteSchema = {},
	in out Singleton extends SingletonBase = {
		decorator: {}
		store: {}
		derive: {}
	}
> = {
	(
		lifecycle: Prettify<
			{
				/**
				 * Per-request id. Sourced from `crypto.randomUUIDv7()` when
				 * the runtime supports it (Bun ≥ 1.1.40), otherwise
				 * `crypto.randomUUID()`. Useful for log correlation.
				 */
				id: string
				context: Context<Route, Singleton>
				set: Context['set']
				time: number
				store: Singleton['store']
				response: unknown
			} & {
				[x in `on${Capitalize<TraceEvent>}`]: TraceListener
			}
		>
	): unknown
}

const createProcess = () => {
	const { promise, resolve } = Promise.withResolvers<TraceProcess>()
	const { promise: end, resolve: resolveEnd } =
		Promise.withResolvers<number>()
	const { promise: error, resolve: resolveError } =
		Promise.withResolvers<Error | null>()

	const callbacks = <Function[]>[]
	const callbacksEnd = <Function[]>[]

	return [
		(callback?: Function) => {
			if (callback) callbacks.push(callback)

			return promise
		},
		(process: TraceStream) => {
			const processes = <((callback?: Function) => Promise<void>)[]>[]
			const resolvers = <((process: TraceStream) => () => void)[]>[]

			// When error is return but not thrown
			let groupError: Error | null = null

			for (let i = 0; i < (process.total ?? 0); i++) {
				const { promise, resolve } = Promise.withResolvers<void>()
				const { promise: end, resolve: resolveEnd } =
					Promise.withResolvers<number>()
				const { promise: error, resolve: resolveError } =
					Promise.withResolvers<Error | null>()

				const callbacks = <Function[]>[]
				const callbacksEnd = <Function[]>[]

				processes.push((callback?: Function) => {
					if (callback) callbacks.push(callback)

					return promise
				})

				resolvers.push((process: TraceStream) => {
					const result = {
						...process,
						end,
						error,
						index: i,
						onStop(callback?: Function) {
							if (callback) callbacksEnd.push(callback)

							return end
						}
					} as any

					resolve(result)
					for (let i = 0; i < callbacks.length; i++)
						callbacks[i](result)

					let childResolved = false
					return (error: Error | null = null) => {
						if (childResolved) return
						childResolved = true

						const end = performance.now()

						// Catch return error
						if (error) groupError = error

						const detail = {
							end,
							error,
							// eslint-disable-next-line sonarjs/no-nested-functions -- single inline getter
							get elapsed() {
								return end - process.begin
							}
						}

						for (let i = 0; i < callbacksEnd.length; i++)
							callbacksEnd[i](detail)

						resolveEnd(end)
						resolveError(error)
					}
				})
			}

			const result = {
				...process,
				end,
				error,
				onEvent(callback?: Function) {
					for (let i = 0; i < processes.length; i++)
						processes[i](callback)
				},
				onStop(callback?: Function) {
					if (callback) callbacksEnd.push(callback)

					return end
				}
			} as any

			resolve(result)
			for (let i = 0; i < callbacks.length; i++) callbacks[i](result)

			let parentResolved = false
			return {
				resolveChild: resolvers,
				resolve(error: Error | null = null) {
					if (parentResolved) return
					parentResolved = true

					const end = performance.now()

					if (!error && groupError) error = groupError

					const detail = {
						end,
						error,
						get elapsed() {
							return end - process.begin
						}
					}

					for (let i = 0; i < callbacksEnd.length; i++)
						callbacksEnd[i](detail)

					resolveEnd(end)
					resolveError(error)
				}
			}
		}
	] as const
}

type LiveProcess = ReturnType<typeof createProcess>

class TraceRecorder {
	begun?: TraceStream
	remaining = 0
	groupError: Error | null = null
	ended = false
	endTime = 0
	endError: Error | null = null
	callbacksEnd?: Function[]
	endPromise?: Promise<number>
	endResolve?: (end: number) => void
	errorPromise?: Promise<Error | null>
	errorResolve?: (error: Error | null) => void
	lateResult?: TraceProcess<'begin'>
	listenFn?: (callback?: Function) => Promise<TraceProcess<'begin'>>
	childBegin?: (process: TraceStream) => (error?: Error | null) => void

	/** late subscription (`lifecycle.on<Event>` after the phase began) */
	listen() {
		if (this.listenFn) return this.listenFn

		return (this.listenFn = (_callback?: Function) =>
			Promise.resolve(this.#result()))
	}

	#result(): TraceProcess<'begin'> {
		if (this.lateResult) return this.lateResult

		const slot = this

		return (this.lateResult = {
			...this.begun!,
			end: this.#end(),
			error: this.#error(),
			onEvent(_callback?: Function) {},
			onStop(callback?: Function) {
				if (callback && !slot.ended)
					(slot.callbacksEnd ??= []).push(callback)

				return slot.#end()
			}
		} as any)
	}

	#end() {
		if (this.endPromise) return this.endPromise
		if (this.ended) return (this.endPromise = Promise.resolve(this.endTime))

		const { promise, resolve } = Promise.withResolvers<number>()
		this.endPromise = promise
		this.endResolve = resolve

		return promise
	}

	#error() {
		if (this.errorPromise) return this.errorPromise
		if (this.ended)
			return (this.errorPromise = Promise.resolve(this.endError))

		const { promise, resolve } = Promise.withResolvers<Error | null>()
		this.errorPromise = promise
		this.errorResolve = resolve

		return promise
	}

	begin(process: TraceStream) {
		this.begun = process
		this.remaining = process.total ?? 0

		return this
	}

	get resolveChild() {
		return this
	}

	shift() {
		if (this.remaining <= 0) return undefined
		this.remaining--

		if (!this.childBegin)
			this.childBegin =
				() =>
				(error: Error | null = null) => {
					if (error) this.groupError = error
				}

		return this.childBegin
	}

	resolve(error: Error | null = null) {
		if (this.ended) return
		this.ended = true

		const end = performance.now()

		if (!error && this.groupError) error = this.groupError

		this.endTime = end
		this.endError = error

		const callbacks = this.callbacksEnd
		if (callbacks) {
			const begun = this.begun!
			const detail = {
				end,
				error,
				get elapsed() {
					return end - begun.begin
				}
			}

			for (let i = 0; i < callbacks.length; i++) callbacks[i](detail)
		}

		this.endResolve?.(end)
		this.errorResolve?.(error)
	}
}

class TracerHandle {
	slots = new Array<LiveProcess | TraceRecorder | undefined>(9)

	listen(index: number): NonNullable<TraceRecorder['listenFn']> {
		const slot = this.slots[index]

		if (slot === undefined) {
			const live = createProcess()
			this.slots[index] = live

			return live[0] as NonNullable<TraceRecorder['listenFn']>
		}

		if (slot instanceof TraceRecorder) return slot.listen()

		return slot[0] as NonNullable<TraceRecorder['listenFn']>
	}

	begin(index: number, process: TraceStream) {
		const slot = this.slots[index]

		if (slot !== undefined) {
			if (slot instanceof TraceRecorder) return slot.begin(process)

			return slot[1](process)
		}

		const recorder = new TraceRecorder()
		this.slots[index] = recorder

		return recorder.begin(process)
	}

	request(process: TraceStream) {
		return this.begin(0, process)
	}

	parse(process: TraceStream) {
		return this.begin(1, process)
	}

	transform(process: TraceStream) {
		return this.begin(2, process)
	}

	beforeHandle(process: TraceStream) {
		return this.begin(3, process)
	}

	handle(process: TraceStream) {
		return this.begin(4, process)
	}

	afterHandle(process: TraceStream) {
		return this.begin(5, process)
	}

	mapResponse(process: TraceStream) {
		return this.begin(6, process)
	}

	afterResponse(process: TraceStream) {
		return this.begin(7, process)
	}

	error(process: TraceStream) {
		return this.begin(8, process)
	}
}

class TracerLifecycle {
	id: string
	context: Context
	set: Context['set']
	time: number
	store: Context['store']

	#handle: TracerHandle

	constructor(handle: TracerHandle, context: Context) {
		this.#handle = handle
		this.id = context.rid ?? ''
		this.context = context
		this.set = context.set
		this.time = Date.now()
		this.store = context.store
	}

	get onRequest() {
		return this.#handle.listen(0)
	}

	get onParse() {
		return this.#handle.listen(1)
	}

	get onTransform() {
		return this.#handle.listen(2)
	}

	get onBeforeHandle() {
		return this.#handle.listen(3)
	}

	get onHandle() {
		return this.#handle.listen(4)
	}

	get onAfterHandle() {
		return this.#handle.listen(5)
	}

	get onMapResponse() {
		return this.#handle.listen(6)
	}

	get onAfterResponse() {
		return this.#handle.listen(7)
	}

	get onError() {
		return this.#handle.listen(8)
	}
}

export const createTracer = (traceListener: TraceHandler) => {
	return (context: Context) => {
		const handle = new TracerHandle()

		traceListener(new TracerLifecycle(handle, context) as any)

		return handle
	}
}
