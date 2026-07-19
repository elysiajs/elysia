import { getAsyncIndexes, getNotFound, settleResponse } from './utils'
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
	) => unknown,
	defaultError?: Response
): unknown {
	if (typeof error?.toResponse === 'function')
		try {
			const r = error.toResponse()

			if (r instanceof Response)
				return mapResponse(r, context.set, context)

			let pending: Promise<unknown> | undefined
			if (r instanceof Promise) pending = r
			else {
				const then = r?.then
				if (typeof then === 'function')
					pending = new Promise((resolve, reject) => {
						queueMicrotask(() => {
							try {
								Reflect.apply(then, r, [resolve, reject])
							} catch (error) {
								reject(error)
							}
						})
					})
			}

			if (pending)
				return pending.then(
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

	return mapResponse(
		defaultError ? defaultError.clone() : internalServerErrorResponse(error),
		context.set,
		context
	)
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
	allowUnsafe = false,
	compatCancellation = false
) {
	const settle = (context: Context, value: unknown) =>
		compatCancellation || typeof (value as any)?.then !== 'function'
			? value
			: settleResponse(context.request, value)

	if (!onErrors)
		return (context: Context, error: Error) => {
			// @ts-expect-error
			context.error = error
			if (allowUnsafe && error instanceof ValidationError)
				error.allowUnsafeValidationDetails = true
			applyErrorStatus(context, error)

			parseQuery(context)
			return settle(
				context,
				fallbackResponse(context, error, mapResponse, defaultError)
			)
		}

	const asyncIndexes = getAsyncIndexes(onErrors)
	if (asyncIndexes)
		return async (context: Context, error: Error) => {
			materializeSetHeaders(context.set)
			// @ts-expect-error
			context.error = error
			if (allowUnsafe && error instanceof ValidationError)
				error.allowUnsafeValidationDetails = true
			applyErrorStatus(context, error)

			parseQuery(context)

			for (let i = 0; i < onErrors.length; i++) {
				let result: unknown
				let suspended = false
				try {
					if (asyncIndexes?.[i]) {
						suspended = true
						result = await onErrors[i](context as any)
					} else {
						result = onErrors[i](context as any)

						if (result instanceof Promise) {
							suspended = true
							result = await result
						}
					}
				} catch (hookError) {
					if (
						!compatCancellation &&
						suspended &&
						context.request.signal.aborted
					)
						return new Response()

					throw hookError
				}

				if (
					!compatCancellation &&
					suspended &&
					context.request.signal.aborted
				)
					return new Response()

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

					return settle(
						context,
						mapResponse(result, context.set, context)
					)
				}
			}

			if (isPristineNotFound(context, error)) return getNotFound()

			return settle(
				context,
				fallbackResponse(context, error, mapResponse, defaultError)
			)
		}

	return (context: Context, error: Error) => {
		materializeSetHeaders(context.set)
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

				return settle(
					context,
					mapResponse(result, context.set, context)
				)
			}
		}

		if (isPristineNotFound(context, error)) return getNotFound()

		return settle(
			context,
			fallbackResponse(context, error, mapResponse, defaultError)
		)
	}
}
