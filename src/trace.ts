import { traceEvents, type TraceEvent } from './constants'
import { inferFunction } from './sucrose'
import type { Context } from './context'
import type { Prettify, RouteSchema, SingletonBase } from './types'

export type { TraceEvent }

const phaseGetter: Record<string, TraceEvent> = {
	onRequest: 'request',
	onParse: 'parse',
	onTransform: 'transform',
	onBeforeHandle: 'beforeHandle',
	onHandle: 'handle',
	onAfterHandle: 'afterHandle',
	onMapResponse: 'mapResponse',
	onAfterResponse: 'afterResponse',
	onError: 'error'
}

const phaseOf = (member: string): TraceEvent | undefined =>
	Object.hasOwn(phaseGetter, member) ? phaseGetter[member] : undefined

const tracePhaseCache = new WeakMap<Function, Set<TraceEvent> | null>()

function scanTracePhases(fn: Function) {
	const cached = tracePhaseCache.get(fn)
	if (cached !== undefined) return cached

	let result: Set<TraceEvent> | null = null
	// a handler without a (plain) first parameter still has to run, so it
	// traces every phase
	if (fn.length)
		try {
			// the prototype method, so an own `toString` cannot forge the source
			result = inferFunction(
				Function.prototype.toString.call(fn),
				phaseOf,
				true
			)
		} catch {
			result = null
		}

	tracePhaseCache.set(fn, result)

	return result
}

export function unionTracePhases(
	handlers: readonly Function[] | undefined
): Set<TraceEvent> | null {
	if (!handlers?.length) return new Set()

	const union = new Set<TraceEvent>()
	for (let i = 0; i < handlers.length; i++) {
		const phases = scanTracePhases(handlers[i])
		if (phases === null) return null
		for (const p of phases) union.add(p)
	}

	return union
}

export interface TraceStream {
	id: number
	event: TraceEvent
	begin: number
	name?: string
	total?: number
}

export interface TraceEndDetail {
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
						): void
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
				 * Per-request id. Sourced from `Bun.randomUUIDv7()` on Bun,
				 * otherwise `crypto.randomUUID()`. Useful for log correlation.
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

/** Prevent rejected trace callbacks from becoming unhandled rejections. */
function fire(result: unknown) {
	if (typeof (result as PromiseLike<unknown>)?.then === 'function')
		(result as PromiseLike<unknown>).then(undefined, (error) =>
			console.error(error)
		)
}

class TraceRecorder {
	begun?: TraceStream
	remaining = 0
	childIndex = 0
	groupError: Error | null = null
	ended = false
	endTime = 0
	endError: Error | null = null
	callbacksBegin?: Function[]
	callbacksEnd?: Function[]
	callbacksChild?: Function[]
	pendingPromise?: Promise<TraceProcess<'begin'>>
	pendingResolve?: (result: TraceProcess<'begin'>) => void
	endPromise?: Promise<number>
	endResolve?: (end: number) => void
	errorPromise?: Promise<Error | null>
	errorResolve?: (error: Error | null) => void
	result?: TraceProcess<'begin'>
	listenFn?: (callback?: Function) => Promise<TraceProcess<'begin'>>
	childBegin?: (process: TraceStream) => (error?: Error | null) => void

	listen() {
		if (this.listenFn) return this.listenFn

		// late subscription (`lifecycle.on<Event>` after the phase began):
		// resolved result immediately; the callback is not replayed (parity
		// with the previous behavior)
		if (this.begun)
			return (this.listenFn = (_callback?: Function) =>
				Promise.resolve(this.#result()))

		// pre-subscription: settle at `begin()`
		const { promise, resolve } =
			Promise.withResolvers<TraceProcess<'begin'>>()
		this.pendingPromise = promise
		this.pendingResolve = resolve

		return (this.listenFn = (callback?: Function) => {
			if (callback) (this.callbacksBegin ??= []).push(callback)

			return this.pendingPromise!
		})
	}

	#result(): TraceProcess<'begin'> {
		if (this.result) return this.result

		const slot = this

		return (this.result = {
			...this.begun!,
			get end() {
				return slot.#end()
			},
			get error() {
				if (slot.errorPromise) return slot.errorPromise
				if (slot.ended)
					return (slot.errorPromise = Promise.resolve(
						slot.endError
					))

				const { promise, resolve } =
					Promise.withResolvers<Error | null>()
				slot.errorPromise = promise
				slot.errorResolve = resolve

				return promise
			},
			onEvent(callback?: Function) {
				if (callback) (slot.callbacksChild ??= []).push(callback)
			},
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

	begin(process: TraceStream) {
		this.begun = process
		this.remaining = process.total ?? 0

		// pre-subscribed listeners settle synchronously at phase begin
		// the timing contract the eager LiveProcess used to provide
		const resolve = this.pendingResolve
		if (resolve) {
			this.pendingResolve = undefined

			const result = this.#result()
			resolve(result)

			const callbacks = this.callbacksBegin
			if (callbacks)
				for (let i = 0; i < callbacks.length; i++)
					fire(callbacks[i](result))
		}

		return this
	}

	shift() {
		if (this.remaining <= 0) return
		this.remaining--

		const children = this.callbacksChild
		if (!children?.length)
			// no child listener: only capture a returned-not-thrown error
			return (this.childBegin ??=
				() =>
				(error: Error | null = null) => {
					if (error) this.groupError = error
				})

		const index = this.childIndex++
		const recorder = this

		return (process: TraceStream) => {
			const { promise: end, resolve: resolveEnd } =
				Promise.withResolvers<number>()
			const { promise: error, resolve: resolveError } =
				Promise.withResolvers<Error | null>()
			const callbacksEnd: Function[] = []

			const result = {
				...process,
				end,
				error,
				index,
				onStop(callback?: Function) {
					if (callback) callbacksEnd.push(callback)

					return end
				}
			} as any

			for (let i = 0; i < children.length; i++) fire(children[i](result))

			let resolved = false
			return (err: Error | null = null) => {
				if (resolved) return
				resolved = true

				const endAt = performance.now()

				if (err) recorder.groupError = err

				const detail = {
					end: endAt,
					error: err,
					get elapsed() {
						return endAt - process.begin
					}
				}

				for (let i = 0; i < callbacksEnd.length; i++)
					fire(callbacksEnd[i](detail))

				resolveEnd(endAt)
				resolveError(err)
			}
		}
	}

	resolve(error: Error | null = null, at?: number) {
		if (this.ended) return
		this.ended = true

		const end = at ?? performance.now()

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

			for (let i = 0; i < callbacks.length; i++)
				fire(callbacks[i](detail))
		}

		this.endResolve?.(end)
		this.errorResolve?.(error)
	}
}

class TracerHandle {
	slots = new Array<TraceRecorder | undefined>(9)
	rid = ''

	bt?: number[]
	et?: number[]
	er?: (Error | null)[]
	tt?: number[]
	nm?: string[]

	// begin
	b(index: number, total: number, name?: string) {
		if (this.slots[index] !== undefined) return 0
		;(this.bt ??= [])[index] = performance.now()

		if (total) (this.tt ??= [])[index] = total
		if (name !== undefined) (this.nm ??= [])[index] = name

		return index + 1
	}

	// Group-error capture
	gc(rp: number | TraceRecorder | undefined, error: Error) {
		if (typeof rp === 'number') (this.er ??= [])[rp - 1] = error
	}

	// Resolve a span begun by `b()` (begin, a numeric token) or an eager recorder
	r(rp: number | TraceRecorder | undefined, error: Error | null = null) {
		if (rp === undefined) return

		if (typeof rp === 'number') {
			const index = rp - 1
			const et = (this.et ??= [])

			if (et[index] === undefined) {
				et[index] = performance.now()
				if (error) (this.er ??= [])[index] = error
			}

			this.slots[index]?.resolve(
				error ?? this.er?.[index] ?? null,
				et[index]
			)
			return
		}

		rp.resolve(error)
	}

	listen(index: number): NonNullable<TraceRecorder['listenFn']> {
		let slot = this.slots[index]

		if (slot === undefined) {
			slot = new TraceRecorder()

			const begin = this.bt?.[index]
			if (begin !== undefined) {
				slot.begin({
					id: this.rid as unknown as number,
					event: traceEvents[index],
					name: this.nm?.[index] ?? traceEvents[index],
					begin,
					total: this.tt?.[index] ?? 0
				})

				const end = this.et?.[index]
				if (end !== undefined)
					slot.resolve(this.er?.[index] ?? null, end)
			}

			this.slots[index] = slot
		}

		return slot.listen()
	}

	begin(index: number, process: TraceStream) {
		let slot = this.slots[index]

		if (slot === undefined) this.slots[index] = slot = new TraceRecorder()

		return slot.begin(process)
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

export const createTracer =
	(traceListener: TraceHandler) => (context: Context) => {
		const handle = new TracerHandle()
		handle.rid = context.rid ?? ''

		fire(traceListener(new TracerLifecycle(handle, context) as any))

		return handle
	}

export interface TraceCapability {
	readonly id: string
	readonly createTracer: typeof createTracer
	readonly unionTracePhases: typeof unionTracePhases
}
