import { serializeCookie } from '../cookies'
import { hasHeaderShorthand, isNotEmpty, StatusMap } from '../utils'

import type { Context } from '../context'
import { env } from '../universal'
import { isBun } from '../universal/utils'
import { MaybePromise } from '../types'

export const handleFile = (
	response: File | Blob,
	set?: Context['set'],
	request?: Request
): Response => {
	if (!isBun && response instanceof Promise)
		return response.then((res) => handleFile(res, set, request)) as any

	const size = response.size

	const rangeHeader = request?.headers.get('range')
	if (rangeHeader) {
		const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
		if (match) {
			if (!match[1] && !match[2])
				return new Response(null, {
					status: 416,
					headers: mergeHeaders(
						new Headers({ 'content-range': `bytes */${size}` }),
						set?.headers ?? {}
					)
				})

			let start: number
			let end: number

			if (!match[1] && match[2]) {
				const suffix = parseInt(match[2])
				start = Math.max(0, size - suffix)
				end = size - 1
			} else {
				start = match[1] ? parseInt(match[1]) : 0
				end = match[2]
					? Math.min(parseInt(match[2]), size - 1)
					: size - 1
			}

			if (start >= size || start > end) {
				return new Response(null, {
					status: 416,
					headers: mergeHeaders(
						new Headers({ 'content-range': `bytes */${size}` }),
						set?.headers ?? {}
					)
				})
			}

			const contentLength = end - start + 1
			const rangeHeaders = new Headers({
				'accept-ranges': 'bytes',
				'content-range': `bytes ${start}-${end}/${size}`,
				'content-length': String(contentLength)
			})

			// Blob.slice() exists at runtime but is absent from the ESNext lib typings
			// (no DOM lib). Cast through unknown to the minimal interface we need.
			// Pass response.type as third arg so the sliced blob preserves MIME type.
			return new Response(
				(
					response as unknown as {
						slice(
							start: number,
							end: number,
							contentType?: string
						): Blob
					}
				).slice(start, end + 1, response.type),
				{
					status: 206,
					headers: mergeHeaders(rangeHeaders, set?.headers ?? {})
				}
			)
		}
	}

	const immutable =
		set &&
		(set.status === 206 ||
			set.status === 304 ||
			set.status === 412 ||
			set.status === 416)

	const defaultHeader = immutable
		? {}
		: ({
				'accept-ranges': 'bytes',
				'content-range': size
					? `bytes 0-${size - 1}/${size}`
					: undefined
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

interface CreateHandlerParameter {
	mapResponse(
		response: unknown,
		set: Context['set'],
		request?: Request
	): Response
	mapCompactResponse(response: unknown, request?: Request): Response
}

const enqueueBinaryChunk = (
	controller: ReadableStreamDefaultController,
	chunk: unknown
): MaybePromise<boolean> => {
	if (chunk instanceof Blob)
		return chunk.arrayBuffer().then((buffer) => {
			controller.enqueue(new Uint8Array(buffer))
			return true as const
		})

	if (chunk instanceof Uint8Array) {
		controller.enqueue(chunk)
		return true
	}

	if (chunk instanceof ArrayBuffer) {
		controller.enqueue(new Uint8Array(chunk))
		return true
	}

	if (ArrayBuffer.isView(chunk)) {
		controller.enqueue(
			new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
		)
		return true
	}

	return false
}

export const createStreamHandler =
	({ mapResponse, mapCompactResponse }: CreateHandlerParameter) =>
	async (
		generator: Generator | AsyncGenerator | ReadableStream,
		set?: Context['set'],
		request?: Request,
		skipFormat?: boolean
	) => {
		// Since ReadableStream doesn't have next, init might be undefined
		let init = (generator as Generator).next?.() as
			| IteratorResult<unknown>
			| undefined

		if (set) handleSet(set)
		if (init instanceof Promise) init = await init

		// Generator or ReadableStream is returned from a generator function
		if (init?.value instanceof ReadableStream) {
			// @ts-ignore
			generator = init.value
		} else if (init && (typeof init?.done === 'undefined' || init?.done)) {
			if (set) return mapResponse(init.value, set, request)
			return mapCompactResponse(init.value, request)
		}

		// Check if stream is from a pre-formatted Response body
		const isSSE =
			!skipFormat &&
			// @ts-ignore First SSE result is wrapped with sse()
			(init?.value?.sse ??
				// @ts-ignore ReadableStream is wrapped with sse()
				generator?.sse ??
				// User explicitly set content-type to SSE
				set?.headers['content-type']?.startsWith('text/event-stream'))

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

		// Plain ReadableStream (not SSE, not a generator) can be passed through
		// directly. Re-wrapping it would add per-chunk async overhead (#1741)
		// and break the native cancel callback (#1768).
		if (
			!isSSE &&
			generator instanceof ReadableStream &&
			typeof (generator as any).next !== 'function'
		)
			return new Response(
				generator.pipeThrough(
					new TransformStream({
						transform(chunk, controller) {
							if (
								chunk instanceof Uint8Array ||
								chunk instanceof ArrayBuffer ||
								typeof chunk === 'string'
							)
								controller.enqueue(chunk)
							else if (ArrayBuffer.isView(chunk))
								controller.enqueue(
									new Uint8Array(
										chunk.buffer,
										chunk.byteOffset,
										chunk.byteLength
									)
								)
							else if (chunk instanceof Blob)
								return chunk
									.arrayBuffer()
									.then((buf) =>
										controller.enqueue(
											new Uint8Array(buf)
										)
									)
							else
								controller.enqueue(
									typeof chunk === 'object'
										? JSON.stringify(chunk)
										: String(chunk)
								)
						}
					})
				),
				set as any
			)

		// Get an explicit async iterator so pull() can advance one step at a time.
		// Generators already implement the iterator protocol directly (.next()),
		// while ReadableStream (which generator may be reassigned to above) needs
		// [Symbol.asyncIterator]() to produce one.
		const iterator: AsyncIterator<unknown> =
			typeof (generator as any).next === 'function'
				? (generator as AsyncIterator<unknown>)
				: (generator as any)[Symbol.asyncIterator]()

		let end = false

		return new Response(
			new ReadableStream({
				start(controller) {
					// Register abort handler once — terminates the iterator and
					// closes the stream so pull() won't be called again.
					request?.signal?.addEventListener('abort', () => {
						end = true
						iterator.return?.()

						try {
							controller.close()
						} catch {}
					})

					// Enqueue the already-extracted init value (first generator
					// result, used above for SSE detection). Subsequent values
					// are produced on-demand by pull().
					if (
						!init ||
						init.value instanceof ReadableStream ||
						init.value === undefined ||
						init.value === null
					)
						return

					// @ts-ignore
					if (init.value.toSSE)
						// @ts-ignore
						controller.enqueue(init.value.toSSE())
					else if (enqueueBinaryChunk(controller, init.value)) return
					else if (typeof init.value === 'object')
						try {
							controller.enqueue(
								format(JSON.stringify(init.value))
							)
						} catch {
							controller.enqueue(format(init.value.toString()))
						}
					else controller.enqueue(format(init.value.toString()))
				},

				async pull(controller) {
					// Respect abort/cancel that happened between pull() calls.
					if (end) {
						try {
							controller.close()
						} catch {}
						return
					}

					try {
						const { value: chunk, done } = await iterator.next()

						if (done || end) {
							try {
								controller.close()
							} catch {}
							return
						}

						// null/undefined chunks are skipped; the runtime will
						// call pull() again since nothing was enqueued.
						if (chunk === undefined || chunk === null) return

						// @ts-ignore
						if (chunk.toSSE)
							// @ts-ignore
							controller.enqueue(chunk.toSSE())
						else if (enqueueBinaryChunk(controller, chunk)) return
						else if (typeof chunk === 'object')
							try {
								controller.enqueue(
									format(JSON.stringify(chunk))
								)
							} catch {
								controller.enqueue(format(chunk.toString()))
							}
						else controller.enqueue(format(chunk.toString()))
					} catch (error) {
						console.warn(error)

						try {
							controller.close()
						} catch {}
					}
				},

				cancel() {
					end = true
					iterator.return?.()
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

// Merge header by allocating a new one
// In Bun, response.headers can be mutable
// while in Node and Cloudflare Worker is not
// default to creating a new one instead
export function mergeHeaders(
	responseHeaders: Headers,
	setHeaders: Context['set']['headers']
) {
	// Direct clone preserves all headers including multiple set-cookie
	const headers = new Headers(responseHeaders)

	// Merge headers: Response headers take precedence, set.headers fill in non-conflicting ones
	if (setHeaders instanceof Headers)
		for (const key of setHeaders.keys()) {
			if (key === 'set-cookie') {
				if (headers.has('set-cookie')) continue

				for (const cookie of setHeaders.getSetCookie())
					headers.append('set-cookie', cookie)
			} else if (!responseHeaders.has(key))
				headers.set(key, setHeaders?.get(key) ?? '')
		}
	else
		for (const key in setHeaders)
			if (key === 'set-cookie')
				headers.append(key, setHeaders[key] as any)
			else if (!responseHeaders.has(key))
				headers.set(key, setHeaders[key] as any)

	return headers
}

export function mergeStatus(
	responseStatus: number,
	setStatus: Context['set']['status']
) {
	if (typeof setStatus === 'string') setStatus = StatusMap[setStatus]

	if (responseStatus === 200) return setStatus

	return responseStatus
}

export const createResponseHandler = (handler: CreateHandlerParameter) => {
	const handleStream = createStreamHandler(handler)

	return (response: Response, set: Context['set'], request?: Request) => {
		const newResponse = new Response(response.body, {
			headers: mergeHeaders(response.headers, set.headers),
			status: mergeStatus(response.status, set.status)
		})

		if (
			!(newResponse as Response).headers.has('content-length') &&
			(newResponse as Response).headers.get('transfer-encoding') ===
				'chunked'
		)
			return handleStream(
				streamResponse(newResponse as Response),
				responseToSetHeaders(newResponse as Response, set),
				request,
				true // don't auto-format SSE for pre-formatted Response
			) as any

		return newResponse
	}
}

export async function tee<T>(
	source: AsyncIterable<T>,
	branches = 2
): Promise<AsyncIterableIterator<T>[]> {
	const buffer: T[] = []
	let done = false
	let waiting: { resolve: () => void }[] = []

	;(async () => {
		for await (const value of source) {
			buffer.push(value)
			waiting.forEach((w) => w.resolve())
			waiting = []
		}
		done = true
		waiting.forEach((w) => w.resolve())
	})()

	async function* makeIterator(): AsyncIterableIterator<T> {
		let i = 0
		while (true) {
			if (i < buffer.length) {
				yield buffer[i++]
			} else if (done) {
				return
			} else {
				await new Promise<void>((resolve) => waiting.push({ resolve }))
			}
		}
	}

	return Array.from({ length: branches }, makeIterator)
}
