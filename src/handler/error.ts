import { getAsyncIndexes, cachedResponse } from './utils'
import { parseQueryFromURL } from '../parse-query'
import {
	NotFound,
	PROBLEM_JSON,
	ValidationError,
	ElysiaStatus,
	isProduction,
	internalServerErrorResponse
} from '../error'
import { isNotEmpty } from '../utils'

import type { Context } from '../context'
import type { AppHook } from '../types'

function parseQuery(context: Context) {
	const c = context as any

	if (c.query !== undefined || c.qi === undefined) return

	Object.defineProperty(context, 'query', {
		configurable: true,
		enumerable: true,
		get() {
			const value = parseQueryFromURL(c.request.url, c.qi)
			Object.defineProperty(context, 'query', {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			})
			return value
		},
		set(value) {
			Object.defineProperty(context, 'query', {
				value,
				writable: true,
				enumerable: true,
				configurable: true
			})
		}
	})
}

const pristineNotFound = cachedResponse(
	JSON.stringify({ type: 'not-found', title: 'Not Found', status: 404 }),
	404,
	{ 'content-type': PROBLEM_JSON }
)

const isPristineNotFound = (context: Context, error: any) =>
	error instanceof NotFound &&
	error.response === 'Not Found' &&
	!context.set.cookie &&
	!isNotEmpty(context.set.headers)

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
	if (error instanceof ElysiaStatus)
		return mapResponse(error, context.set, context)

	if (error?.status) {
		const body =
			error.response !== undefined
				? error.response
				: // safe guard unintentional error
					isProduction() && error.status >= 500
					? 'Internal Server Error'
					: (error.message ?? '')

		return mapResponse(body, context.set, context)
	}

	if (error?.message != null) {
		if (context.set.status === undefined || context.set.status === 200)
			context.set.status = 500

		return mapResponse(
			internalServerErrorResponse(error),
			context.set,
			context
		)
	}

	return defaultError
		? defaultError.clone()
		: internalServerErrorResponse(error)
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
	allowUnsafe = false
) {
	if (!onErrors)
		return (context: Context, error: Error) => {
			// @ts-expect-error
			context.error = error
			if (allowUnsafe && error instanceof ValidationError)
				error.allowUnsafeValidationDetails = true
			applyErrorStatus(context, error)

			parseQuery(context)
			return fallbackResponse(context, error, mapResponse, defaultError)
		}

	const asyncIndexes = getAsyncIndexes(onErrors)
	if (asyncIndexes)
		return async (context: Context, error: Error) => {
			// @ts-expect-error
			context.error = error
			if (allowUnsafe && error instanceof ValidationError)
				error.allowUnsafeValidationDetails = true
			applyErrorStatus(context, error)

			parseQuery(context)

			for (let i = 0; i < onErrors.length; i++) {
				const result = asyncIndexes?.[i]
					? await onErrors[i](context as any)
					: onErrors[i](context as any)

				if (result !== undefined) {
					if (
						result instanceof ElysiaStatus ||
						result instanceof Response
					)
						context.set.status = result.status
					else if (
						context.set.status === undefined ||
						context.set.status === 200
					)
						context.set.status = 500

					return mapResponse(result, context.set, context)
				}
			}

			if (isPristineNotFound(context, error)) return pristineNotFound()

			return fallbackResponse(context, error, mapResponse, defaultError)
		}

	return (context: Context, error: Error) => {
		// @ts-expect-error
		context.error = error
		if (allowUnsafe && error instanceof ValidationError)
			error.allowUnsafeValidationDetails = true
		applyErrorStatus(context, error)

		parseQuery(context)

		for (let i = 0; i < onErrors.length; i++) {
			const result = onErrors[i](context as any)
			if (result !== undefined) {
				if (
					result instanceof ElysiaStatus ||
					result instanceof Response
				)
					context.set.status = (result as any).status
				else if (
					context.set.status === undefined ||
					context.set.status === 200
				)
					context.set.status = 500

				return mapResponse(result, context.set, context)
			}
		}

		if (isPristineNotFound(context, error)) return pristineNotFound()

		return fallbackResponse(context, error, mapResponse, defaultError)
	}
}
