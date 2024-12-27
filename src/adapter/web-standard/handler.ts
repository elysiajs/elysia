/* eslint-disable sonarjs/no-nested-switch */
/* eslint-disable sonarjs/no-duplicate-string */
import { isNotEmpty, hasHeaderShorthand, StatusMap } from '../../utils'

import { Cookie, serializeCookie } from '../../cookies'

import type { Context } from '../../context'
import type { AnyLocalHook } from '../../types'
import { ElysiaCustomStatusResponse } from '../../error'
import { ElysiaFile } from '../../universal/file'

// type SetResponse = Omit<Context['set'], 'status'> & {
// 	status: number
// }

const handleFile = (response: File | Blob, set?: Context['set']) => {
	const size = response.size

	if (
		(!set && size) ||
		(size &&
			set &&
			set.status !== 206 &&
			set.status !== 304 &&
			set.status !== 412 &&
			set.status !== 416)
	) {
		if (set) {
			if (set.headers instanceof Headers) {
				let setHeaders: Record<string, any> = {
					'accept-ranges': 'bytes',
					'content-range': `bytes 0-${size - 1}/${size}`,
					'transfer-encoding': 'chunked'
				}

				if (hasHeaderShorthand)
					setHeaders = (set.headers as unknown as Headers).toJSON()
				else {
					setHeaders = {}
					for (const [key, value] of set.headers.entries())
						if (key in set.headers) setHeaders[key] = value
				}

				return new Response(response as Blob, {
					status: set.status as number,
					headers: setHeaders
				})
			}

			if (isNotEmpty(set.headers))
				return new Response(response as Blob, {
					status: set.status as number,
					headers: Object.assign(
						{
							'accept-ranges': 'bytes',
							'content-range': `bytes 0-${size - 1}/${size}`,
							'transfer-encoding': 'chunked'
						} as any,
						set.headers
					)
				})
		}

		return new Response(response as Blob, {
			headers: {
				'accept-ranges': 'bytes',
				'content-range': `bytes 0-${size - 1}/${size}`,
				'transfer-encoding': 'chunked'
			}
		})
	}

	return new Response(response as Blob)
}

export const parseSetCookies = (headers: Headers, setCookie: string[]) => {
	if (!headers) return headers

	headers.delete('set-cookie')

	for (let i = 0; i < setCookie.length; i++) {
		const index = setCookie[i].indexOf('=')

		headers.append(
			'set-cookie',
			`${setCookie[i].slice(0, index)}=${
				setCookie[i].slice(index + 1) || ''
			}`
		)
	}

	return headers
}

const handleStream = async (
	generator: Generator | AsyncGenerator,
	set?: Context['set'],
	request?: Request
) => {
	let init = generator.next()
	if (init instanceof Promise) init = await init

	if (init.done) {
		if (set) return mapResponse(init.value, set, request)
		return mapCompactResponse(init.value, request)
	}

	return new Response(
		new ReadableStream({
			async start(controller) {
				let end = false

				request?.signal?.addEventListener('abort', () => {
					end = true

					try {
						controller.close()
					} catch {
						// nothing
					}
				})

				if (init.value !== undefined && init.value !== null) {
					if (typeof init.value === 'object')
						try {
							controller.enqueue(
								// @ts-expect-error this is a valid operation
								Buffer.from(JSON.stringify(init.value))
							)
						} catch {
							controller.enqueue(
								// @ts-expect-error this is a valid operation
								Buffer.from(init.value.toString())
							)
						}
					else
						controller.enqueue(
							// @ts-expect-error this is a valid operation
							Buffer.from(init.value.toString())
						)
				}

				for await (const chunk of generator) {
					if (end) break
					if (chunk === undefined || chunk === null) continue

					if (typeof chunk === 'object')
						try {
							controller.enqueue(
								// @ts-expect-error this is a valid operation
								Buffer.from(JSON.stringify(chunk))
							)
						} catch {
							controller.enqueue(
								// @ts-expect-error this is a valid operation
								Buffer.from(chunk.toString())
							)
						}
					else
						controller.enqueue(
							// @ts-expect-error this is a valid operation
							Buffer.from(chunk.toString())
						)

					// Wait for the next event loop
					// Otherwise the data will be mixed up
					await new Promise<void>((resolve) =>
						setTimeout(() => resolve(), 0)
					)
				}

				try {
					controller.close()
				} catch {
					// nothing
				}
			}
		}),
		{
			...(set as ResponseInit),
			headers: {
				// Manually set transfer-encoding for direct response, eg. app.handle, eden
				'transfer-encoding': 'chunked',
				'content-type': 'text/event-stream; charset=utf-8',
				...(set?.headers as any)
			}
		}
	)
}

export async function* streamResponse(response: Response) {
	const body = response.body

	if (!body) return

	const reader = body.getReader()
	const decoder = new TextDecoder()

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			yield decoder.decode(value)
		}
	} finally {
		reader.releaseLock()
	}
}

export const handleSet = (set: Context['set']) => {
	if (typeof set.status === 'string') set.status = StatusMap[set.status]

	if (set.cookie && isNotEmpty(set.cookie)) {
		const cookie = serializeCookie(set.cookie)

		if (cookie) set.headers['set-cookie'] = cookie
	}

	if (set.headers['set-cookie'] && Array.isArray(set.headers['set-cookie'])) {
		set.headers = parseSetCookies(
			new Headers(set.headers as any) as Headers,
			set.headers['set-cookie']
		) as any
	}
}

export const mergeResponseWithSetHeaders = (
	response: Response,
	set: Context['set']
) => {
	if (
		(response as Response).status !== set.status &&
		set.status !== 200 &&
		((response.status as number) <= 300 ||
			(response.status as number) > 400)
	)
		response = new Response(response.body, {
			headers: response.headers,
			status: set.status as number
		})

	let isCookieSet = false

	if (set.headers instanceof Headers)
		for (const key of set.headers.keys()) {
			if (key === 'set-cookie') {
				if (isCookieSet) continue

				isCookieSet = true

				for (const cookie of set.headers.getSetCookie())
					response.headers.append('set-cookie', cookie)
			} else response.headers.append(key, set.headers?.get(key) ?? '')
		}
	else
		for (const key in set.headers)
			(response as Response).headers.append(key, set.headers[key] as any)

	return response
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
				return new Response(response as string, set as any)

			case 'Array':
			case 'Object':
				return Response.json(response, set as any)

			case 'ElysiaFile':
				return handleFile((response as ElysiaFile).value as File)

			case 'Blob':
				return handleFile(response as Blob, set as any)

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					request
				)

			case 'ReadableStream':
				if (
					!set.headers['content-type']?.startsWith(
						'text/event-stream'
					)
				)
					set.headers['content-type'] =
						'text/event-stream; charset=utf-8'

				request?.signal?.addEventListener(
					'abort',
					{
						handleEvent() {
							if (request?.signal && !request?.signal?.aborted)
								(response as ReadableStream).cancel()
						}
					},
					{
						once: true
					}
				)

				return new Response(response as ReadableStream, set as any)

			case undefined:
				if (!response) return new Response('', set as any)

				return Response.json(response, set as any)

			case 'Response':
				response = mergeResponseWithSetHeaders(
					response as Response,
					set
				)

				if (
					(response as Response).headers.get('transfer-encoding') ===
					'chunked'
				)
					return handleStream(
						streamResponse(response as Response),
						set,
						request
					) as any

				return response as Response

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
				if (response instanceof Response) {
					response = mergeResponseWithSetHeaders(
						response as Response,
						set
					)

					if (
						(response as Response).headers.get(
							'transfer-encoding'
						) === 'chunked'
					)
						return handleStream(
							streamResponse(response as Response),
							set,
							request
						) as any

					return response as Response
				}

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

				// @ts-expect-error
				if (typeof response?.next === 'function')
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
		response instanceof ReadableStream ||
		(response instanceof Response &&
			(response as Response).headers.get('transfer-encoding') ===
				'chunked')
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
				return new Response(response as string, set as any)

			case 'Array':
			case 'Object':
				return Response.json(response, set as any)

			case 'ElysiaFile':
				return handleFile((response as ElysiaFile).value as File)

			case 'Blob':
				return handleFile(response as File | Blob, set)

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapEarlyResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					request
				)

			case 'ReadableStream':
				if (
					!set.headers['content-type']?.startsWith(
						'text/event-stream'
					)
				)
					set.headers['content-type'] =
						'text/event-stream; charset=utf-8'

				request?.signal?.addEventListener(
					'abort',
					{
						handleEvent() {
							if (request?.signal && !request?.signal?.aborted)
								(response as ReadableStream).cancel()
						}
					},
					{
						once: true
					}
				)

				return new Response(response as ReadableStream, set as any)

			case undefined:
				if (!response) return

				return Response.json(response, set as any)

			case 'Response':
				response = mergeResponseWithSetHeaders(
					response as Response,
					set
				)

				if (
					(response as Response).headers.get('transfer-encoding') ===
					'chunked'
				)
					return handleStream(
						streamResponse(response as Response),
						set,
						request
					) as any

				return response as Response

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
				if (response instanceof Response) {
					response = mergeResponseWithSetHeaders(
						response as Response,
						set
					)

					if (
						(response as Response).headers.get(
							'transfer-encoding'
						) === 'chunked'
					)
						return handleStream(
							streamResponse(response as Response),
							set,
							request
						) as any

					return response as Response
				}

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

				// @ts-expect-error
				if (typeof response?.next === 'function')
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
				return new Response(response as string)

			case 'Array':
			case 'Object':
				return Response.json(response, set as any)

			case 'ElysiaFile':
				return handleFile((response as ElysiaFile).value as File)

			case 'Blob':
				return handleFile(response as File | Blob, set)

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapEarlyResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					request
				)

			case 'ReadableStream':
				request?.signal?.addEventListener(
					'abort',
					{
						handleEvent() {
							if (request?.signal && !request?.signal?.aborted)
								(response as ReadableStream).cancel()
						}
					},
					{
						once: true
					}
				)

				return new Response(response as ReadableStream, {
					headers: {
						'Content-Type': 'text/event-stream; charset=utf-8'
					}
				})

			case undefined:
				if (!response) return new Response('')

				return new Response(JSON.stringify(response), {
					headers: {
						'content-type': 'application/json'
					}
				})

			case 'Response':
				if (
					(response as Response).headers.get('transfer-encoding') ===
					'chunked'
				)
					return handleStream(
						streamResponse(response as Response)
					) as any

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

				// @ts-expect-error
				if (typeof response?.next === 'function')
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
			return new Response(response as string)

		case 'Object':
		case 'Array':
			return Response.json(response)

		case 'ElysiaFile':
			return handleFile((response as ElysiaFile).value as File)

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

		case 'ReadableStream':
			request?.signal?.addEventListener(
				'abort',
				{
					handleEvent() {
						if (request?.signal && !request?.signal?.aborted)
							(response as ReadableStream).cancel()
					}
				},
				{
					once: true
				}
			)

			return new Response(response as ReadableStream, {
				headers: {
					'Content-Type': 'text/event-stream; charset=utf-8'
				}
			})

		case undefined:
			if (!response) return new Response('')

			return new Response(JSON.stringify(response), {
				headers: {
					'content-type': 'application/json'
				}
			})

		case 'Response':
			if (
				(response as Response).headers.get('transfer-encoding') ===
				'chunked'
			)
				return handleStream(streamResponse(response as Response)) as any

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

			// @ts-expect-error
			if (typeof response?.next === 'function')
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

export const errorToResponse = (error: Error, set?: Context['set']) =>
	new Response(
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

export const createStaticHandler = (
	handle: unknown,
	hooks: AnyLocalHook,
	setHeaders: Context['set']['headers'] = {}
): (() => Response) | undefined => {
	if (typeof handle === 'function') return

	const response = mapResponse(handle, {
		headers: setHeaders
	})

	if (
		hooks.parse.length === 0 &&
		hooks.transform.length === 0 &&
		hooks.beforeHandle.length === 0 &&
		hooks.afterHandle.length === 0
	)
		return response.clone.bind(response)
}
