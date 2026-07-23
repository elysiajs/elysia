import { NotFound, PROBLEM_JSON } from '../error'
import { isCloudflareWorker } from '../universal/constants'

import type { Context } from '../context'
import type { MaybePromise } from '../types'

export type RouteErrorFinalizer = (
	context: Context,
	error: Error
) => MaybePromise<Response>

function cachedResponse(
	body: string,
	status: number,
	headers?: Record<string, string>
): () => Response {
	let cached: Response | undefined

	return (): Response =>
		isCloudflareWorker
			? new Response(body, { status, headers })
			: ((cached ??= new Response(body, {
					status,
					headers
				})).clone() as Response)
}

export const NOT_FOUND_BODY = JSON.stringify({
	type: 'not-found',
	title: 'Not Found',
	status: 404
})

export const getNotFound = cachedResponse(NOT_FOUND_BODY, 404, {
	'content-type': PROBLEM_JSON
})

export const frameworkNotFound = Object.freeze({ code: 'NOT_FOUND' })

export const materializeFrameworkError = (error: unknown) =>
	error === frameworkNotFound ? new NotFound() : error

export const settleResponse = async (request: Request, value: unknown) => {
	try {
		value = await value
	} catch (error) {
		if (!request.signal.aborted) throw error
	}

	return request.signal.aborted ? new Response() : value
}

export function forwardError<T>(value: T): T {
	if (value instanceof Error) throw value

	return value
}

/** Capture a structural thenable's callback once before suspending. */
export function assimilateThenable<T>(
	value: T
): Promise<Awaited<T>> | undefined {
	if (
		value === null ||
		(typeof value !== 'object' && typeof value !== 'function')
	)
		return

	const then = (value as any).then
	if (typeof then !== 'function') return

	return new Promise<Awaited<T>>((resolve, reject) => {
		queueMicrotask(() => {
			try {
				Reflect.apply(then, value, [resolve, reject])
			} catch (error) {
				reject(error)
			}
		})
	})
}

export function finalizeRouteError(
	finalize: RouteErrorFinalizer | undefined,
	context: Partial<Context>,
	error: unknown
) {
	if (!finalize) throw error

	return finalize(context as Context, materializeFrameworkError(error) as Error)
}
