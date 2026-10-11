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
	titleOf,
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

/**
 * Whether an error claims a problem type, judged on `type` as the caller
 * read it once: a getter read again could answer anything else, `undefined`
 * included
 */
export const claimsProblemType = (error: any, type: unknown) =>
	typeof type === 'string'
		? !(error instanceof ValidationError) &&
			error.constructor?.name !== 'ValidationError'
		: error instanceof HTTPError

export function adoptErrorType(result: any, error: any) {
	const body = result?.response
	const type = error?.type

	if (
		typeof type !== 'string' ||
		!claimsProblemType(error, type) ||
		body?.type !== 'about:blank' ||
		result.headers?.['content-type'] !== PROBLEM_JSON
	)
		return result

	const code = error.code

	return new ElysiaStatus(
		result.status,
		{
			...body,
			type,
			...(typeof code === 'string' ? { code } : {})
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

export const resolveStatus = (status: unknown) =>
	typeof status === 'string'
		? (StatusMap[status as keyof StatusMap] ?? +status)
		: status

/**
 * Body served by an error that carries a status but no usable body:
 * its declared `response`, otherwise its message, or `mask` in its place
 * on a production 5xx
 */
export function statusFallbackBody(
	error: any,
	status: unknown,
	mask = 'Internal Server Error'
) {
	const masked = isProduction() && (status as number) >= 500
	const declared = error.response

	return declared !== undefined && !(masked && typeof declared === 'object')
		? declared
		: masked
			? mask
			: (error.message ?? '')
}

/**
 * RFC 9457 problem document carrying `detail` verbatim, mirroring `problem()`.
 * `type` comes in as the value the claim was checked on, and `code` is read
 * once, so a getter can't put anything but a string on the wire
 */
const problemOf = (
	self: any,
	type: unknown,
	detail: unknown,
	status: number,
	claimsProblem: boolean
) => {
	const code = claimsProblem ? self.code : undefined

	return new ElysiaStatus(
		status as any,
		problemBody({
			type: typeof type === 'string' ? type : 'about:blank',
			...(typeof code === 'string' ? { code } : {}),
			detail: detail as string,
			status
		}),
		{ 'content-type': PROBLEM_JSON }
	)
}

/**
 * Read one annotation knob, a method (may be `async`) or a plain value.
 * A method may have side effects, so only an error claiming a problem type
 * gets it invoked; a plain value is read from any error
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
	if (error instanceof ElysiaStatus || error instanceof Response)
		return mapResponse(error, context.set, context)

	const self = (error ?? {}) as HTTPError & {
		readonly value?: unknown
		readonly detail?: unknown
	}
	const status = resolveStatus(self.status)
	const owned = error instanceof HTTPError
	// Read once: what the claim is checked on is what gets served
	const type: unknown = self.type
	const claimsProblem = claimsProblemType(error, type)
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

	function mergeHeaders() {
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

		if (
			error?.message != null &&
			(context.set.status === undefined || context.set.status === 200)
		)
			context.set.status = 500

		return mapResponse(
			internalServerErrorResponse(error),
			context.set,
			context
		)
	}

	const serveMessage = () => {
		if (!claimsProblem) return legacy()

		mergeHeaders()

		// A masked 5xx `detail` names the status it serves, as `title` does
		return mapResponse(
			problemOf(
				self,
				type,
				statusFallbackBody(error, served, titleOf(served)),
				served,
				claimsProblem
			),
			context.set,
			context
		)
	}

	const serveAnnotation = (key: 'value' | 'detail'): unknown => {
		let annotation: unknown

		try {
			annotation = readAnnotation(self, key, claimsProblem)
		} catch (cause) {
			return failed(cause)
		}

		if (annotation === undefined)
			return key === 'value' ? serveAnnotation('detail') : serveMessage()

		if (annotation instanceof Promise)
			return annotation.then((resolved: unknown) => {
				// Resolving `undefined` annotates nothing, fall to the next knob
				if (resolved === undefined)
					return key === 'value'
						? serveAnnotation('detail')
						: serveMessage()

				mergeHeaders()

				return mapResponse(
					key === 'value'
						? resolved
						: problemOf(
								self,
								type,
								resolved,
								served,
								claimsProblem
							),
					context.set,
					context
				)
			}, failed)

		mergeHeaders()

		return mapResponse(
			key === 'value'
				? annotation
				: problemOf(self, type, annotation, served, claimsProblem),
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
		return serveAnnotation('value')

	if (
		claimsProblem &&
		error instanceof Error &&
		typeof status === 'number' &&
		status >= 500
	)
		return mapResponse(
			problemOf(self, type, titleOf(status), status, false),
			context.set,
			context
		)

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

	const serveUnhandled = (context: Context, error: Error, sign: Sign) =>
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

			return serveUnhandled(context, error, sign)
		}

	return (context: Context, error: Error, sign?: Sign) => {
		materializeSetHeaders(context.set)
		enter(context, error)

		for (let i = 0; i < onErrors.length; i++) {
			const result = onErrors[i](context as any)
			if (result !== undefined)
				return respond(context, error, result, sign)
		}

		return serveUnhandled(context, error, sign)
	}
}
