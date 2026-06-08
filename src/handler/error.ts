import { getAsyncIndexes } from './utils'
import { parseQueryFromURL } from '../parse-query'
import { isCloudflareWorker } from '../universal/constants'

import type { Context } from '../context'
import type { AnyErrorConstructor, AppHook } from '../types'

export type ErrorCodeRegistry = Map<AnyErrorConstructor, string>

export function createCodeResolver(
	registry: ErrorCodeRegistry | undefined
): (error: any) => string {
	if (!registry?.size) return (error: any) => error?.code ?? 'UNKNOWN'

	const entries = [...registry]

	return (error: any) => {
		if (error?.code) return error.code

		for (let i = 0; i < entries.length; i++)
			if (error instanceof (entries[i][0] as any)) return entries[i][1]

		return 'UNKNOWN'
	}
}

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
	mapResponse: (
		response: unknown,
		set: Context['set'],
		context?: Context
	) => unknown,
	defaultError?: Response
): unknown {
	if (typeof error?.toResponse === 'function')
		try {
			const r = error.toResponse()

			if (r instanceof Promise)
				return r.then(
					(resolved) =>
						resolved instanceof Response
							? mapResponse(resolved, context.set, context)
							: fallbackErrorResponse(
									context,
									error,
									mapResponse,
									defaultError
								),
					() =>
						fallbackErrorResponse(
							context,
							error,
							mapResponse,
							defaultError
						)
				)

			if (r instanceof Response)
				return mapResponse(r, context.set, context)
		} catch {}

	return fallbackErrorResponse(context, error, mapResponse, defaultError)
}

function fallbackErrorResponse(
	context: Context,
	error: any,
	mapResponse: (
		response: unknown,
		set: Context['set'],
		context?: Context
	) => unknown,
	defaultError?: Response
): unknown {
	if (error?.status) {
		const body =
			error.response !== undefined
				? error.response
				: (error.message ?? '')

		return mapResponse(body, context.set, context)
	}

	if (error?.message != null) {
		if (context.set.status === undefined || context.set.status === 200)
			context.set.status = 500

		return mapResponse(error.message, context.set, context)
	}

	return defaultError ? defaultError.clone() : getDefaultError()
}

function applyErrorStatus(context: Context, error: any): void {
	if (error?.status) context.set.status = error.status
	else if (context.set.status === undefined || context.set.status === 200)
		context.set.status = 500
}

export function createErrorHandler(
	onErrors: AppHook['error'] | undefined,
	mapResponse: (
		response: unknown,
		set: Context['set'],
		...any: unknown[]
	) => unknown,
	defaultError?: Response,
	codeRegistry?: ErrorCodeRegistry
) {
	const resolveCode = createCodeResolver(codeRegistry)

	if (!onErrors)
		return (context: Context, error: Error) => {
			// @ts-expect-error
			context.error = error
			// @ts-expect-error
			context.code = resolveCode(error)
			applyErrorStatus(context, error)

			parseQuery(context)
			return fallbackResponse(context, error, mapResponse, defaultError)
		}

	const asyncIndexes = getAsyncIndexes(onErrors)
	if (asyncIndexes)
		return async (context: Context, error: Error) => {
			// @ts-expect-error
			context.error = error
			// @ts-expect-error
			context.code = resolveCode(error)
			applyErrorStatus(context, error)

			parseQuery(context)

			for (let i = 0; i < onErrors.length; i++) {
				const result = asyncIndexes?.[i]
					? await onErrors[i](context)
					: onErrors[i](context)

				if (result !== undefined) {
					// @ts-expect-error
					if (result?.status) context.set.status = result.status

					return mapResponse(result, context.set, context)
				}
			}

			return fallbackResponse(context, error, mapResponse, defaultError)
		}

	return (context: Context, error: Error) => {
		// @ts-expect-error
		context.error = error
		// @ts-expect-error
		context.code = resolveCode(error)
		applyErrorStatus(context, error)

		parseQuery(context)

		for (let i = 0; i < onErrors.length; i++) {
			const result = onErrors[i](context)
			if (result !== undefined)
				return mapResponse(result, context.set, context)
		}

		return fallbackResponse(context, error, mapResponse, defaultError)
	}
}
