import { serializeCookie } from '../cookies'
import { hasHeaderShorthand, isNotEmpty, StatusMap } from '../utils'

import type { Context } from '../context'
import { isBun } from '../universal/utils'

export const handleFile = (
	response: File | Blob,
	set?: Context['set']
): Response => {
	if (!isBun && response instanceof Promise)
		return response.then((res) => handleFile(res, set)) as any

	const size = response.size
	const immutable =
		set &&
		(set.status === 206 ||
			set.status === 304 ||
			set.status === 412 ||
			set.status === 416)

	const defaultHeader = immutable
		? ({
				'transfer-encoding': 'chunked'
			} as Record<string, string>)
		: ({
				'accept-ranges': 'bytes',
				'content-range': size
					? `bytes 0-${size - 1}/${size}`
					: undefined,
				'transfer-encoding': 'chunked'
			} as Record<string, string>)

	if (!set && !size) return new Response(response as Blob)

	if (!set)
		return new Response(response as Blob, {
			headers: defaultHeader
		})

	if (set.headers instanceof Headers) {
		for (const key of Object.keys(defaultHeader))
			if (key in set.headers) set.headers.append(key, defaultHeader[key])

		if (immutable) {
			set.headers.delete('content-length')
			set.headers.delete('accept-ranges')
		}

		return new Response(response as Blob, set as any)
	}

	if (isNotEmpty(set.headers))
		return new Response(response as Blob, {
			status: set.status as number,
			headers: Object.assign(defaultHeader, set.headers)
		})

	return new Response(response as Blob, {
		status: set.status as number,
		headers: defaultHeader
	})
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

export const responseToSetHeaders = (
	response: Response,
	set?: Context['set']
) => {
	if (set?.headers) {
		if (response) {
			if (hasHeaderShorthand)
				Object.assign(set.headers, response.headers.toJSON())
			else
				for (const [key, value] of response.headers.entries())
					if (key in set.headers) set.headers[key] = value
		}

		if (set.status === 200) set.status = response.status

		// ? `content-encoding` prevent response streaming
		if (set.headers['content-encoding'])
			delete set.headers['content-encoding']

		return set
	}

	if (!response)
		return {
			headers: {},
			status: set?.status ?? 200
		}

	if (hasHeaderShorthand) {
		set = {
			headers: response.headers.toJSON(),
			status: set?.status ?? 200
		}

		// ? `content-encoding` prevent response streaming
		if (set.headers['content-encoding'])
			delete set.headers['content-encoding']

		return set
	}

	set = {
		headers: {},
		status: set?.status ?? 200
	}

	for (const [key, value] of response.headers.entries()) {
		// ? `content-encoding` prevent response streaming

		if (key === 'content-encoding') continue

		if (key in set.headers) set.headers[key] = value
	}

	return set
}

type CreateHandlerParameter = {
	mapResponse(
		response: unknown,
		set: Context['set'],
		request?: Request
	): Response
	mapCompactResponse(response: unknown, request?: Request): Response
}

export const createStreamHandler =
	({ mapResponse, mapCompactResponse }: CreateHandlerParameter) =>
	async (
		generator: Generator | AsyncGenerator | ReadableStream,
		set?: Context['set'],
		request?: Request
	) => {
		// Since ReadableStream doesn't have next, init might be undefined
		let init = (generator as Generator).next?.() as
			| IteratorResult<unknown>
			| undefined

		if (init instanceof Promise) init = await init

		// Generator or ReadableStream is returned from a generator function
		if (init?.value instanceof ReadableStream) {
			// @ts-ignore
			generator = init.value
		} else if (init && (typeof init?.done === 'undefined' || init?.done)) {
			if (set) return mapResponse(init.value, set, request)
			return mapCompactResponse(init.value, request)
		}

		const isSSE =
			// @ts-ignore First SSE result is wrapped with sse()
			init?.value?.sse ??
			// @ts-ignore ReadableStream is wrapped with sse()
			generator?.sse ??
			// User explicitly set content-type to SSE
			set?.headers['content-type']?.startsWith('text/event-stream')

		const format = isSSE
			? (data: string) => `data: ${data}\n\n`
			: (data: string) => data

		const contentType = isSSE
			? 'text/event-stream'
			: init?.value && typeof init?.value === 'object'
				? 'application/json'
				: 'text/plain'

		if (set?.headers) {
			if (!set.headers['transfer-encoding'])
				set.headers['transfer-encoding'] = 'chunked'
			if (!set.headers['content-type'])
				set.headers['content-type'] = contentType
			if (!set.headers['cache-control'])
				set.headers['cache-control'] = 'no-cache'
		} else
			set = {
				status: 200,
				headers: {
					'content-type': contentType,
					'transfer-encoding': 'chunked',
					'cache-control': 'no-cache',
					connection: 'keep-alive'
				}
			}

		return new Response(
			new ReadableStream({
				async start(controller) {
					let end = false

					request?.signal?.addEventListener('abort', () => {
						end = true

						try {
							controller.close()
						} catch {}
					})

					if (!init || init.value instanceof ReadableStream) {
					} else if (
						init.value !== undefined &&
						init.value !== null
					) {
						// @ts-ignore
						if (init.value.toSSE)
							// @ts-ignore
							controller.enqueue(init.value.toSSE())
						else if (typeof init.value === 'object')
							try {
								controller.enqueue(
									format(JSON.stringify(init.value))
								)
							} catch {
								controller.enqueue(
									format(init.value.toString())
								)
							}
						else controller.enqueue(format(init.value.toString()))
					}

					try {
						for await (const chunk of generator) {
							if (end) break
							if (chunk === undefined || chunk === null) continue

							// @ts-ignore
							if (chunk.toSSE) {
								// @ts-ignore
								controller.enqueue(chunk.toSSE())
							} else {
								if (typeof chunk === 'object')
									try {
										controller.enqueue(
											format(JSON.stringify(chunk))
										)
									} catch {
										controller.enqueue(
											format(chunk.toString())
										)
									}
								else
									controller.enqueue(format(chunk.toString()))

								if (!isSSE)
									/**
									 * Wait for the next event loop
									 * otherwise the data will be mixed up
									 *
									 * @see https://github.com/elysiajs/elysia/issues/741
									 */
									await new Promise<void>((resolve) =>
										setTimeout(() => resolve(), 0)
									)
							}
						}
					} catch (error) {
						console.warn(error)
					}

					try {
						controller.close()
					} catch {
						// nothing
					}
				}
			}),
			set as any
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

			if (typeof value === 'string') yield value
			else yield decoder.decode(value)
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

export const createResponseHandler = (handler: CreateHandlerParameter) => {
	const handleStream = createStreamHandler(handler)

	return (response: Response, set: Context['set'], request?: Request) => {
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
				(response as Response).headers.append(
					key,
					set.headers[key] as any
				)

		const status = set.status ?? 200

		if (
			(response as Response).status !== status &&
			status !== 200 &&
			((response.status as number) <= 300 ||
				(response.status as number) > 400)
		)
			return response.text().then((value) => {
				const newResponse = new Response(value, {
					headers: response.headers,
					status: set.status as number
				})

				if (
					!(newResponse as Response).headers.has('content-length') &&
					(newResponse as Response).headers.get(
						'transfer-encoding'
					) === 'chunked'
				)
					return handleStream(
						streamResponse(newResponse as Response),
						responseToSetHeaders(newResponse as Response, set),
						request
					) as any

				return newResponse
			})

		if (
			!(response as Response).headers.has('content-length') &&
			(response as Response).headers.get('transfer-encoding') ===
				'chunked'
		)
			return handleStream(
				streamResponse(response as Response),
				responseToSetHeaders(response as Response, set),
				request
			) as any

		return response
	}
}
