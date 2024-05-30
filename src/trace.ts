import type { Context } from './context'
import type { TraceHandler, TraceProcess, TraceStream } from './types'

export const ELYSIA_TRACE = Symbol('ElysiaTrace')

const createProcess = () => {
	const { promise, resolve } = Promise.withResolvers<TraceProcess>()
	const { promise: end, resolve: resolveEnd } =
		Promise.withResolvers<number>()

	return [
		promise,
		(v: TraceStream) => {
			// console.log({
			// 	stream: v
			// })

			const processes = <Promise<TraceProcess>[]>[]
			const resolvers = <
				((process: TraceStream) => () => void)[]
			>[]

			for (let i = 0; i < (v.unit ?? 0); i++) {
				const { promise, resolve } =
					Promise.withResolvers<TraceProcess>()
				const { promise: end, resolve: resolveEnd } =
					Promise.withResolvers<number>()

				processes.push(promise)
				resolvers.push((process: TraceStream) => {
					resolve({
						...process,
						end
					} as any)

					return () => {
						resolveEnd(performance.now())
					}
				})
			}

			resolve({
				...v,
				children: processes,
				end
			} as any)

			return {
				resolveChild: resolvers,
				resolve: () => {
					resolveEnd(performance.now())
				}
			}
		}
	] as const
}

export const createTracer = (callback: TraceHandler) => {
	return (context: Context) => {
		const [request, resolveRequest] = createProcess()
		const [parse, resolveParse] = createProcess()
		const [transform, resolveTransform] = createProcess()
		const [beforeHandle, resolveBeforeHandle] = createProcess()
		const [handle, resolveHandle] = createProcess()
		const [afterHandle, resolveAfterHandle] = createProcess()
		const [error, resolveError] = createProcess()
		const [response, resolveResponse] = createProcess()

		// ? This is pass to trace listener
		callback({
			context,
			// @ts-ignore
			request,
			// @ts-ignore
			parse,
			// @ts-ignore
			transform,
			// @ts-ignore
			beforeHandle,
			// @ts-ignore
			handle,
			// @ts-ignore
			afterHandle,
			// @ts-ignore
			error,
			// @ts-ignore
			response
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
