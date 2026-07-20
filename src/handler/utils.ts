import { isAsyncFunction, mayReturnPromise } from '../compile/utils'
import { isCloudflareWorker } from '../universal/constants'
import { NotFound, PROBLEM_JSON } from '../error'

import type { Context } from '../context'
import type { MaybePromise } from '../types'

export type RouteErrorFinalizer = (
	context: Context,
	error: Error
) => MaybePromise<Response>

export const emptyResponse = isCloudflareWorker
	? { clone: () => new Response(null) }
	: new Response(null)

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

export function finalizeRouteError(
	finalize: RouteErrorFinalizer | undefined,
	context: Partial<Context>,
	error: unknown
) {
	if (!finalize) throw error

	return finalize(
		context as Context,
		materializeFrameworkError(error) as Error
	)
}

export function getAsyncIndexes(onRequests: Function[]) {
	let asyncIndexes: (true | undefined)[] | undefined
	for (let i = 0; i < onRequests.length; i++)
		// Widen to async whenever the hook is a native async function or its
		// source may return a Promise. A synchronously-returned thenable must
		// be awaited before deciding short-circuit vs continue, otherwise a
		// raw Promise is mapped as a truthy response (empty 200).
		if (isAsyncFunction(onRequests[i]) || mayReturnPromise(onRequests[i])) {
			asyncIndexes ??= new Array(onRequests.length)
			asyncIndexes[i] = true
		}

	return asyncIndexes
}
