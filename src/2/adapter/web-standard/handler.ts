/* eslint-disable sonarjs/no-nested-switch */
/* eslint-disable sonarjs/no-duplicate-string */
import {
	createResponseHandler,
	createStreamHandler,
	handleFile,
	handleSet
} from '../utils'

import { ElysiaFile, mime } from '../../universal/file'
import { isNotEmpty } from '../../utils'
import { Cookie } from '../../cookie'
import { ElysiaStatus } from '../../error'

import type { Context } from '../../context'
import type { AnyLocalHook, MaybePromise } from '../../types'
import { isBun } from '../../universal/utils'

const type = 'content-type' as const

function handleElysiaFile(
	file: ElysiaFile,
	set: Context['set'] = {
		headers: {}
	},
	request?: Request
) {
	const path = file.path
	const contentType =
		mime[path.slice(path.lastIndexOf('.') + 1) as any as keyof typeof mime]

	const headers = set.headers
	if (contentType) headers[type] = contentType

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
				if (isNotBun && !headers[type]) headers[type] = 'text/plain'

				return new Response(response as string, set as ResponseInit)

			case 'Array':
			case 'Object':
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

			case 'Cookie':
				if (response instanceof Cookie)
					return new Response(response.value, set as ResponseInit)

				return new Response(response?.toString(), set as ResponseInit)

			case 'FormData':
				return new Response(response as FormData, set as ResponseInit)

			default:
				return mapResponseFallback(response, set, request) as Response
		}
	}

	// Stream response defers a 'set' API, assume that it may include 'set'
	if (
		// @ts-expect-error
		typeof response?.next === 'function' ||
		response instanceof ReadableStream
	)
		return handleStream(response as any, set, request) as any

	return mapCompactResponse(response, request)
}

export function mapEarlyResponse(
	response: unknown,
	set: Context['set'],
	request?: Request
): Response | undefined {
	if (response === undefined || response === null) return

	const headers = set.headers
	const hasSet = isNotEmpty(headers) || set.status !== 200 || set.cookie
	if (hasSet) handleSet(set)

	switch (response?.constructor?.name) {
		case 'String':
			if (isNotBun && !headers[type]) headers[type] = 'text/plain'

			return new Response(
				response as string,
				hasSet ? (set as ResponseInit) : undefined
			)

		case 'Array':
		case 'Object':
			return Response.json(response, set as ResponseInit)

		case 'Number':
		case 'Boolean':
			return new Response(
				(response as number | boolean).toString(),
				hasSet ? (set as ResponseInit) : undefined
			)

		case 'ElysiaFile':
			return handleElysiaFile(response as ElysiaFile, set, request)

		case 'File':
		case 'Blob':
			return handleFile(response as File | Blob, set, request)

		case 'ElysiaStatus':
			set.status = (response as ElysiaStatus<200>).code

			return mapEarlyResponse(
				(response as ElysiaStatus<200>).response,
				set,
				request
			)

		case undefined:
			if (response) return Response.json(response, set as ResponseInit)

			return

		case 'Response':
			return hasSet
				? handleResponse(response as Response, set, request)
				: (response as Response)

		case 'Promise':
			return (response as Promise<unknown>).then((x) => {
				const r = mapEarlyResponse(x, set)
				if (r !== undefined) return r
			}) as any

		case 'Error':
			return errorToResponse(response as Error, set)

		case 'Function':
			return hasSet
				? mapEarlyResponse((response as Function)(), set, request)
				: mapCompactResponse((response as Function)(), request)

		case 'FormData':
			return new Response(response as FormData)

		case 'Cookie':
			if (response instanceof Cookie)
				return new Response(response.value, set as ResponseInit)

			return new Response(response?.toString(), set as ResponseInit)

		default:
			return mapEarlyResponseFallback(response, set, request)
	}
}

export function mapCompactResponse(
	response: unknown,
	request?: Request
): Response {
	switch (response?.constructor?.name) {
		case 'String':
			return new Response(
				response as string,
				isBun
					? undefined
					: {
							headers: {
								type: 'text/plain'
							}
						}
			)

		case 'Object':
		case 'Array':
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
				headers: {}
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
		const targetSet =
			set ?? ({ headers: {}, redirect: '' } as Context['set'])

		const apply = (resolved: unknown) => {
			if (resolved instanceof Response) targetSet.status = resolved.status
			return mapResponse(resolved, targetSet)
		}

		const raw = error.toResponse()

		// @ts-ignore
		return typeof raw?.then === 'function' ? raw.then(apply) : apply(raw)
	}

	return Response.json(
		{
			name: error?.name,
			message: error?.message,
			cause: error?.cause
		},
		{
			status:
				set?.status !== 200 ? ((set?.status as number) ?? 500) : 500,
			headers: set?.headers as any
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

		if ('charCodeAt' in (response as any)) {
			const code = (response as any).charCodeAt(0)

			if (code === 123 || code === 91)
				return Response.json(response, set as unknown as ResponseInit)
		}

		if (mustReturn)
			return new Response(response as any, set as ResponseInit)
	}
}

const mapResponseFallback = mapFallback(mapResponse)
const mapEarlyResponseFallback = mapFallback(mapEarlyResponse, false)
const mapCompactResponseFallback = mapFallback((response, set, request) =>
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
