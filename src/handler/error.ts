import { getAsyncIndexes, getNotFound } from './utils'
import { parseQueryFromURL } from '../parse-query'
import {
	NotFound,
	ValidationError,
	ElysiaStatus,
	HTTPError,
	isProduction,
	internalServerErrorResponse,
	problemBody,
	PROBLEM_JSON
} from '../error'
import { StatusMap } from '../constants'
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

const isPristineNotFound = (context: Context, error: any) =>
	error instanceof NotFound &&
	error.response === 'Not Found' &&
	!context.set.cookie &&
	!isNotEmpty(context.set.headers)

export const claimsProblemType = (error: any) =>
	typeof error?.type === 'string'
		? !(error instanceof ValidationError) &&
			error.constructor?.name !== 'ValidationError'
		: error instanceof HTTPError

export function adoptErrorType(result: any, error: any) {
	const body = result?.response

	if (
		typeof error?.type !== 'string' ||
		!claimsProblemType(error) ||
		body?.type !== 'about:blank' ||
		result.headers?.['content-type'] !== PROBLEM_JSON
	)
		return result

	return new ElysiaStatus(
		result.code,
		{ ...body, type: error.type },
		result.headers
	)
}

/**
 * Response served once every error hook has declined the error.
 *
 * Exported for the JIT: a route with error hooks emits its own catch block,
 * which must land on *this* function rather than re-implementing it
 */
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

/**
 * Numeric form of an annotated status, which may be written as a name.
 * A numeric string keeps coercing so the production mask below can't be
 * slipped past with `'502'`
 */
export const resolveStatus = (status: unknown) =>
	typeof status === 'string'
		? (StatusMap[status as keyof StatusMap] ?? +status)
		: status

/**
 * Body served by an error that carries a status but no usable body:
 * its declared `response`, otherwise its message
 */
export const statusFallbackBody = (error: any, status: unknown) =>
	error.response !== undefined
		? error.response
		: // safe guard unintentional error
			isProduction() && (status as number) >= 500
			? 'Internal Server Error'
			: (error.message ?? '')

/**
 * RFC 9457 problem document carrying `detail` verbatim, mirroring `problem()`.
 *
 * `detail` is served exactly as annotated — objects included — it is never
 * spread into the envelope. `problemBody` only defaults `type` when the key is
 * *absent*, so an error without one has to supply `'about:blank'` itself
 */
const problemOf = (self: any, detail: unknown, status: number) =>
	new ElysiaStatus(
		status as any,
		problemBody({
			type: self.type ?? 'about:blank',
			detail: detail as string,
			status
		}),
		{ 'content-type': PROBLEM_JSON }
	)

/**
 * Read one annotation knob.
 *
 * Both knobs are canonically methods, so they're evaluated per serve and may
 * be `async`. Running a stranger's function is side-effect surface (it may
 * consume a stream or do IO), so it takes the same problem claim the shaping
 * does — an unclaimed duck error never invokes one. A *value* annotation stays
 * inert data and keeps duck-participating as it always has
 */
export const readAnnotation = (
	self: any,
	key: 'value' | 'detail',
	claimsProblem: boolean
) => {
	const annotation = self[key]

	return typeof annotation === 'function'
		? claimsProblem
			? annotation.call(self)
			: undefined
		: annotation
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

	// Self-describing error, `status` is already applied by applyErrorStatus.
	// A foreign error that merely looks self-describing (undici, node-fetch)
	// keeps the production mask below, only an owned HTTPError bypasses it.
	// A malformed status (NaN, 0, negative) is not a claim of self-description
	const self = error as HTTPError & {
		readonly value?: unknown
		readonly detail?: unknown
	}
	const status = resolveStatus(self.status)
	// An owned error opted into the whole contract, everything it serves is a
	// problem document. A foreign duck error only claims one by carrying a value
	const owned = error instanceof HTTPError
	// Naming a problem `type` is the claim, which an `implements HTTPError`
	// class can make without extending it
	const claimsProblem = claimsProblemType(error)
	// `status` is what the error annotated, `served` is what actually goes out
	// once `applyErrorStatus` has had its say
	const served = (
		typeof status === 'number' ? status : resolveStatus(context.set.status)
	) as number

	// An error inside the error path has nowhere left to fall
	const failed = (cause: unknown) => {
		context.set.status = 500

		return mapResponse(
			internalServerErrorResponse(cause),
			context.set,
			context
		)
	}

	// Headers are merged only once a body is known good, a rejecting or empty
	// annotation must not leak them onto the fallback response
	const mergeHeaders = () => {
		if (self.headers)
			Object.assign(materializeSetHeaders(context.set), self.headers)
	}

	// Legacy lane: what an error that never self-described has always served
	const legacy = (): unknown => {
		if (error?.status)
			return mapResponse(
				statusFallbackBody(error, status),
				context.set,
				context
			)

		if (error?.message != null) {
			if (context.set.status === undefined || context.set.status === 200)
				context.set.status = 500

			return mapResponse(
				internalServerErrorResponse(error),
				context.set,
				context
			)
		}

		// Through the mapper, not bare: an error with neither a status nor a
		// message still has to serve what the handler wrote onto `set`
		// (headers, cookies) — `mapResponse`'s Response lane merges them
		return mapResponse(
			defaultError
				? defaultError.clone()
				: internalServerErrorResponse(error),
			context.set,
			context
		)
	}

	// Tier 3: nothing annotated, the message is the problem `detail`.
	// A duck error that claimed nothing falls back to the legacy lane
	const serveMessage = () => {
		if (!claimsProblem) return legacy()

		mergeHeaders()

		return mapResponse(
			problemOf(self, statusFallbackBody(error, served), served),
			context.set,
			context
		)
	}

	// Tier 2: `detail` fills the `detail` member of a problem document
	const serveDetail = (): unknown => {
		let detail: unknown

		try {
			detail = readAnnotation(self, 'detail', claimsProblem)
		} catch (cause) {
			return failed(cause)
		}

		if (detail === undefined) return serveMessage()

		if (detail instanceof Promise)
			return detail.then((resolved: unknown) => {
				// Resolving `undefined` annotates nothing, fall to the message
				if (resolved === undefined) return serveMessage()

				mergeHeaders()

				return mapResponse(
					problemOf(self, resolved, served),
					context.set,
					context
				)
			}, failed)

		mergeHeaders()

		return mapResponse(
			problemOf(self, detail, served),
			context.set,
			context
		)
	}

	if (error instanceof ValidationError)
		return mapResponse(
			new ElysiaStatus(
				422,
				problemBody({
					type: 'validation',
					title: 'Validation Error',
					status: 422
				}),
				{ 'content-type': PROBLEM_JSON }
			),
			context.set,
			context
		)

	if (
		owned ||
		(error instanceof Error &&
			typeof status === 'number' &&
			status >= 100 &&
			!(isProduction() && status >= 500))
	) {
		// Tier 1: `value` replaces the whole response. No envelope and no
		// problem+json — the annotated `status` and `headers` still apply,
		// only the content is the error's to choose
		let value: unknown

		try {
			value = readAnnotation(self, 'value', claimsProblem)
		} catch (cause) {
			return failed(cause)
		}

		if (value === undefined) return serveDetail()

		if (value instanceof Promise)
			return value.then((resolved: unknown) => {
				if (resolved === undefined) return serveDetail()

				mergeHeaders()

				return mapResponse(resolved, context.set, context)
			}, failed)

		mergeHeaders()

		return mapResponse(value, context.set, context)
	}

	return legacy()
}

function applyErrorStatus(context: Context, error: any) {
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
			materializeSetHeaders(context.set)
			// @ts-expect-error
			context.error = error
			if (allowUnsafe && error instanceof ValidationError)
				error.allowUnsafeValidationDetails = true
			applyErrorStatus(context, error)

			parseQuery(context)

			for (let i = 0; i < onErrors.length; i++) {
				let result = asyncIndexes?.[i]
					? await onErrors[i](context as any)
					: onErrors[i](context as any)

				// A hook may synchronously return a Promise the heuristic
				// didn't flag; await it before treating it as the response so
				// a raw Promise can't suppress the fallback (empty 500).
				if (result instanceof Promise) result = await result

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

					return mapResponse(
						adoptErrorType(result, error),
						context.set,
						context
					)
				}
			}

			if (isPristineNotFound(context, error)) return getNotFound()

			return fallbackResponse(context, error, mapResponse, defaultError)
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

				return mapResponse(
					adoptErrorType(result, error),
					context.set,
					context
				)
			}
		}

		if (isPristineNotFound(context, error)) return getNotFound()

		return fallbackResponse(context, error, mapResponse, defaultError)
	}
}
