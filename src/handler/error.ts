import { getAsyncIndexes } from './utils'
import { parseQueryFromURL } from '../parse-query'

import type { Context } from '../context'
import type { AppHook } from '../types'

const _defaultError = new Response('Internal Server Error', { status: 500 })

// Error paths (404, pre-route throws, route exceptions caught at the
// dispatcher) bypass the compiled-route codegen, so its inline query parse
// never runs. `onError` handlers that destructure `({ query })` would see
// undefined unless we parse here. Cost is one URL scan per error, only on
// the cold error path.
function ensureQuery(context: Context) {
	if ((context as any).query === undefined && (context as any).qi !== undefined)
		(context as any).query = parseQueryFromURL(
			context.request.url,
			(context as any).qi
		)
}

function fallbackResponse(
	context: Context,
	error: any,
	mapResponse: (response: unknown, set: Context['set']) => unknown,
	defaultError: Response
): unknown {
	// `toResponse()` returns a complete `Response` (status, headers, body).
	// Used by ValidationError to surface the structured `{type, on,
	// property, message, summary, expected, found, errors}` JSON shape
	// instead of `error.message` plain text. Other errors (NotFound,
	// ParseError, etc.) keep using the `error.status` + `error.message`
	// path below.
	if (typeof error?.toResponse === 'function') {
		try {
			const r = error.toResponse()
			if (r instanceof Response) return r
		} catch {
			/* fall through to status/message handling */
		}
	}

	if (error?.status) {
		const body =
			error.response !== undefined
				? error.response
				: (error.message ?? '')

		return mapResponse(body, context.set)
	}

	return defaultError.clone()
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
	defaultError ??= _defaultError

	if (!onErrors)
		return (context: Context, error: Error) => {
			// @ts-expect-error
			context.error = error
			// @ts-expect-error
			context.code = (error as any).code ?? 'UNKNOWN'
			if ((error as any)?.status)
				context.set.status = (error as any).status

			ensureQuery(context)
			return fallbackResponse(context, error, mapResponse, defaultError!)
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

			ensureQuery(context)

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

			return fallbackResponse(context, error, mapResponse, defaultError!)
		}

	return (context: Context, error: Error) => {
		// @ts-expect-error
		context.error = error
		// @ts-expect-error
		context.code = error.code ?? 'UNKNOWN'
		// @ts-expect-error
		if (error?.status) context.set.status = error.status

		ensureQuery(context)

		for (let i = 0; i < onErrors.length; i++) {
			const result = onErrors[i](context)
			if (result !== undefined) return mapResponse(result, context.set)
		}

		return fallbackResponse(context, error, mapResponse, defaultError!)
	}
}
