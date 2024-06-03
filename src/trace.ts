import { ELYSIA_REQUEST_ID } from './utils'

import type { Context } from './context'
import type {
	MaybePromise,
	Prettify,
	RouteSchema,
	SingletonBase
} from './types'

export type TraceEvent =
	| 'request'
	| 'parse'
	| 'transform'
	| 'beforeHandle'
	| 'handle'
	| 'afterHandle'
	| 'error'
	| 'response'

export type TraceStream = {
	id: number
	event: TraceEvent
	type: 'begin' | 'end'
	time: number
	name?: string
	unit?: number
}

export type TraceProcess<
	Type extends 'begin' | 'end' = 'begin' | 'end',
	WithChildren extends boolean = true
> = Type extends 'begin'
	? {
			name: string
			start: number
			stop: TraceProcess<'end'>
			onStop: (
				callback?: (stop: TraceProcess<'end'>) => unknown
			) => Promise<TraceProcess<'end'>>
	  } & (WithChildren extends true
			? {
					children: ((
						callback?: (
							process: TraceProcess<'begin', false>
						) => unknown
					) => Promise<TraceProcess<'begin', false>>)[]
			  }
			: {})
	: number

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
			} & {
				[x in `on${Capitalize<TraceEvent>}`]: (
					callback?: (process: TraceProcess<'begin'>) => unknown
				) => Promise<TraceProcess<'begin'>>
			}
		>
	): MaybePromise<unknown>
}

export const ELYSIA_TRACE = Symbol('ElysiaTrace')

const createProcess = () => {
	const { promise, resolve } = Promise.withResolvers<TraceProcess>()
	const { promise: stop, resolve: resolveEnd } =
		Promise.withResolvers<number>()

	const callbacks = <Function[]>[]
	const callbacksEnd = <Function[]>[]

	return [
		(callback?: Function) => {
			if (callback) callbacks.push(callback)

			return promise
		},
		(process: TraceStream) => {
			const processes = <
				((callback?: Function) => Promise<TraceProcess>)[]
			>[]
			const resolvers = <((process: TraceStream) => () => void)[]>[]

			for (let i = 0; i < (process.unit ?? 0); i++) {
				const { promise, resolve } =
					Promise.withResolvers<TraceProcess>()
				const { promise: stop, resolve: resolveEnd } =
					Promise.withResolvers<number>()

				const callbacks = <Function[]>[]
				const callbacksEnd = <Function[]>[]

				processes.push((callback?: Function) => {
					if (callback) callbacks.push(callback)

					return promise
				})

				resolvers.push((process: TraceStream) => {
					const result = {
						...process,
						stop,
						onStop(callback?: Function) {
							if (callback) callbacksEnd.push(callback)

							return stop
						}
					} as any

					resolve(result)
					for (let i = 0; i < callbacks.length; i++)
						callbacks[i](result)

					return () => {
						const now = performance.now()

						for (let i = 0; i < callbacksEnd.length; i++)
							callbacksEnd[i](result)

						resolveEnd(now)
					}
				})
			}

			const result = {
				...process,
				stop,
				children: processes,
				onStop(callback?: Function) {
					if (callback) callbacksEnd.push(callback)

					return stop
				}
			} as any

			resolve(result)
			for (let i = 0; i < callbacks.length; i++) callbacks[i](result)

			return {
				resolveChild: resolvers,
				resolve() {
					const now = performance.now()

					for (let i = 0; i < callbacksEnd.length; i++)
						callbacksEnd[i](result)

					resolveEnd(now)
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
		const [onResponse, resolveResponse] = createProcess()

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
			onError,
			// @ts-ignore
			onResponse
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
			response: resolveResponse
		}
	}
}
