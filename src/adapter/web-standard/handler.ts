import {
	createResponseHandler,
	createStreamHandler,
	handleFile,
	handleSet,
	materializeSetHeaders
} from '../utils'

import { isBun } from '../../universal/constants'
import { isProduction } from '../../universal/is-production'
import { ElysiaFile } from '../../universal/file'
import { Cookie } from '../../cookie/cookie'
import {
	formToFormData,
	isElysiaForm,
	isNotEmpty,
	nullObject
} from '../../utils'
import {
	ElysiaStatus,
	internalServerErrorBody,
	PROBLEM_JSON
} from '../../error'

import { defaultHeaders } from '../default-headers'
import type { Context } from '../../context'
import type { MaybePromise } from '../../types'

const textPlainInit = {
	headers: { 'content-type': 'text/plain' }
} as const

function handleElysiaFile(
	file: ElysiaFile,
	set: Context['set'] = {
		headers: nullObject()
	},
	request?: Request
) {
	const contentType = file.type

	const headers = materializeSetHeaders(set)
	// unknown extension: keep the user's or the runtime's content-type
	if (contentType !== 'application/octet-stream')
		headers['content-type'] = contentType

	const stats = file.stats
	if (stats)
		return stats.then((stat) => {
			const size = stat.size as number

			if (
				size !== undefined &&
				set.status !== 206 &&
				set.status !== 304 &&
				set.status !== 412 &&
				set.status !== 416
			) {
				headers['content-length'] = size
			}

			return handleFile(file, set, request, size)
		}) as any

	return handleFile(file.value as any, set, request)
}

function responseTag(response: unknown) {
	if (response == null) return

	const constructor = Object.getPrototypeOf(response)?.constructor
	// a generator's `constructor` is non-callable and already reaches `mapFallback`
	if (typeof constructor !== 'function')
		// @ts-expect-error
		return typeof response.next === 'function' ? '' : undefined

	return constructor.name
}

function mapResponseWithSet(
	response: unknown,
	set: Context['set'],
	request?: Request,
	owned?: boolean
): Response {
	handleSet(set)
	const headers = set.headers

	// A body with a null-body status is a TypeError per the Fetch spec (Node,
	// Deno, workerd); only Bun accepts it. Serve what the status allows
	// instead of a 500, a returned `status()` carries its own status
	if (
		!isBun &&
		(set.status === 204 || set.status === 304 || set.status === 205) &&
		!(response instanceof Response) &&
		!(response instanceof ElysiaStatus)
	)
		return new Response(null, set as ResponseInit)

	switch (responseTag(response)) {
		case 'String':
			if (!isBun && !headers['content-type'])
				materializeSetHeaders(set)['content-type'] = 'text/plain'

			return new Response(response as string, set as ResponseInit)

		case 'Array':
			return Response.json(response, set as ResponseInit)

		case 'ElysiaForm':
			return new Response(
				formToFormData(response as Record<string, unknown>),
				set as ResponseInit
			)

		case 'Object':
			// @ts-expect-error
			if (typeof response?.next === 'function')
				return handleStream(
					response as any,
					set,
					request,
					undefined,
					owned
				) as any

			return Response.json(response, set as ResponseInit)

		case 'Number':
		case 'Boolean':
			return new Response(String(response), set as ResponseInit)

		case 'ElysiaFile':
			return handleElysiaFile(response as ElysiaFile, set, request)

		case 'File':
		case 'Blob':
			return handleFile(response as Blob, set, request)

		case 'ElysiaStatus':
			return withStatus(
				response as ElysiaStatus<200>,
				set,
				request,
				owned
			)

		case undefined:
			return response
				? Response.json(response, set as ResponseInit)
				: new Response(null, set as ResponseInit)

		case 'Response':
			return handleResponse(response as Response, set, request, owned)

		case 'Error':
			return errorToResponse(response as Error, set, request, owned)

		case 'Promise':
			return (response as Promise<any>).then((x) =>
				mapResponseWithSet(x, set, request, owned)
			) as any

		case 'Function':
			return mapResponseWithSet(
				(response as Function)(),
				set,
				request,
				owned
			)

		case 'FormData':
			return new Response(response as FormData, set as ResponseInit)

		default:
			return mapFallback(response, set, request, owned) as Response
	}
}

function withStatus(
	response: ElysiaStatus<any, any>,
	set: Context['set'] | undefined,
	request?: Request,
	owned?: boolean
) {
	if (set) set.status = response.status
	else
		set = {
			status: response.status,
			headers: nullObject()
		} as Context['set']

	if (response.headers)
		Object.assign(materializeSetHeaders(set), response.headers)

	return mapResponseWithSet(response.response, set, request, owned)
}

// Keep this constant so production builds can remove the check.
const checkRemovedSetRedirect = !isProduction()

export function mapResponse(
	response: unknown,
	set: Context['set'],
	request?: Request,
	owned?: boolean
): Response {
	if (
		checkRemovedSetRedirect &&
		Object.hasOwn(set, 'redirect') &&
		!isProduction()
	) {
		delete (set as any).redirect
		throw new Error(
			'[Elysia] set.redirect was removed in 2.0 — return redirect(url) instead'
		)
	}

	const headers = set.headers
	if (
		set.status !== undefined ||
		set.cookie ||
		(headers as any)[defaultHeaders] === headers ||
		isNotEmpty(headers)
	)
		return mapResponseWithSet(response, set, request, owned)

	if (response instanceof ElysiaStatus)
		return withStatus(response, set, request, owned)

	if (response instanceof Response)
		return owned
			? handleResponse(response, undefined, request, true)
			: response

	if (response instanceof Promise)
		return (response as Promise<any>).then((x) =>
			mapResponse(x, set, request, owned)
		) as any

	// Stream response defers a 'set' API, assume that it may include 'set'
	if (
		// @ts-expect-error
		typeof response?.next === 'function' ||
		response instanceof ReadableStream
	)
		return handleStream(
			response as any,
			set,
			request,
			undefined,
			owned
		) as any

	return mapCompactResponse(response, request, owned)
}

const textHeaders = isBun ? undefined : textPlainInit

export function mapCompactResponse(
	response: unknown,
	request?: Request,
	owned?: boolean
): Response {
	switch (responseTag(response)) {
		case 'String':
			return new Response(response as string, textHeaders)

		case 'Array':
			return Response.json(response)

		case 'ElysiaForm':
			return new Response(
				formToFormData(response as Record<string, unknown>)
			)

		case 'Object':
			return Response.json(response)

		case 'Number':
		case 'Boolean':
			return new Response(String(response))

		case 'ElysiaFile':
			return handleElysiaFile(response as ElysiaFile, undefined, request)

		case 'File':
		case 'Blob':
			return handleFile(response as File, undefined, request)

		case 'ElysiaStatus':
			return withStatus(
				response as ElysiaStatus<200>,
				undefined,
				request,
				owned
			)

		case undefined:
			return response ? Response.json(response) : new Response('')

		case 'Response':
			return owned
				? handleResponse(response as Response, undefined, request, true)
				: (response as Response)

		case 'Error':
			return errorToResponse(response as Error, undefined, request, owned)

		case 'Promise':
			return (response as any as Promise<unknown>).then((x) =>
				mapCompactResponse(x, request, owned)
			) as any

		// ? Maybe response or Blob
		case 'Function':
			return mapCompactResponse((response as Function)(), request, owned)

		case 'FormData':
			return new Response(response as FormData)

		default:
			return mapFallback(response, undefined, request, owned) as Response
	}
}

export function errorToResponse(
	error: Error & { toResponse?(): MaybePromise<Response> },
	set?: Context['set'],
	request?: Request,
	owned = false
) {
	if (error?.toResponse) {
		const targetSet = set ?? ({ headers: nullObject() } as Context['set'])

		const apply = (resolved: unknown) => {
			if (resolved instanceof Response) targetSet.status = resolved.status
			return mapResponse(resolved, targetSet, request, owned)
		}

		const raw = error.toResponse()

		// @ts-ignore
		return typeof raw?.then === 'function' ? raw.then(apply) : apply(raw)
	}

	const status =
		set?.status && set.status !== 200 ? (set.status as number) : 500

	const body = internalServerErrorBody(error)
	body.status = status

	const headers = (set ? materializeSetHeaders(set) : nullObject()) as Record<
		string,
		string
	>
	headers['content-type'] = PROBLEM_JSON

	return new Response(JSON.stringify(body), { status, headers })
}

function mapFallback(
	response: unknown,
	set?: Context['set'],
	request?: Request,
	owned = false
): Response | undefined {
	// recheck Response, Promise, Error because some library may extends Response
	if (response instanceof Response)
		return handleResponse(response, set, request, owned)

	if (response instanceof Error)
		return errorToResponse(response as Error, set, request, owned)

	if (response instanceof ElysiaStatus) {
		// Spread, not withStatus: once >= 2 cookies turn set.headers into a
		// Headers instance, withStatus drops the status headers, this drops
		// set.headers instead (reached by subclasses and minified class names)
		if (set && response.headers) {
			set.status = response.status
			set.headers = { ...set.headers, ...response.headers }
			return mapResponse(response.response, set, request, owned)
		}

		return withStatus(response, set, request, owned)
	}

	if (response instanceof ElysiaFile)
		return handleElysiaFile(response as ElysiaFile, set, request)

	if (isElysiaForm(response))
		return new Response(
			formToFormData(response as Record<string, unknown>),
			set as ResponseInit
		)

	if (
		// @ts-expect-error
		typeof response?.next === 'function' ||
		response instanceof ReadableStream
	)
		return handleStream(
			response as any,
			set,
			request,
			undefined,
			owned
		) as any

	if (typeof (response as Promise<unknown>)?.then === 'function')
		return (response as Promise<unknown>).then((x) =>
			remap(x, set, request, owned)
		) as any

	// custom class with an array-like value
	// eg. Bun.sql`` result
	if (Array.isArray(response))
		return Response.json(response, set as ResponseInit) as any

	// @ts-expect-error
	if (typeof response?.toResponse === 'function')
		return remap((response as any).toResponse(), set, request, owned)

	if (responseTag(response) === 'Cookie' && Cookie.isCookie(response))
		return remap((response as any).value, set, request, owned)

	return new Response(response as any, set as ResponseInit)
}

function remap(
	response: unknown,
	set: Context['set'] | undefined,
	request?: Request,
	owned?: boolean
) {
	return set
		? mapResponse(response, set, request, owned)
		: mapCompactResponse(response, request, owned)
}

const handleResponse = createResponseHandler({
	mapResponse,
	mapCompactResponse
})

const handleStream = createStreamHandler({
	mapResponse,
	mapCompactResponse
})
