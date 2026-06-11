/* eslint-disable sonarjs/no-nested-switch */
/* eslint-disable sonarjs/no-duplicate-string */
import {
	createResponseHandler,
	createStreamHandler,
	handleFile,
	handleSet
} from '../utils'

import { isBun } from '../../universal/constants'
import { ElysiaFile, mime } from '../../universal/file'
import { formToFormData, isNotEmpty, nullObject } from '../../utils'
import { ElysiaStatus } from '../../error'

import type { Context } from '../../context'
import type { MaybePromise } from '../../types'

function handleElysiaFile(
	file: ElysiaFile,
	set: Context['set'] = {
		headers: nullObject()
	},
	request?: Request
) {
	const path = file.path
	const contentType =
		mime[path.slice(path.lastIndexOf('.') + 1) as any as keyof typeof mime]

	const headers = set.headers
	if (contentType) headers['content-type'] = contentType

	if (
		file.stats &&
		set.status !== 206 &&
		set.status !== 304 &&
		set.status !== 412 &&
		set.status !== 416
	)
		return file.stats!.then((stat) => {
			const size = stat.size as number

			if (size !== undefined) {
				headers['content-range'] = `bytes 0-${size - 1}/${size}`
				headers['content-length'] = size
			}

			return handleFile(file.value as any, set, request)
		}) as any

	return handleFile(file.value as any, set, request)
}

const isNotBun = !isBun

export function mapResponse(
	response: unknown,
	set: Context['set'],
	request?: Request
): Response {
	const headers = set.headers

	if (isNotEmpty(headers) || set.status !== 200 || set.cookie) {
		handleSet(set)

		switch (response?.constructor?.name) {
			case 'String':
				if (isNotBun && !headers['content-type'])
					headers['content-type'] = 'text/plain'

				return new Response(response as string, set as ResponseInit)

			case 'Array':
				return Response.json(response, set as ResponseInit)

			case 'Object':
				if ((response as Record<string, unknown>)['~ely-form'])
					return new Response(
						formToFormData(response as Record<string, unknown>),
						set as ResponseInit
					)

				return Response.json(response, set as ResponseInit)

			case 'Number':
			case 'Boolean':
				return new Response(
					(response as number | boolean).toString(),
					set as ResponseInit
				)

			case 'ElysiaFile':
				return handleElysiaFile(response as ElysiaFile, set, request)

			case 'File':
			case 'Blob':
				return handleFile(response as Blob, set, request)

			case 'ElysiaStatus':
				set.status = (response as ElysiaStatus<200>).code

				return mapResponse(
					(response as ElysiaStatus<200>).response,
					set,
					request
				)

			case undefined:
				return response
					? Response.json(response, set as ResponseInit)
					: new Response('', set as ResponseInit)

			case 'Response':
				return handleResponse(response as Response, set, request)

			case 'Error':
				return errorToResponse(response as Error, set)

			case 'Promise':
				return (response as Promise<any>).then((x) =>
					mapResponse(x, set, request)
				) as any

			case 'Function':
				return mapResponse((response as Function)(), set, request)

			case 'FormData':
				return new Response(response as FormData, set as ResponseInit)

			default:
				return mapResponseFallback(response, set, request) as Response
		}
	} else if (response instanceof Response) return response

	// Stream response defers a 'set' API, assume that it may include 'set'
	if (
		// @ts-expect-error
		typeof response?.next === 'function' ||
		response instanceof ReadableStream
	)
		return handleStream(response as any, set, request) as any

	return mapCompactResponse(response, request)
}

const stringHeaders = isBun
	? undefined
	: {
			headers: {
				type: 'text/plain'
			}
		}

export function mapCompactResponse(
	response: unknown,
	request?: Request
): Response {
	switch (response?.constructor?.name) {
		case 'String':
			return new Response(response as string, stringHeaders)

		case 'Array':
			return Response.json(response)

		case 'Object':
			if ((response as Record<string, unknown>)['~ely-form'])
				return new Response(
					formToFormData(response as Record<string, unknown>)
				)

			return Response.json(response)

		case 'Number':
		case 'Boolean':
			return new Response((response as number | boolean).toString())

		case 'ElysiaFile':
			return handleElysiaFile(response as ElysiaFile, undefined, request)

		case 'File':
		case 'Blob':
			return handleFile(response as File, undefined, request)

		case 'ElysiaStatus':
			return mapResponse((response as ElysiaStatus<200>).response, {
				status: (response as ElysiaStatus<200>).code,
				headers: nullObject()
			})

		case undefined:
			return response ? Response.json(response) : new Response('')

		case 'Response':
			return response as Response

		case 'Error':
			return errorToResponse(response as Error)

		case 'Promise':
			return (response as any as Promise<unknown>).then((x) =>
				mapCompactResponse(x, request)
			) as any

		// ? Maybe response or Blob
		case 'Function':
			return mapCompactResponse((response as Function)(), request)

		case 'FormData':
			return new Response(response as FormData)

		default:
			return mapCompactResponseFallback(
				response,
				undefined,
				request
			) as Response
	}
}

export function errorToResponse(
	error: Error & { toResponse?(): MaybePromise<Response> },
	set?: Context['set']
) {
	if (error?.toResponse) {
		const targetSet = set ?? ({ headers: nullObject() } as Context['set'])

		const apply = (resolved: unknown) => {
			if (resolved instanceof Response) targetSet.status = resolved.status
			return mapResponse(resolved, targetSet)
		}

		const raw = error.toResponse()

		// @ts-ignore
		return typeof raw?.then === 'function' ? raw.then(apply) : apply(raw)
	}

	const headers = (set?.headers ?? nullObject()) as Record<string, string>

	return Response.json(
		{
			name: error?.name,
			message: error?.message,
			cause: error?.cause
		},
		{
			status:
				set?.status !== 200 ? ((set?.status as number) ?? 500) : 500,
			headers
		}
	)
}

function mapFallback(
	map: (
		response: unknown,
		set: Context['set'],
		request?: Request
	) => Response | undefined,
	mustReturn = true
) {
	return (
		response: unknown,
		set?: Context['set'],
		request?: Request
	): Response | undefined => {
		// recheck Response, Promise, Error because some library may extends Response
		if (response instanceof Response)
			return handleResponse(response, set, request)

		if (response instanceof Promise)
			return response.then((x) =>
				map(x, set as Context['set'], request)
			) as any

		if (response instanceof Error)
			return errorToResponse(response as Error, set)

		if (response instanceof ElysiaStatus) {
			if (set) {
				set.status = response.code
				return map(response.response, set, request)
			} else
				return mapResponse((response as ElysiaStatus<200>).response, {
					status: (response as ElysiaStatus<200>).code,
					headers: {}
				})
		}

		if (
			// @ts-expect-error
			typeof response?.next === 'function' ||
			response instanceof ReadableStream
		)
			return handleStream(response as any, set, request) as any

		if (typeof (response as Promise<unknown>)?.then === 'function')
			return (response as Promise<unknown>).then((x) =>
				map(x, set as Context['set'], request)
			) as any

		// custom class with an array-like value
		// eg. Bun.sql`` result
		if (Array.isArray(response)) return Response.json(response) as any

		// @ts-expect-error
		if (typeof response?.toResponse === 'function')
			return map(
				(response as any).toResponse(),
				set as Context['set'],
				request
			)

		// custom class with an array-like value
		// eg. Bun.sql`` result
		if (Array.isArray(response)) return Response.json(response) as any

		// @ts-expect-error
		if (response?.constructor?.name === 'Cookie' && response.jar)
			// @ts-expect-error
			return new Response(response.value, set as ResponseInit)

		// if ('charCodeAt' in (response as any)) {
		// 	const code = (response as any).charCodeAt(0)

		// 	if (code === 123 || code === 91)
		// 		return Response.json(response, set as unknown as ResponseInit)
		// }

		if (mustReturn)
			return new Response(response as any, set as ResponseInit)
	}
}

const mapResponseFallback = mapFallback(mapResponse)
const mapCompactResponseFallback = mapFallback((response, _, request) =>
	mapCompactResponse(response, request)
)

const handleResponse = createResponseHandler({
	mapResponse,
	mapCompactResponse
})

const handleStream = createStreamHandler({
	mapResponse,
	mapCompactResponse
})
