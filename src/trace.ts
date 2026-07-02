import { traceEvents } from './constants';
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

// TraceRecorder serves EVERY subscription shape (the old eager
// createProcess/LiveProcess duplicated identical span semantics for the
// pre-subscribed case at ~30 promises + ~60 closures per request):
// - pre-subscription (`lifecycle.on<Event>` BEFORE the phase begins): the
//   listen promise + queued callbacks settle synchronously inside `begin()`
//   with the recorder-backed result object
// - late subscription (after the phase began): resolved result immediately
// - end/error promises materialize on first access (`#end()`/`#error()`)
// - child spans allocate promise machinery ONLY when `onEvent` registered a
//   listener; otherwise a shared group-error closure
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
			// end/error promises materialize on first ACCESS — a listener
			// that only reads name/begin (or uses onStop) never allocates them
			get end() {
				return slot.#end()
			},
			get error() {
				return slot.#error()
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

		// pre-subscribed listeners settle synchronously at phase begin — the
		// timing contract the eager LiveProcess used to provide
		const resolve = this.pendingResolve
		if (resolve) {
			this.pendingResolve = undefined

			const result = this.#result()
			resolve(result)

			const callbacks = this.callbacksBegin
			if (callbacks)
				for (let i = 0; i < callbacks.length; i++) callbacks[i](result)
		}

		return this
	}

	get resolveChild() {
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

			for (let i = 0; i < children.length; i++) children[i](result)

			let resolved = false
			return (err: Error | null = null) => {
				if (resolved) return
				resolved = true

				const endAt = performance.now()

				if (err) recorder.groupError = err

				const detail = {
					end: endAt,
					error: err,
					// eslint-disable-next-line sonarjs/no-nested-functions -- single inline getter
					get elapsed() {
						return endAt - process.begin
					}
				}

				for (let i = 0; i < callbacksEnd.length; i++)
					callbacksEnd[i](detail)

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

			for (let i = 0; i < callbacks.length; i++) callbacks[i](detail)
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

	// Fast begin. Returns 0 when the phase HAS a subscriber (caller falls
	// through to the eager span-literal path), else `index + 1` — a truthy
	// token the caller later hands back to `r()`.
	b(index: number, total: number, name?: string) {
		if (this.slots[index] !== undefined) return 0
			; (this.bt ??= [])[index] = performance.now()

		if (total) (this.tt ??= [])[index] = total
		if (name !== undefined) (this.nm ??= [])[index] = name

		return index + 1
	}

	// Group-error capture for the fast path: a child lifecycle RETURNED an
	// error (not thrown) while the phase has no subscriber — record it so a
	// late listener still observes it (the eager path captures it via the
	// child closure into the recorder's groupError). Last write wins, like
	// the recorder.
	gc(rp: number | TraceRecorder | undefined, error: Error): void {
		if (typeof rp === 'number') (this.er ??= [])[rp - 1] = error
	}

	// Resolve a span begun by `b()` (a numeric token) or an eager recorder.
	// Idempotent; tolerates `undefined` (error thrown before the span began).
	r(
		rp: number | TraceRecorder | undefined,
		error: Error | null = null
	): void {
		if (rp === undefined) return

		if (typeof rp === 'number') {
			const index = rp - 1
			const et = (this.et ??= [])

			if (et[index] === undefined) {
				et[index] = performance.now()
				if (error) (this.er ??= [])[index] = error
			}

			// a late listen() may have materialized a recorder between begin
			// and now — settle its promises too (folding a gc()-captured
			// group error, which the mid-phase materialization cannot see)
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

	// Codegen and the fetch path call `begin(index, span)` directly (the phase
	// index is already known — it's passed to `b()`), so no per-phase forwarders.
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

		traceListener(new TracerLifecycle(handle, context) as any)

		return handle
	}
