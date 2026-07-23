import { assimilateThenable, getNotFound, settleResponse } from './utils'
import { parseQueryFromURL } from '../parse-query'
import {
	NotFound,
	ValidationError,
	ElysiaStatus,
	isProduction,
	internalServerErrorResponse
} from '../error'
import { isNotEmpty } from '../utils'
import { materializeSetHeaders } from '../adapter/utils'

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

export const isPristineNotFound = (context: Context, error: any) =>
	error instanceof NotFound &&
	error.response === 'Not Found' &&
	!context.set.cookie &&
	!isNotEmpty(context.set.headers)

export function fallbackResponse(
	context: Context,
	error: any,
	mapResponse: (
		response: unknown,
		set: Context['set'],
		context?: Context
	) => unknown
): unknown {
	if (typeof error?.toResponse === 'function')
		try {
			const r = error.toResponse()

			if (r instanceof Response) return mapResponse(r, context.set, context)

			const pending = assimilateThenable(r)

			if (pending)
				return pending.then(
					(resolved) =>
						resolved instanceof Response
							? mapResponse(resolved, context.set, context)
							: fallbackErrorResponse(context, error, mapResponse),
					() => fallbackErrorResponse(context, error, mapResponse)
				)
		} catch {}

	return fallbackErrorResponse(context, error, mapResponse)
}

function fallbackErrorResponse(
	context: Context,
	error: any,
	mapResponse: (
		response: unknown,
		set: Context['set'],
		context?: Context
	) => unknown
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

		return mapResponse(internalServerErrorResponse(error), context.set, context)
	}

	return mapResponse(internalServerErrorResponse(error), context.set, context)
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
	allowUnsafe = false
) {
	const settle = (context: Context, value: unknown) => {
		const pending = assimilateThenable(value)
		return pending ? settleResponse(context.request, pending) : value
	}

	if (!onErrors)
		return (context: Context, error: Error) => {
			// @ts-expect-error
			context.error = error
			if (allowUnsafe && error instanceof ValidationError)
				error.allowUnsafeValidationDetails = true
			applyErrorStatus(context, error)

			parseQuery(context)
			return settle(context, fallbackResponse(context, error, mapResponse))
		}

	return (context: Context, error: Error) => {
		materializeSetHeaders(context.set)
		// @ts-expect-error
		context.error = error
		if (allowUnsafe && error instanceof ValidationError)
			error.allowUnsafeValidationDetails = true
		applyErrorStatus(context, error)

		parseQuery(context)

		const respond = (result: unknown) => {
			if (result instanceof ElysiaStatus || result instanceof Response)
				context.set.status = (result as any).status
			else if (context.set.status === undefined || context.set.status === 200)
				context.set.status = 500

			return settle(context, mapResponse(result, context.set, context))
		}

		const run = (start: number): unknown => {
			for (let i = start; i < onErrors.length; i++) {
				const result = onErrors[i](context as any)
				const pending = assimilateThenable(result)
				if (pending)
					return pending.then(
						(resolved) => {
							if (context.request.signal.aborted)
								return new Response()
							return resolved === undefined ? run(i + 1) : respond(resolved)
						},
						(hookError) => {
							if (context.request.signal.aborted)
								return new Response()
							throw hookError
						}
					)

				if (result !== undefined) return respond(result)
			}

			if (isPristineNotFound(context, error)) return getNotFound()

			return settle(context, fallbackResponse(context, error, mapResponse))
		}

		return run(0)
	}
}
