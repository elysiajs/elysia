import { isAsyncFunction, mayReturnPromise } from '../compile/utils'
import { isCloudflareWorker, isFastly } from '../universal/constants'
import { HTTPError, PROBLEM_JSON, problemTypeOf } from '../error'
import { env } from '../universal'

import type { AnyElysia } from '../base'
import type { Context } from '../context'

const isPreallocateResponseUnsafe =
	isCloudflareWorker ||
	isFastly ||
	env.ELYSIA_PREALLOCATE_RESPONSE === 'false'

export const emptyResponse = isPreallocateResponseUnsafe
	? { clone: () => new Response(null) }
	: new Response(null)

// typeBase can change after import, so cache the body and response by base.
let notFoundBase: string | undefined
let notFoundBody: string | undefined
let notFoundResponse: Response | undefined

export function getNotFoundBody() {
	const base = HTTPError.typeBase

	if (notFoundBody === undefined || base !== notFoundBase) {
		notFoundBase = base
		notFoundResponse = undefined
		notFoundBody = JSON.stringify({
			type: problemTypeOf('not-found'),
			code: 'not-found',
			status: 404,
			title: 'Not Found'
		})
	}

	return notFoundBody
}

export function getNotFound() {
	const body = getNotFoundBody()

	if (isPreallocateResponseUnsafe)
		return new Response(body, {
			status: 404,
			headers: { 'content-type': PROBLEM_JSON }
		})

	return (notFoundResponse ??= new Response(body, {
		status: 404,
		headers: { 'content-type': PROBLEM_JSON }
	})).clone() as Response
}

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
		if (isAsyncFunction(onRequests[i]) || mayReturnPromise(onRequests[i])) {
			asyncIndexes ??= new Array(onRequests.length)
			asyncIndexes[i] = true
		}

	return asyncIndexes
}
