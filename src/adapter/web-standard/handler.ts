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
import { Cookie } from '../../cookies'
import { ElysiaCustomStatusResponse } from '../../error'

import type { Context } from '../../context'
import type { AnyLocalHook } from '../../types'

const handleElysiaFile = (
	file: ElysiaFile,
	set: Context['set'] = {
		headers: {}
	}
) => {
	const path = file.path
	const contentType =
		mime[path.slice(path.lastIndexOf('.') + 1) as any as keyof typeof mime]

	if (contentType) set.headers['content-type'] = contentType

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
				set.headers['content-range'] = `bytes 0-${size - 1}/${size}`
				set.headers['content-length'] = size
			}

			return handleFile(file.value as any, set)
		}) as any

	return handleFile(file.value as any, set)
}

export const mapResponse = (
	response: unknown,
	set: Context['set'],
	request?: Request
): Response => {
	if (isNotEmpty(set.headers) || set.status !== 200 || set.cookie) {
		handleSet(set)

		switch (response?.constructor?.name) {
			case 'String':
				set.headers['content-type'] = 'text/plain'
				return new Response(response as string, set as any)

			case 'Array':
			case 'Object':
				set.headers['content-type'] = 'application/json'
				return new Response(JSON.stringify(response), set as any)

			case 'ElysiaFile':
				return handleElysiaFile(response as ElysiaFile, set)

			case 'File':
				return handleFile(response as File, set)

			case 'Blob':
				return handleFile(response as Blob, set)

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					request
				)

			case undefined:
				if (!response) return new Response('', set as any)

				return new Response(JSON.stringify(response), set as any)

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

			case 'Number':
			case 'Boolean':
				return new Response(
					(response as number | boolean).toString(),
					set as any
				)

			case 'Cookie':
				if (response instanceof Cookie)
					return new Response(response.value, set as any)

				return new Response(response?.toString(), set as any)

			case 'FormData':
				return new Response(response as FormData, set as any)

			default:
				// recheck Response, Promise, Error because some library may extends Response
				if (response instanceof Response)
					return handleResponse(response as Response, set, request)

				if (response instanceof Promise)
					return response.then((x) => mapResponse(x, set)) as any

				if (response instanceof Error)
					return errorToResponse(response as Error, set)

				if (response instanceof ElysiaCustomStatusResponse) {
					set.status = (
						response as ElysiaCustomStatusResponse<200>
					).code

					return mapResponse(
						(response as ElysiaCustomStatusResponse<200>).response,
						set,
						request
					)
				}

				if (
					// @ts-expect-error
					typeof response?.next === 'function' ||
					response instanceof ReadableStream
				)
					return handleStream(response as any, set, request) as any

				// @ts-expect-error
				if (typeof response?.then === 'function')
					// @ts-expect-error
					return response.then((x) => mapResponse(x, set)) as any

				// @ts-expect-error
				if (typeof response?.toResponse === 'function')
					return mapResponse((response as any).toResponse(), set)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						if (!set.headers['Content-Type'])
							set.headers['Content-Type'] = 'application/json'

						return new Response(
							JSON.stringify(response),
							set as any
						) as any
					}
				}

				return new Response(response as any, set as any)
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

export const mapEarlyResponse = (
	response: unknown,
	set: Context['set'],
	request?: Request
): Response | undefined => {
	if (response === undefined || response === null) return

	if (isNotEmpty(set.headers) || set.status !== 200 || set.cookie) {
		handleSet(set)

		switch (response?.constructor?.name) {
			case 'String':
				set.headers['content-type'] = 'text/plain'
				return new Response(response as string, set as any)

			case 'Array':
			case 'Object':
				set.headers['content-type'] = 'application/json'
				return new Response(JSON.stringify(response), set as any)

			case 'ElysiaFile':
				return handleElysiaFile(response as ElysiaFile, set)

			case 'File':
				return handleFile(response as File, set)

			case 'Blob':
				return handleFile(response as File | Blob, set)

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapEarlyResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					request
				)

			case undefined:
				if (!response) return

				return new Response(JSON.stringify(response), set as any)

			case 'Response':
				return handleResponse(response as Response, set, request)

			case 'Promise':
				// @ts-ignore
				return (response as Promise<unknown>).then((x) =>
					mapEarlyResponse(x, set)
				)

			case 'Error':
				return errorToResponse(response as Error, set)

			case 'Function':
				return mapEarlyResponse((response as Function)(), set)

			case 'Number':
			case 'Boolean':
				return new Response(
					(response as number | boolean).toString(),
					set as any
				)

			case 'FormData':
				return new Response(response as FormData)

			case 'Cookie':
				if (response instanceof Cookie)
					return new Response(response.value, set as any)

				return new Response(response?.toString(), set as any)

			default:
				if (response instanceof Response)
					return handleResponse(response, set, request)

				if (response instanceof Promise)
					return response.then((x) => mapEarlyResponse(x, set)) as any

				if (response instanceof Error)
					return errorToResponse(response as Error, set)

				if (response instanceof ElysiaCustomStatusResponse) {
					set.status = (
						response as ElysiaCustomStatusResponse<200>
					).code

					return mapEarlyResponse(
						(response as ElysiaCustomStatusResponse<200>).response,
						set,
						request
					)
				}

				if (
					// @ts-expect-error
					typeof response?.next === 'function' ||
					response instanceof ReadableStream
				)
					return handleStream(response as any, set, request) as any

				// @ts-expect-error
				if (typeof response?.then === 'function')
					// @ts-expect-error
					return response.then((x) => mapEarlyResponse(x, set)) as any

				// @ts-expect-error
				if (typeof response?.toResponse === 'function')
					return mapEarlyResponse((response as any).toResponse(), set)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						if (!set.headers['Content-Type'])
							set.headers['Content-Type'] = 'application/json'

						return new Response(
							JSON.stringify(response),
							set as any
						) as any
					}
				}

				return new Response(response as any, set as any)
		}
	} else
		switch (response?.constructor?.name) {
			case 'String':
				set.headers['content-type'] = 'text/plain'
				return new Response(response as string)

			case 'Array':
			case 'Object':
				set.headers['content-type'] = 'application/json'
				return new Response(JSON.stringify(response), set as any)

			case 'ElysiaFile':
				return handleElysiaFile(response as ElysiaFile, set)

			case 'File':
				return handleFile(response as File, set)

			case 'Blob':
				return handleFile(response as File | Blob, set)

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapEarlyResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					request
				)

			case undefined:
				if (!response) return new Response('')

				return new Response(JSON.stringify(response), {
					headers: {
						'content-type': 'application/json'
					}
				})

			case 'Response':
				return response as Response

			case 'Promise':
				// @ts-ignore
				return (response as Promise<unknown>).then((x) => {
					const r = mapEarlyResponse(x, set)
					if (r !== undefined) return r
				})

			case 'Error':
				return errorToResponse(response as Error, set)

			case 'Function':
				return mapCompactResponse((response as Function)(), request)

			case 'Number':
			case 'Boolean':
				return new Response((response as number | boolean).toString())

			case 'Cookie':
				if (response instanceof Cookie)
					return new Response(response.value, set as any)

				return new Response(response?.toString(), set as any)

			case 'FormData':
				return new Response(response as FormData)

			default:
				if (response instanceof Response) return response

				if (response instanceof Promise)
					return response.then((x) => mapEarlyResponse(x, set)) as any

				if (response instanceof Error)
					return errorToResponse(response as Error, set)

				if (response instanceof ElysiaCustomStatusResponse) {
					set.status = (
						response as ElysiaCustomStatusResponse<200>
					).code

					return mapEarlyResponse(
						(response as ElysiaCustomStatusResponse<200>).response,
						set,
						request
					)
				}

				if (
					// @ts-expect-error
					typeof response?.next === 'function' ||
					response instanceof ReadableStream
				)
					return handleStream(response as any, set, request) as any

				// @ts-expect-error
				if (typeof response?.then === 'function')
					// @ts-expect-error
					return response.then((x) => mapEarlyResponse(x, set)) as any

				// @ts-expect-error
				if (typeof response?.toResponse === 'function')
					return mapEarlyResponse((response as any).toResponse(), set)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						if (!set.headers['Content-Type'])
							set.headers['Content-Type'] = 'application/json'

						return new Response(
							JSON.stringify(response),
							set as any
						) as any
					}
				}

				return new Response(response as any)
		}
}

export const mapCompactResponse = (
	response: unknown,
	request?: Request
): Response => {
	switch (response?.constructor?.name) {
		case 'String':
			return new Response(response as string, {
				headers: {
					'Content-Type': 'text/plain'
				}
			})

		case 'Object':
		case 'Array':
			return new Response(JSON.stringify(response), {
				headers: {
					'Content-Type': 'application/json'
				}
			})

		case 'ElysiaFile':
			return handleElysiaFile(response as ElysiaFile)

		case 'File':
			return handleFile(response as File)

		case 'Blob':
			return handleFile(response as File | Blob)

		case 'ElysiaCustomStatusResponse':
			return mapResponse(
				(response as ElysiaCustomStatusResponse<200>).response,
				{
					status: (response as ElysiaCustomStatusResponse<200>).code,
					headers: {}
				}
			)

		case undefined:
			if (!response) return new Response('')

			return new Response(JSON.stringify(response), {
				headers: {
					'content-type': 'application/json'
				}
			})

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

		case 'Number':
		case 'Boolean':
			return new Response((response as number | boolean).toString())

		case 'FormData':
			return new Response(response as FormData)

		default:
			if (response instanceof Response) return response

			if (response instanceof Promise)
				return response.then((x) =>
					mapCompactResponse(x, request)
				) as any

			if (response instanceof Error)
				return errorToResponse(response as Error)

			if (response instanceof ElysiaCustomStatusResponse)
				return mapResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					{
						status: (response as ElysiaCustomStatusResponse<200>)
							.code,
						headers: {}
					}
				)

			if (
				// @ts-expect-error
				typeof response?.next === 'function' ||
				response instanceof ReadableStream
			)
				return handleStream(response as any, undefined, request) as any

			// @ts-expect-error
			if (typeof response?.then === 'function')
				// @ts-expect-error
				return response.then((x) => mapResponse(x, set)) as any

			// @ts-expect-error
			if (typeof response?.toResponse === 'function')
				return mapCompactResponse((response as any).toResponse())

			if ('charCodeAt' in (response as any)) {
				const code = (response as any).charCodeAt(0)

				if (code === 123 || code === 91) {
					return new Response(JSON.stringify(response), {
						headers: {
							'Content-Type': 'application/json'
						}
					}) as any
				}
			}

			return new Response(response as any)
	}
}

export const errorToResponse = (error: Error, set?: Context['set']) => {
	// @ts-expect-error
	if (typeof error?.toResponse === 'function') {
		// @ts-expect-error
		const raw = error.toResponse()
		const targetSet =
			set ?? ({ headers: {}, status: 200, redirect: '' } as Context['set'])
		const apply = (resolved: unknown) => {
			if (resolved instanceof Response) targetSet.status = resolved.status
			return mapResponse(resolved, targetSet)
		}

		return typeof raw?.then === 'function'
			? raw.then(apply)
			: apply(raw)
	}

	return new Response(
		JSON.stringify({
			name: error?.name,
			message: error?.message,
			cause: error?.cause
		}),
		{
			status:
				set?.status !== 200 ? ((set?.status as number) ?? 500) : 500,
			headers: set?.headers as any
		}
	)
}

export const createStaticHandler = (
	handle: unknown,
	hooks: Partial<AnyLocalHook>,
	setHeaders: Context['set']['headers'] = {}
): (() => Response) | undefined => {
	if (typeof handle === 'function') return

	const response = mapResponse(handle, {
		headers: setHeaders
	})

	if (
		!hooks.parse?.length &&
		!hooks.transform?.length &&
		!hooks.beforeHandle?.length &&
		!hooks.afterHandle?.length
	)
		return () => response.clone() as Response
}

const handleResponse = createResponseHandler({
	mapResponse,
	mapCompactResponse
})

const handleStream = createStreamHandler({
	mapResponse,
	mapCompactResponse
})
