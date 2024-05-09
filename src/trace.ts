import type { Context } from './context'
import type { TraceHandler, TraceProcess } from './types'

export const ELYSIA_TRACE = Symbol('ElysiaTrace')

const createProcess = () => {
	const { promise, resolve } = Promise.withResolvers<TraceProcess>()
	const { promise: end, resolve: resolveEnd } =
		Promise.withResolvers<number>()

	return [
		promise,
		(v: any) => {
			resolve({
				...v,
				end
			})

			return () => {
				resolveEnd(performance.now())
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
			request,
			parse,
			transform,
			beforeHandle,
			handle,
			afterHandle,
			error,
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
