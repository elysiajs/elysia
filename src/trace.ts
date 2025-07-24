import { ELYSIA_REQUEST_ID } from './utils'

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

export type TraceStream = {
	id: number
	event: TraceEvent
	type: 'begin' | 'end'
	begin: number
	name?: string
	total?: number
}

type TraceEndDetail = {
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
		resolve: {}
	}
> = {
	(
		lifecycle: Prettify<
			{
				id: number
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

export const ELYSIA_TRACE = Symbol('ElysiaTrace')

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

					return (error: Error | null = null) => {
						const end = performance.now()

						// Catch return error
						if (error) groupError = error

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

			return {
				resolveChild: resolvers,
				resolve(error: Error | null = null) {
					const end = performance.now()

					// If error is return, parent group will not catch an error
					// but the child group will catch the error
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

export const createTracer = (traceListener: TraceHandler) => {
	return (context: Context) => {
		const [onRequest, resolveRequest] = createProcess()
		const [onParse, resolveParse] = createProcess()
		const [onTransform, resolveTransform] = createProcess()
		const [onBeforeHandle, resolveBeforeHandle] = createProcess()
		const [onHandle, resolveHandle] = createProcess()
		const [onAfterHandle, resolveAfterHandle] = createProcess()
		const [onError, resolveError] = createProcess()
		const [onMapResponse, resolveMapResponse] = createProcess()
		const [onAfterResponse, resolveAfterResponse] = createProcess()

		traceListener({
			// @ts-ignore
			id: context[ELYSIA_REQUEST_ID],
			context,
			set: context.set,
			// @ts-ignore
			onRequest,
			// @ts-ignore
			onParse,
			// @ts-ignore
			onTransform,
			// @ts-ignore
			onBeforeHandle,
			// @ts-ignore
			onHandle,
			// @ts-ignore
			onAfterHandle,
			// @ts-ignore
			onMapResponse,
			// @ts-ignore
			onAfterResponse,
			// @ts-ignore
			onError,
			time: Date.now(),
			store: context.store
		})

		// ? This is pass to compiler
		return {
			request: resolveRequest,
			parse: resolveParse,
			transform: resolveTransform,
			beforeHandle: resolveBeforeHandle,
			handle: resolveHandle,
			afterHandle: resolveAfterHandle,
			error: resolveError,
			mapResponse: resolveMapResponse,
			afterResponse: resolveAfterResponse
		}
	}
}
