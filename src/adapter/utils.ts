import { isNotEmpty, nullObject } from '../utils'
import { StatusMap } from '../constants'

import { serializeCookie } from '../cookie/utils'
import { isBun, hasHeaderShorthand } from '../universal/constants'
import type { Context } from '../context'
import type { MaybePromise } from '../types'

const setCookie = 'set-cookie' as const

export function handleFile(
	response: File | Blob,
	set?: Context['set'],
	request?: Request
): Response {
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
						set?.headers ?? nullObject()
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
						set?.headers ?? nullObject()
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
					headers: mergeHeaders(
						rangeHeaders,
						set?.headers ?? nullObject()
					)
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
		? nullObject()
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
			if (!set.headers.has(key)) set.headers.append(key, defaultHeader[key])

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

export function parseSetCookies(headers: Headers, setCookie: string[]) {
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

export function responseToSetHeaders(response: Response, set?: Context['set']) {
	if (set?.headers) {
		if (response) {
			if (hasHeaderShorthand)
				Object.assign(set.headers, response.headers.toJSON())
			else
				for (const [key, value] of response.headers.entries())
					set.headers[key] = value
		}

		if (set.status === undefined || set.status === 200)
			set.status = response.status
	} else if (!response) {
		return {
			headers: nullObject(),
			status: set?.status ?? 200
		}
	} else if (hasHeaderShorthand) {
		set = {
			headers: response.headers.toJSON(),
			status: set?.status ?? 200
		}
	} else {
		set = {
			headers: nullObject(),
			status: set?.status ?? 200
		}

		for (const [key, value] of response.headers.entries())
			set.headers[key] = value
	}

	// ? `content-encoding` prevents response streaming
	if (set!.headers instanceof Headers) {
		if (set!.headers.has('content-encoding'))
			set!.headers.delete('content-encoding')
	} else if (set!.headers['content-encoding'])
		delete set!.headers['content-encoding']

	return set!
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
				? ArrayBuffer.isView(init.value)
					? 'application/octet-stream'
					: 'application/json'
				: 'text/plain'

		const headers = set?.headers
		if (headers) {
			if (!headers['transfer-encoding'])
				headers['transfer-encoding'] = 'chunked'
			if (!headers['content-type']) headers['content-type'] = contentType
			if (!headers['cache-control']) headers['cache-control'] = 'no-cache'
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
	// ReadableStream is async-iterable on every target runtime (verified:
	// Bun, Node 22, Deno 2, workerd 2025). NOTE: `yield*` cancels the body on
	// early termination, where the old getReader()+releaseLock() only released.
	const body = response.body
	if (body) yield* body as any
}

export function handleSet(set: Context['set']) {
	if (typeof set.status === 'string')
		set.status = StatusMap[set.status as keyof typeof StatusMap]

	// ? Handle `Elysia.headers` which is created in Context prototype
	//
	// If we assign to set.headers, it will mutate the prototype's headers
	// which cause all responses share the same headers object
	// A `Headers` instance also has a non-Object prototype, but `for..in` over
	// it yields nothing/methods and would wipe the real headers (incl.
	// Set-Cookie). Only flatten the plain object that inherits Context's
	// shared default headers.
	const proto = Object.getPrototypeOf(set.headers)
	if (
		proto !== null &&
		proto !== Object.prototype &&
		!(set.headers instanceof Headers)
	) {
		const flat: Record<string, unknown> = Object.create(null)

		for (const key in set.headers) flat[key] = set.headers[key]
		set.headers = flat as Context['set']['headers']
	}

	if (set.cookie && isNotEmpty(set.cookie)) {
		const cookie = serializeCookie(set.cookie)

		if (cookie) set.headers[setCookie] = cookie
	}

	if (set.headers[setCookie] && Array.isArray(set.headers[setCookie])) {
		set.headers = parseSetCookies(
			new Headers(set.headers as any) as Headers,
			set.headers[setCookie]
		) as any
	}
}

function applySetHeaders(
	target: Headers,
	setHeaders: Context['set']['headers'],
	present: Headers
) {
	if (setHeaders instanceof Headers)
		for (const key of setHeaders.keys()) {
			if (key === setCookie) {
				if (target.has(setCookie)) continue

				for (const cookie of setHeaders.getSetCookie())
					target.append(setCookie, cookie)
			} else if (!present.has(key))
				target.set(key, setHeaders.get(key) ?? '')
		}
	else
		for (const key in setHeaders)
			if (key === setCookie) target.append(key, setHeaders[key] as any)
			else if (!present.has(key)) target.set(key, setHeaders[key] as any)
}

export function mergeHeaders(
	responseHeaders: Headers,
	setHeaders: Context['set']['headers']
) {
	const headers = new Headers(responseHeaders)
	applySetHeaders(headers, setHeaders, responseHeaders)
	return headers
}

export function mergeStatus(
	responseStatus: number,
	setStatus: Context['set']['status']
) {
	if (typeof setStatus === 'string')
		setStatus = StatusMap[setStatus as keyof typeof StatusMap]

	if (responseStatus === 200) return setStatus

	return responseStatus
}

export const createResponseHandler = (handler: CreateHandlerParameter) => {
	const handleStream = createStreamHandler(handler)

	return (response: Response, set?: Context['set'], request?: Request) => {
		if (set) {
			const status = mergeStatus(response.status, set.status)
			const statusUnchanged =
				status === undefined || status === response.status

			if (statusUnchanged && !set.cookie && !isNotEmpty(set.headers))
				return response

			// Headers is mutable in Bun, cheaper than create a new one
			if (
				isBun &&
				statusUnchanged &&
				!set.cookie &&
				(set.headers instanceof Headers
					? !set.headers.has(setCookie)
					: set.headers[setCookie] === undefined)
			) {
				const responseHeaders = response.headers

				// In-place (target === present): no new Headers allocation on
				// the hot Bun no-status-change path. setCookie is guarded out
				// above, so that branch never fires here.
				applySetHeaders(responseHeaders, set.headers, responseHeaders)

				if (
					!responseHeaders.has('content-length') &&
					responseHeaders.get('transfer-encoding') === 'chunked'
				)
					return handleStream(
						streamResponse(response),
						responseToSetHeaders(response, set),
						request,
						true
					) as any

				return response
			}
		}

		const newResponse = new Response(
			response.body,
			set
				? {
						headers: mergeHeaders(response.headers, set.headers),
						status: mergeStatus(response.status, set.status) as any
					}
				: {
						headers: response.headers,
						status: response.status
					}
		)

		if (
			!(newResponse as Response).headers.has('content-length') &&
			(newResponse as Response).headers.get('transfer-encoding') ===
				'chunked'
		)
			return handleStream(
				streamResponse(newResponse as Response),
				responseToSetHeaders(newResponse as Response, set),
				request,
				true
			) as any

		return newResponse
	}
}

/**
 * Split async source into `branches` independent iterators
 *
 * A producer drains the source ahead of consumers
 *
 * To prevent long/infinite stream, the unconsumed window is capped:
 * Consumed-by-every-branch entries are trimmed off the front
 * Producer backpressures whenever the window hits `cap`
 * Streams shorter than `cap` buffer eagerly;
 * Only streams exceeding it gate on the slowest consumer
 *
 * Branch 0 is the value consumer (response/client)
 * When it is `return()`-ed (client abort / early exit) the source is stopped
 * so the observer branches can still reach completion instead of spinning
 * an infinite source, and so an abandoned branch never pins the window into a deadlock
 */
export async function tee<T>(
	source: AsyncIterable<T>,
	branches = 2,
	// backpressure
	cap = 64
): Promise<AsyncIterableIterator<T>[]> {
	const iterator: AsyncIterator<T> | Iterator<T> =
		(source as AsyncIterable<T>)[Symbol.asyncIterator]?.() ??
		(source as unknown as Iterable<T>)[Symbol.iterator]()

	const buffer: T[] = []
	let base = 0
	let done = false
	let stopped = false
	let waiting: { resolve: () => void }[] = []
	let drainResume: (() => void) | null = null

	const cursors: number[] = new Array(branches).fill(0)
	let active = branches

	const wake = () => {
		if (!waiting.length) return
		const woken = waiting
		waiting = []
		for (const w of woken) w.resolve()
	}

	const resumeProducer = () => {
		if (drainResume) {
			const resume = drainResume
			drainResume = null
			resume()
		}
	}

	const trim = () => {
		if (active > 0) {
			let min = Infinity
			for (const c of cursors) if (c < min) min = c
			if (min !== Infinity && min > base) {
				buffer.splice(0, min - base)
				base = min
			}
		}

		if (buffer.length < cap) resumeProducer()
	}

	;(async () => {
		try {
			while (!stopped) {
				const result = await iterator.next()
				if (result.done) break

				buffer.push(result.value)
				wake()

				if (buffer.length >= cap && active > 0 && !stopped)
					await new Promise<void>((resolve) => {
						drainResume = resolve
					})
			}
		} finally {
			done = true
			wake()
		}
	})()

	async function* makeBranch(me: number): AsyncIterableIterator<T> {
		try {
			while (true) {
				const i = cursors[me]

				if (i < base + buffer.length) {
					const value = buffer[i - base]
					cursors[me] = i + 1
					trim()
					yield value
				} else if (done) return
				else
					await new Promise<void>((resolve) =>
						waiting.push({ resolve })
					)
			}
		} finally {
			if (cursors[me] !== Infinity) {
				cursors[me] = Infinity
				active--
			}

			// Branch 0 is the value consumer
			// If aborts/returns early, stop the producer
			if (me === 0 && !stopped) {
				stopped = true
				resumeProducer()

				try {
					await iterator.return?.()
				} catch {}

				done = true
			}

			trim()
			wake()
		}
	}

	return Array.from({ length: branches }, (_, b) => makeBranch(b))
}
