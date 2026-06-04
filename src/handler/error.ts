import { getAsyncIndexes } from './utils'
import { parseQueryFromURL } from '../parse-query'
import { isCloudflareWorker } from '../universal/constants'

import type { Context } from '../context'
import type { AppHook } from '../types'

let _defaultError: Response | undefined
const getDefaultError = (): Response =>
	isCloudflareWorker
		? new Response('Internal Server Error', { status: 500 })
		: (_defaultError ??= new Response('Internal Server Error', {
				status: 500
			})).clone()

// bypass the compiled-route codegen
function parseQuery(context: Context) {
	const c = context as any

	if (c.query === undefined && c.qi !== undefined)
		context.query = parseQueryFromURL(c.request.url, c.qi)
}

function fallbackResponse(
	context: Context,
	error: any,
	mapResponse: (response: unknown, set: Context['set']) => unknown,
	defaultError?: Response
): unknown {
	if (typeof error?.toResponse === 'function') {
		try {
			const r = error.toResponse()
			if (r instanceof Response) return r
		} catch {}
	}

	if (error?.status) {
		const body =
			error.response !== undefined
				? error.response
				: (error.message ?? '')

		return mapResponse(body, context.set)
	}

	return defaultError ? defaultError.clone() : getDefaultError()
}

export function createErrorHandler(
	onErrors: AppHook['error'] | undefined,
	mapResponse: (
		response: unknown,
		set: Context['set'],
		...any: unknown[]
	) => unknown,
	defaultError?: Response
) {
	if (!onErrors)
		return (context: Context, error: Error) => {
			// @ts-expect-error
			context.error = error
			// @ts-expect-error
			context.code = (error as any).code ?? 'UNKNOWN'
			if ((error as any)?.status)
				context.set.status = (error as any).status

			parseQuery(context)
			return fallbackResponse(context, error, mapResponse, defaultError)
		}

	const asyncIndexes = getAsyncIndexes(onErrors)
	if (asyncIndexes)
		return async (context: Context, error: Error) => {
			// @ts-expect-error
			context.error = error
			// @ts-expect-error
			context.code = error.code ?? 'UNKNOWN'
			// @ts-expect-error
			if (error?.status) context.set.status = error.status

			parseQuery(context)

			for (let i = 0; i < onErrors.length; i++) {
				const result = asyncIndexes?.[i]
					? await onErrors[i](context)
					: onErrors[i](context)

				if (result !== undefined) {
					// @ts-expect-error
					if (result?.status) context.set.status = result.status

					return mapResponse(result, context.set)
				}
			}

			return fallbackResponse(context, error, mapResponse, defaultError)
		}

	return (context: Context, error: Error) => {
		// @ts-expect-error
		context.error = error
		// @ts-expect-error
		context.code = error.code ?? 'UNKNOWN'
		// @ts-expect-error
		if (error?.status) context.set.status = error.status

		parseQuery(context)

		for (let i = 0; i < onErrors.length; i++) {
			const result = onErrors[i](context)
			if (result !== undefined) return mapResponse(result, context.set)
		}

		return fallbackResponse(context, error, mapResponse, defaultError)
	}
}
