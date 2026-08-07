import {
	createResponseHandler,
	createStreamHandler,
	handleFile,
	handleSet,
	materializeSetHeaders
} from '../utils'

import { isBun } from '../../universal/constants'
import { ElysiaFile, mime } from '../../universal/file'
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
	const path = file.path
	const contentType =
		mime[
			path
				.slice(path.lastIndexOf('.') + 1)
				.toLowerCase() as any as keyof typeof mime
		]

	const headers = materializeSetHeaders(set)
	if (contentType) headers['content-type'] = contentType

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

	return Object.getPrototypeOf(response)?.constructor?.name
}

function mapResponseWithSet(
	response: unknown,
	set: Context['set'],
	request?: Request,
	owned?: boolean
): Response {
	handleSet(set)
	const headers = set.headers

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
			return new Response(
				typeof response === 'boolean'
					? response
						? 'true'
						: 'false'
					: (response as number).toString(),
				set as ResponseInit
			)

		case 'ElysiaFile':
			return handleElysiaFile(response as ElysiaFile, set, request)

		case 'File':
		case 'Blob':
			return handleFile(response as Blob, set, request)

		case 'ElysiaStatus':
			set.status = (response as ElysiaStatus<200>).code
			if ((response as ElysiaStatus<200>).headers)
				Object.assign(
					materializeSetHeaders(set),
					(response as ElysiaStatus<200>).headers
				)

			return mapResponseWithSet(
				(response as ElysiaStatus<200>).response,
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

export function mapResponse(
	response: unknown,
	set: Context['set'],
	request?: Request,
	owned?: boolean
): Response {
	const headers = set.headers
	if (
		set.status !== undefined ||
		set.cookie ||
		(headers as any)[defaultHeaders] === headers ||
		isNotEmpty(headers)
	)
		return mapResponseWithSet(response, set, request, owned)

	if (response instanceof ElysiaStatus) {
		set.status = (response as ElysiaStatus<200>).code
		if ((response as ElysiaStatus<200>).headers)
			Object.assign(set.headers, (response as ElysiaStatus<200>).headers)

		return mapResponse(
			(response as ElysiaStatus<200>).response,
			set,
			request,
			owned
		)
	}

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
			return new Response(
				typeof response === 'boolean'
					? response
						? 'true'
						: 'false'
					: (response as number).toString()
			)

		case 'ElysiaFile':
			return handleElysiaFile(response as ElysiaFile, undefined, request)

		case 'File':
		case 'Blob':
			return handleFile(response as File, undefined, request)

		case 'ElysiaStatus':
			return mapResponse(
				(response as ElysiaStatus<200>).response,
				{
					status: (response as ElysiaStatus<200>).code,
					headers: (response as ElysiaStatus<200>).headers
						? Object.assign(
								nullObject(),
								(response as ElysiaStatus<200>).headers
							)
						: nullObject()
				} as Context['set'],
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

	if (response instanceof Promise)
		return response.then((x) =>
			set
				? mapResponse(x, set, request, owned)
				: mapCompactResponse(x, request, owned)
		) as any

	if (response instanceof Error)
		return errorToResponse(response as Error, set, request, owned)

	if (response instanceof ElysiaStatus) {
		if (set) {
			set.status = response.code
			if (response.headers)
				set.headers = { ...set.headers, ...response.headers }
			return mapResponse(response.response, set, request, owned)
		} else
			return mapResponse(
				(response as ElysiaStatus<200>).response,
				{
					status: (response as ElysiaStatus<200>).code,
					headers: response.headers ? { ...response.headers } : {}
				} as Context['set'],
				request,
				owned
			)
	}

	if (response instanceof ElysiaFile)
		return handleElysiaFile(response as ElysiaFile, undefined, request)

	// A downstream minifier mangles class names, so the name switch above misses
	// every prototype-dispatched type in a minified bundle. This is the same
	// `instanceof` recheck that catches Response/ElysiaStatus/ElysiaFile there.
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
			set
				? mapResponse(x, set, request, owned)
				: mapCompactResponse(x, request, owned)
		) as any

	// custom class with an array-like value
	// eg. Bun.sql`` result
	if (Array.isArray(response)) return Response.json(response) as any

	// @ts-expect-error
	if (typeof response?.toResponse === 'function')
		return set
			? mapResponse((response as any).toResponse(), set, request, owned)
			: mapCompactResponse((response as any).toResponse(), request, owned)

	if (responseTag(response) === 'Cookie' && Cookie.isCookie(response))
		return set
			? mapResponse((response as any).value, set, request, owned)
			: mapCompactResponse((response as any).value, request, owned)

	return new Response(response as any, set as ResponseInit)
}

const handleResponse = createResponseHandler({
	mapResponse,
	mapCompactResponse
})

const handleStream = createStreamHandler({
	mapResponse,
	mapCompactResponse
})
