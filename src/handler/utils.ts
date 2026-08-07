import { isAsyncFunction, mayReturnPromise } from '../compile/utils'
import { isCloudflareWorker, isFastly } from '../universal/constants'
import { PROBLEM_JSON } from '../error'
import { env } from '../universal'

import type { AnyElysia } from '../base'
import type { Context } from '../context'

export const emptyResponse =
	isCloudflareWorker ||
	isFastly ||
	env.ELYSIA_PREALLOCATE_RESPONSE !== 'false'
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

export function forwardError<T>(value: T): T {
	if (value instanceof Error) throw value

	return value
}

export function finalizeRouteError(
	app: AnyElysia,
	context: Partial<Context>,
	error: unknown
) {
	const finalize = app['~finalizeError']
	if (!finalize) throw error

	return finalize(context as Context, error as Error)
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
