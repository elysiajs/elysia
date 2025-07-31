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

	if (
		size ||
		(set &&
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
		generator: Generator | AsyncGenerator,
		set?: Context['set'],
		request?: Request
	) => {
		let init = generator.next()
		if (init instanceof Promise) init = await init

		if (typeof init?.done === 'undefined' || init?.done) {
			if (set) return mapResponse(init.value, set, request)
			return mapCompactResponse(init.value, request)
		}

		const contentType =
			// @ts-ignore
			init.value && typeof init.value?.stream
				? 'text/event-stream'
				: init.value && typeof init.value === 'object'
					? 'application/json'
					: 'text/plain'

		if (set?.headers) {
			if (!set.headers['transfer-encoding'])
				set.headers['transfer-encoding'] = 'chunked'
			if (!set.headers['content-type'])
				set.headers['content-type'] = contentType
			if (!set.headers['cache-control'])
				set.headers['cache-control'] = 'no-cache'
		} else {
			set = {
				status: 200,
				headers: {
					'content-type': contentType,
					'transfer-encoding': 'chunked',
					'cache-control': 'no-cache',
					connection: 'keep-alive'
				}
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
						} catch {
							// nothing
						}
					})

					if (init.value !== undefined && init.value !== null) {
						// @ts-ignore
						if (init.value.toStream)
							// @ts-ignore
							controller.enqueue(init.value.toStream())
						else if (typeof init.value === 'object')
							try {
								controller.enqueue(
									Buffer.from(JSON.stringify(init.value))
								)
							} catch {
								controller.enqueue(
									Buffer.from(init.value.toString())
								)
							}
						else
							controller.enqueue(
								Buffer.from(init.value.toString())
							)
					}

					for await (const chunk of generator) {
						if (end) break
						if (chunk === undefined || chunk === null) continue

						// @ts-ignore
						if (chunk.toStream)
							// @ts-ignore
							controller.enqueue(chunk.toStream())
						else if (typeof chunk === 'object')
							try {
								controller.enqueue(
									Buffer.from(JSON.stringify(chunk))
								)
							} catch {
								controller.enqueue(
									Buffer.from(chunk.toString())
								)
							}
						else controller.enqueue(Buffer.from(chunk.toString()))

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
