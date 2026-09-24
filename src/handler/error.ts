import { hasAsync, getNotFound } from './utils'
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

const defineQuery = (context: Context, value: unknown) =>
	Object.defineProperty(context, 'query', {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	})

function parseQuery(context: Context) {
	const c = context as any

	if (c.query !== undefined || c.qi === undefined) return

	Object.defineProperty(context, 'query', {
		configurable: true,
		enumerable: true,
		get() {
			const value = parseQueryFromURL(c.request.url, c.qi)
			defineQuery(context, value)
			return value
		},
		set(value) {
			defineQuery(context, value)
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
		result.status,
		{
			...body,
			type: error.type,
			...(typeof error.code === 'string' ? { code: error.code } : {})
		},
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
	) => unknown
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
									mapResponse
								),
					() => fallbackErrorResponse(context, error, mapResponse)
				)

			if (r instanceof Response)
				return mapResponse(r, context.set, context)
		} catch {}

	return fallbackErrorResponse(context, error, mapResponse)
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
export function statusFallbackBody(error: any, status: unknown) {
	const masked = isProduction() && (status as number) >= 500
	const declared = error.response

	return declared !== undefined && !(masked && typeof declared === 'object')
		? declared
		: masked
			? 'Internal Server Error'
			: (error.message ?? '')
}

/**
 * RFC 9457 problem document carrying `detail` verbatim, mirroring `problem()`.
 */
const problemOf = (
	self: any,
	detail: unknown,
	status: number,
	claimsProblem: boolean
) =>
	new ElysiaStatus(
		status as any,
		problemBody({
			type: self.type ?? 'about:blank',
			...(claimsProblem && typeof self.code === 'string'
				? { code: self.code }
				: {}),
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
	) => unknown
): unknown {
	if (error instanceof ElysiaStatus)
		return mapResponse(error, context.set, context)

	// Self-describing error, `status` is already applied by applyErrorStatus.
	// A foreign error that merely looks self-describing (undici, node-fetch)
	// keeps the production mask below, only an owned HTTPError bypasses it.
	// A malformed status (NaN, 0, negative) is not a claim of self-description.
	// Thrown values can also be null or undefined.
	const self = (error ?? {}) as HTTPError & {
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

		return mapResponse(
			internalServerErrorResponse(error),
			context.set,
			context
		)
	}

	const serveMessage = () => {
		if (!claimsProblem) return legacy()

		mergeHeaders()

		return mapResponse(
			problemOf(
				self,
				statusFallbackBody(error, served),
				served,
				claimsProblem
			),
			context.set,
			context
		)
	}

	const tier = (key: 'value' | 'detail'): unknown => {
		let annotation: unknown

		try {
			annotation = readAnnotation(self, key, claimsProblem)
		} catch (cause) {
			return failed(cause)
		}

		if (annotation === undefined)
			return key === 'value' ? tier('detail') : serveMessage()

		if (annotation instanceof Promise)
			return annotation.then((resolved: unknown) => {
				// Resolving `undefined` annotates nothing, fall to the next tier
				if (resolved === undefined)
					return key === 'value' ? tier('detail') : serveMessage()

				mergeHeaders()

				return mapResponse(
					key === 'value'
						? resolved
						: problemOf(self, resolved, served, claimsProblem),
					context.set,
					context
				)
			}, failed)

		mergeHeaders()

		return mapResponse(
			key === 'value'
				? annotation
				: problemOf(self, annotation, served, claimsProblem),
			context.set,
			context
		)
	}

	// the error's own body failed to build (a throwing custom `error`
	// callback): response validation stays a masked 500, reading nothing
	// more from the error
	if (error instanceof ValidationError)
		return mapResponse(
			error.type === 'response'
				? internalServerErrorResponse(undefined)
				: new ElysiaStatus(
						422,
						problemBody({
							type: 'validation',
							code: 'validation',
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
	)
		return tier('value')

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
	allowUnsafe = false
) {
	const enter = (context: Context, error: Error) => {
		// @ts-expect-error
		context.error = error
		if (allowUnsafe && error instanceof ValidationError)
			error.allowUnsafeValidationDetails = true
		applyErrorStatus(context, error)

		parseQuery(context)
	}

	// A signed route's cookie signer rides along to the final map
	type Sign = ((set: Context['set']) => unknown) | undefined
	const mapWith = (sign: Sign): typeof mapResponse =>
		sign
			? (response, set, context) =>
					mapResponse(response, set, context, sign)
			: mapResponse

	if (!onErrors)
		return (context: Context, error: Error, sign?: Sign) => {
			enter(context, error)
			return fallbackResponse(context, error, mapWith(sign))
		}

	const respond = (
		context: Context,
		error: Error,
		result: unknown,
		sign: Sign
	) => {
		if (result instanceof ElysiaStatus || result instanceof Response)
			context.set.status = result.status
		else if (context.set.status === undefined || context.set.status === 200)
			context.set.status = 500

		return mapWith(sign)(
			adoptErrorType(result, error),
			context.set,
			context
		)
	}

	const settle = (context: Context, error: Error, sign: Sign) =>
		isPristineNotFound(context, error)
			? getNotFound()
			: fallbackResponse(context, error, mapWith(sign))

	if (hasAsync(onErrors))
		return async (context: Context, error: Error, sign?: Sign) => {
			materializeSetHeaders(context.set)
			enter(context, error)

			for (let i = 0; i < onErrors.length; i++) {
				let result = onErrors[i](context as any)
				if (typeof (result as any)?.then === 'function')
					result = await result

				if (result !== undefined)
					return respond(context, error, result, sign)
			}

			return settle(context, error, sign)
		}

	return (context: Context, error: Error, sign?: Sign) => {
		materializeSetHeaders(context.set)
		enter(context, error)

		for (let i = 0; i < onErrors.length; i++) {
			const result = onErrors[i](context as any)
			if (result !== undefined)
				return respond(context, error, result, sign)
		}

		return settle(context, error, sign)
	}
}
