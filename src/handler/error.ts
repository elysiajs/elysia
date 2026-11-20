import { getNotFound } from './utils'
import { parseQueryFromURL } from '../parse-query'
import {
	NotFound,
	type ValidationError,
	ElysiaStatus,
	HTTPError,
	isProduction,
	internalServerErrorResponse,
	internalServerErrorBodyString,
	problemBody,
	titleOf,
	PROBLEM_JSON
} from '../error'
import { StatusMap } from '../constants'
import { EmptyObject, isNotEmpty, isPlainObject } from '../utils'
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

// one descriptor for every error: per-error closures cost ~150 B a response
// and drop the context to dictionary mode on V8
const lazyQuery = {
	configurable: true,
	enumerable: true,
	get(this: any) {
		const value = parseQueryFromURL(this.request.url, this.qi)
		defineQuery(this, value)

		return value
	},
	set(this: any, value: unknown) {
		defineQuery(this, value)
	}
}

function parseQuery(context: Context) {
	const c = context as any

	if (c.query !== undefined || c.qi === undefined) return

	Object.defineProperty(context, 'query', lazyQuery)
}

// from failed cookie signing
export const signFailed = (set: Context['set']) =>
	(set as { '~signFailed'?: true })['~signFailed'] === true ||
	(!Object.isExtensible(set) &&
		(set.cookie as { '~signFailed'?: true } | undefined)?.[
			'~signFailed'
		] === true)

/**
 * The 500 an error ends in once it cannot be settled: reads nothing from
 * either error, sends no cookie and only the CORS headers, never throws
 */
export function maskedResponse(context: Context, thrown: unknown) {
	try {
		console.error(thrown)
	} catch {}

	const headers: Record<string, string> = { 'content-type': PROBLEM_JSON }
	try {
		context.set.status = 500

		const source = context.set.headers as any
		for (const [name, value] of source instanceof Headers
			? source
			: Object.entries(source)) {
			const key = name.toLowerCase()
			if (key === 'vary' || key.startsWith('access-control-'))
				headers[key] = value as string
		}

		return new Response(internalServerErrorBodyString(undefined), {
			status: 500,
			headers
		})
	} catch {
		return internalServerErrorResponse(undefined)
	}
}

/**
 * Whether an error claims a problem type, judged on `type` as the caller
 * read it once: a getter read again could answer anything else, `undefined`
 * included
 */
export const claimsProblemType = (error: any, type: unknown) =>
	typeof type === 'string'
		? error?.['~verr'] !== true &&
			error?.constructor?.name !== 'ValidationError'
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

// Response served once every error hook has declined the error
function fallbackResponse(
	context: Context,
	error: any,
	mapResponse: (
		response: unknown,
		set: Context['set'],
		context?: Context
	) => unknown
): unknown {
	let r: unknown
	// only `toResponse` itself falls back: a throwing map is not retried
	if (typeof error?.toResponse === 'function')
		try {
			r = error.toResponse()
		} catch {}

	if (r instanceof Promise)
		return r.then(
			(resolved) =>
				resolved instanceof Response
					? mapResponse(resolved, context.set, context)
					: fallbackErrorResponse(context, error, mapResponse),
			() => fallbackErrorResponse(context, error, mapResponse)
		)

	if (r instanceof Response) return mapResponse(r, context.set, context)

	return fallbackErrorResponse(context, error, mapResponse)
}

export const resolveStatus = (status: unknown) =>
	typeof status === 'string'
		? (StatusMap[status as keyof StatusMap] ?? +status)
		: status

export function errorStatus(status: unknown) {
	const resolved = resolveStatus(status)

	return typeof resolved === 'number' &&
		resolved % 1 === 0 &&
		resolved >= 200 &&
		resolved <= 599
		? resolved
		: 500
}

/**
 * Body served by an error that carries a status but no usable body:
 * its declared `response`, otherwise its message, or `mask` in its place
 * on a production 5xx
 */
export function statusFallbackBody(
	error: any,
	status: unknown,
	mask = 'Internal Server Error',
	asDetail?: boolean
) {
	const masked = isProduction() && (status as number) >= 500
	const response = error.response
	const declared =
		typeof response !== 'string' &&
		(error instanceof Error || Error.isError?.(error))
			? undefined
			: response

	if (declared !== undefined && !(masked && typeof declared === 'object'))
		return declared

	if (masked) return mask

	const message = error.message ?? ''

	return asDetail && message === '' && !Object.hasOwn(error, 'message')
		? undefined
		: message
}

function problemOf(
	self: any,
	type: unknown,
	detail: unknown,
	status: number,
	claimsProblem: boolean,
	members?: Record<string, unknown>
) {
	const code = claimsProblem ? self.code : undefined

	return new ElysiaStatus(
		status as any,
		problemBody({
			type: typeof type === 'string' ? type : 'about:blank',
			...(typeof code === 'string' ? { code } : {}),
			// before `detail`: the error's own wins over its extension's
			...members,
			// left out, not `undefined`: a `mapResponse` hook sees this body
			...(detail === undefined ? {} : { detail: detail as string }),
			status
		}),
		{ 'content-type': PROBLEM_JSON }
	)
}

/**
 * RFC 9457 extension members of an error claiming a problem type. Sync
 * only: anything but a plain object, a Promise included, adds nothing.
 * `type`, `code` and `status` stay the error's own, `detail` only when a
 * string
 */
export function extensionOf(self: any) {
	const extension = self.extension
	const members = typeof extension === 'function' && extension.call(self)

	// a parsed query or body is an EmptyObject, built by this same copy
	if (
		!isPlainObject(members) &&
		!(members && Object.getPrototypeOf(members) === EmptyObject.prototype)
	)
		return

	// no Object.prototype on the chain: an own `__proto__` key stays a member
	const served = new EmptyObject()

	for (const [key, value] of Object.entries(members))
		// a function is behavior, not data: `toJSON`, `next` or `then` would
		// take over how the document is served
		if (
			typeof value !== 'function' &&
			key !== 'type' &&
			key !== 'code' &&
			key !== 'status' &&
			(key !== 'detail' || typeof value === 'string')
		)
			served[key] = value

	return served
}

export function readAnnotation(
	self: any,
	key: 'value' | 'detail',
	claimsProblem: boolean
) {
	const annotation = self[key]

	return typeof annotation === 'function'
		? claimsProblem && key === 'value'
			? annotation.call(self)
			: undefined
		: annotation
}

export function fallbackErrorResponse(
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
	const status = self.status
		? errorStatus(self.status)
		: resolveStatus(self.status)
	const owned = error instanceof HTTPError
	// Read once: what the claim is checked on is what gets served
	const type: unknown = self.type
	const claimsProblem = claimsProblemType(error, type)
	const served = (
		typeof status === 'number' ? status : resolveStatus(context.set.status)
	) as number

	// An error inside the error path has nowhere left to fall
	const failed = (cause: unknown) => maskedResponse(context, cause)

	// Only this copy's HTTPError: another Error's `headers` may be an HTTP
	// client's copy of an upstream response (openai v4's APIError), so it is
	// not even read
	function mergeHeaders() {
		const headers = owned && self.headers
		if (headers) Object.assign(materializeSetHeaders(context.set), headers)
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

	// read past `value`: a response it served never runs `extension`
	let members: Record<string, unknown> | undefined

	const serveMessage = () => {
		if (!claimsProblem) return legacy()

		mergeHeaders()

		// A masked 5xx `detail` names the status it serves, as `title` does
		return mapResponse(
			problemOf(
				self,
				type,
				// an extension's `detail` wins over the message
				members?.detail ??
					statusFallbackBody(error, served, titleOf(served), true),
				served,
				claimsProblem,
				members
			),
			context.set,
			context
		)
	}

	const serveAnnotation = (key: 'value' | 'detail'): unknown => {
		let annotation: unknown

		try {
			annotation = readAnnotation(self, key, claimsProblem)
			if (key === 'detail' && claimsProblem) members = extensionOf(self)
		} catch (cause) {
			return failed(cause)
		}

		if (annotation === undefined)
			return key === 'value' ? serveAnnotation('detail') : serveMessage()

		// Only `value` is awaited, a promised `detail` is plain data
		if (key === 'value' && annotation instanceof Promise)
			return annotation.then((resolved: unknown) => {
				// Resolving `undefined` annotates nothing, fall to `detail`
				if (resolved === undefined) return serveAnnotation('detail')

				mergeHeaders()

				return mapResponse(resolved, context.set, context)
			}, failed)

		mergeHeaders()

		return mapResponse(
			key === 'value'
				? annotation
				: problemOf(
						self,
						type,
						annotation,
						served,
						claimsProblem,
						members
					),
			context.set,
			context
		)
	}

	// the error's own body failed to build (a throwing custom `error`
	// callback): response validation stays a masked 500, reading nothing
	// more from the error
	if (error?.['~verr'] === true)
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

export function applyErrorStatus(context: Context, error: any) {
	if (error?.status) context.set.status = errorStatus(error.status)
	else if (context.set.status === undefined || context.set.status === 200)
		context.set.status = 500
}

type Sign = ((set: Context['set']) => unknown) | undefined

const isPristineNotFound = (context: Context, error: any) =>
	error instanceof NotFound &&
	error.response === 'Not Found' &&
	!context.set.cookie &&
	!isNotEmpty(context.set.headers)

/**
 * Dispatches an error to its hooks once, then settles it: an answer or a
 * declined error. A hook that throws, or a failure while settling, throws
 * out to the caller, which masks it (see `finalizeError`).
 *
 * A route that ran its hooks inline passes `step`: 1 settles `result`, 2
 * masks `error`
 */
export function createErrorHandler(
	onErrors: AppHook['error'] | undefined,
	mapResponse: (
		response: unknown,
		set: Context['set'],
		...any: unknown[]
	) => unknown,
	allowUnsafe = false,
	// no mapResponse hook: a declined plain 404 is the cached one
	cachedNotFound = false
) {
	const total = onErrors?.length ?? 0

	const map = (sign: Sign): typeof mapResponse =>
		sign
			? (response, set, context) =>
					mapResponse(response, set, context, sign)
			: mapResponse

	const serve = (
		context: Context,
		error: any,
		result: unknown,
		sign: Sign
	) => {
		if (result === undefined)
			return cachedNotFound && !sign && isPristineNotFound(context, error)
				? getNotFound()
				: fallbackResponse(context, error, map(sign))

		// a returned error is served as one no hook answers, at its own status
		if (result instanceof Error) {
			// @ts-expect-error
			context.error = result
			context.set.status = errorStatus((result as any).status)

			return fallbackResponse(context, result, map(sign))
		}

		if (result instanceof ElysiaStatus || result instanceof Response)
			context.set.status = result.status
		else if (context.set.status === undefined || context.set.status === 200)
			context.set.status = 500

		return map(sign)(adoptErrorType(result, error), context.set, context)
	}

	const signed = (context: Context, response: unknown) =>
		signFailed(context.set)
			? maskedResponse(context, new Error('Failed to sign cookies'))
			: response

	const settle = (
		context: Context,
		error: any,
		result: unknown,
		sign: Sign
	) => {
		const response = serve(context, error, result, sign) as any

		return typeof response?.then === 'function'
			? Promise.resolve(response).then((response) =>
					signed(context, response)
				)
			: signed(context, response)
	}

	const run = (
		context: Context,
		error: any,
		sign: Sign,
		i: number
	): unknown => {
		for (; i < total; i++) {
			const result = onErrors![i](context as any)

			if (typeof (result as any)?.then === 'function')
				// eslint-disable-next-line sonarjs/function-inside-loop -- continuation for the hook at index i
				return Promise.resolve(result).then((result) =>
					result === undefined
						? run(context, error, sign, i + 1)
						: settle(context, error, result, sign)
				)

			if (result !== undefined)
				return settle(context, error, result, sign)
		}

		return settle(context, error, undefined, sign)
	}

	return (
		context: Context,
		error: Error,
		sign?: Sign,
		result?: unknown,
		step?: 1 | 2
	) => {
		if (step === 2) return maskedResponse(context, error)
		if (step) return settle(context, error, result, sign)

		if (total) materializeSetHeaders(context.set)
		// @ts-expect-error
		context.error = error
		if (allowUnsafe && (error as any)?.['~verr'] === true)
			(error as ValidationError).allowUnsafeValidationDetails = true
		applyErrorStatus(context, error)
		parseQuery(context)

		return run(context, error, sign, 0)
	}
}
