import { isNotEmpty, nullObject } from '../utils'
import { StatusMap } from '../constants'

import { serializeCookie } from '../cookie/serialize'
import { isBun, hasHeaderShorthand } from '../universal/constants'
import type { Context } from '../context'

import { skipClone } from './skip-clone'

const setCookie = 'set-cookie' as const

const sseFormat = (data: string) => `data: ${data}\n\n`
const identityFormat = (data: string) => data

const textEncoder = new TextEncoder()
const encodeChunk = (s: string): Uint8Array => textEncoder.encode(s)

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
			if (!set.headers.has(key))
				set.headers.append(key, defaultHeader[key])

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

function normalizeHeaders(set: Context['set']) {
	const headers = set.headers
	if (!(headers instanceof Headers)) return

	const flat: Record<string, unknown> = Object.create(null)

	for (const [key, value] of headers) if (key !== setCookie) flat[key] = value

	const cookies = headers.getSetCookie()
	if (cookies.length) flat[setCookie] = cookies

	set.headers = flat as Context['set']['headers']
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
	if (set && set.headers instanceof Headers) normalizeHeaders(set)

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

function enqueueBinaryChunk(
	controller: ReadableStreamDefaultController,
	chunk: unknown
) {
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

export function createStreamHandler({
	mapResponse,
	mapCompactResponse
}: CreateHandlerParameter) {
	return async (
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

		if (init?.value instanceof ReadableStream)
			// @ts-ignore
			generator = init.value
		else if (init && (typeof init?.done === 'undefined' || init?.done)) {
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
				(set?.headers instanceof Headers
					? set.headers
							.get('content-type')
							?.startsWith('text/event-stream')
					: set?.headers['content-type']?.startsWith(
							'text/event-stream'
						)))

		const format = isSSE ? sseFormat : identityFormat

		const contentType = isSSE
			? 'text/event-stream'
			: init?.value && typeof init?.value === 'object'
				? ArrayBuffer.isView(init.value)
					? 'application/octet-stream'
					: 'application/json'
				: 'text/plain'

		const headers = set?.headers
		if (headers instanceof Headers) {
			if (!headers.has('transfer-encoding'))
				headers.set('transfer-encoding', 'chunked')

			if (!headers.has('content-type'))
				headers.set('content-type', contentType)

			if (!headers.has('cache-control'))
				headers.set('cache-control', 'no-cache')
		} else if (headers) {
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
		const signal = request?.signal
		let onAbort: (() => void) | undefined

		const cleanupAbort = () => {
			if (signal && onAbort) {
				signal.removeEventListener('abort', onAbort)
				onAbort = undefined
			}
		}

		const safeReturn = () => {
			try {
				const r = iterator.return?.()
				if (r && typeof (r as Promise<unknown>).then === 'function')
					(r as Promise<unknown>).catch(() => {})
			} catch {}
		}

		const closeSafely = (controller: ReadableStreamDefaultController) => {
			try {
				controller.close()
			} catch {}
			cleanupAbort()
		}

		const enqueueValue = async (
			controller: ReadableStreamDefaultController,
			value: unknown
		) => {
			// @ts-ignore
			if (value.toSSE) {
				// @ts-ignore
				controller.enqueue(encodeChunk(value.toSSE()))
				return
			}

			const p = enqueueBinaryChunk(controller, value)
			if (p !== false) return void (await p)

			if (typeof value === 'object')
				try {
					controller.enqueue(
						encodeChunk(format(JSON.stringify(value)))
					)
				} catch {
					controller.enqueue(
						encodeChunk(format((value as object).toString()))
					)
				}
			else
				controller.enqueue(encodeChunk(format((value as any).toString())))
		}

		return new Response(
			new ReadableStream({
				async start(controller) {
					if (signal) {
						onAbort = () => {
							cleanupAbort()
							end = true
							safeReturn()

							try {
								controller.close()
							} catch {}
						}

						if (signal.aborted) onAbort()
						else
							signal.addEventListener('abort', onAbort, {
								once: true
							})
					}

					if (
						!init ||
						init.value instanceof ReadableStream ||
						init.value === undefined ||
						init.value === null
					)
						return

					await enqueueValue(controller, init.value)
				},

				async pull(controller) {
					// Respect abort/cancel that happened between pull() calls.
					if (end) {
						closeSafely(controller)
						return
					}

					try {
						const { value: chunk, done } = await iterator.next()

						if (done || end) {
							closeSafely(controller)
							return
						}

						if (chunk === undefined || chunk === null) return

						await enqueueValue(controller, chunk)
					} catch (error) {
						cleanupAbort()
						controller.error(error)
					}
				},

				cancel() {
					end = true
					cleanupAbort()
					safeReturn()
				}
			}),
			set as any
		)
	}
}

export async function* streamResponse(response: Response) {
	const body = response.body
	if (body) yield* body as any
}

export function handleSet(set: Context['set']) {
	if (typeof set.status === 'string')
		set.status = StatusMap[set.status as keyof typeof StatusMap]

	if (set.headers instanceof Headers) normalizeHeaders(set)

	const proto = Object.getPrototypeOf(set.headers)
	if (proto !== null && proto !== Object.prototype) {
		const flat: Record<string, unknown> = Object.create(null)

		for (const key in set.headers) flat[key] = set.headers[key]
		set.headers = flat as Context['set']['headers']
	}

	if (set.cookie && isNotEmpty(set.cookie)) {
		const cookie = serializeCookie(set.cookie)

		if (cookie) {
			const existing = set.headers[setCookie]
			if (Array.isArray(existing))
				set.headers[setCookie] = existing.concat(cookie)
			else set.headers[setCookie] = cookie
		}
	}

	if (set.headers[setCookie] && Array.isArray(set.headers[setCookie]))
		set.headers = parseSetCookies(
			new Headers(set.headers as any) as Headers,
			set.headers[setCookie]
		) as any
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

function mergeHeaders(
	responseHeaders: Headers,
	setHeaders: Context['set']['headers']
) {
	const headers = new Headers(responseHeaders)
	applySetHeaders(headers, setHeaders, responseHeaders)

	return headers
}

function mergeStatus(
	responseStatus: number,
	setStatus: Context['set']['status']
) {
	if (typeof setStatus === 'string')
		setStatus = StatusMap[setStatus as keyof typeof StatusMap]

	if (responseStatus === 200) return setStatus

	return responseStatus
}

function cancelPropagatingBody(
	clonedBody: ReadableStream,
	orphanedBranch: ReadableStream
): ReadableStream {
	const reader = clonedBody.getReader()

	return new ReadableStream({
		async pull(controller) {
			const { done, value } = await reader.read()

			if (done) controller.close()
			else controller.enqueue(value)
		},
		cancel(reason) {
			orphanedBranch.cancel(reason)
			return reader.cancel(reason)
		}
	})
}

export function createResponseHandler(handler: CreateHandlerParameter) {
	const handleStream = createStreamHandler(handler)

	return (response: Response, set?: Context['set'], request?: Request) => {
		if (set) {
			const status = mergeStatus(response.status, set.status)
			const statusUnchanged =
				status === undefined || status === response.status

			if (statusUnchanged && !set.cookie && !isNotEmpty(set.headers))
				return response
		}

		let body = response.body

		if (skipClone.has(response) && !response.bodyUsed)
			skipClone.delete(response)
		else {
			const cloned = response.clone()
			body =
				cloned.body && response.body
					? cancelPropagatingBody(cloned.body, response.body)
					: cloned.body
		}

		const newResponse = new Response(
			body,
			set
				? {
						headers: mergeHeaders(response.headers, set.headers),
						status: mergeStatus(response.status, set.status) as any,
						statusText: response.statusText
					}
				: {
						headers: response.headers,
						status: response.status,
						statusText: response.statusText
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

const teeChunkCost = (chunk: unknown) =>
	typeof chunk === 'string'
		? chunk.length
		: ((chunk as { byteLength?: number })?.byteLength ?? 64)

const doneResult = { done: true as const, value: undefined } as const

interface Pending<T> {
	resolve: (r: IteratorResult<T>) => void
	reject: (e: unknown) => void
}

/**
 * Split async source into `branches` independent iterators
 *
 * A producer drains the source ahead of consumers
 *
 * To prevent long/infinite stream, the unconsumed window is capped:
 * Consumed-by-every-branch entries are trimmed off the front
 * Producer backpressures whenever the window hits `cap` ENTRIES or
 * `capBytes` bytes, whichever comes first
 *
 * Streams below both caps buffer eagerly
 * Only streams exceeding one gate on the slowest consumer
 *
 * Branch 0 is the value consumer (response/client)
 * When `return()` (client abort / early exit), source is stopped
 * so the observer branches can still reach completion instead of spinning
 * an infinite source
 */
export function tee<T>(
	source: AsyncIterable<T>,
	branches = 2,
	// backpressure
	cap = 64,
	capBytes = 1 << 22 // 4MiB
): AsyncIterableIterator<T>[] {
	const iterator: AsyncIterator<T> | Iterator<T> =
		(source as AsyncIterable<T>)[Symbol.asyncIterator]?.() ??
		(source as unknown as Iterable<T>)[Symbol.iterator]()

	const buffer: T[] = []
	const sizes: number[] = []
	let base = 0
	let windowBytes = 0
	let done = false
	let stopped = false
	let failed = false
	let sourceError: unknown
	let drainResume: (() => void) | null = null

	const cursors: number[] = new Array(branches).fill(0)
	let active = branches

	const pending: (Pending<T> | null)[] = new Array(branches).fill(null)

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

			// Producer is parked when the window is full,
			// window is trimmed when the slowest consumer has consumed some entries
			const consumed = min - base
			if (min !== Infinity && consumed > 0) {
				for (let i = 0; i < consumed; i++) windowBytes -= sizes[i]
				buffer.splice(0, consumed)
				sizes.splice(0, consumed)
				base = min
			}
		}

		if (buffer.length < cap && windowBytes < capBytes) resumeProducer()
	}

	const closeBranch = (me: number) => {
		if (cursors[me] === Infinity) return
		cursors[me] = Infinity
		active--

		if (me === 0 && !stopped) {
			stopped = true
			done = true
			resumeProducer()

			try {
				const r = iterator.return?.()
				if (r && typeof (r as Promise<unknown>).then === 'function')
					(r as Promise<unknown>).catch(() => {})
			} catch {}

			wakeAll()
		}

		if (active === 0) {
			buffer.length = 0
			sizes.length = 0
			windowBytes = 0
		} else trim()
	}

	const serve = (me: number, p: Pending<T>) => {
		const i = cursors[me]

		if (i === Infinity) return p.resolve(doneResult)

		if (i < base + buffer.length) {
			const value = buffer[i - base]
			cursors[me] = i + 1
			trim()
			return p.resolve({ done: false, value })
		}

		if (failed) return p.reject(sourceError)

		if (done) {
			closeBranch(me)
			return p.resolve(doneResult)
		}

		pending[me] = p
	}

	const wakeAll = () => {
		for (let b = 0; b < branches; b++) {
			const p = pending[b]
			if (!p) continue
			pending[b] = null
			serve(b, p)
		}
	}

	;(async () => {
		try {
			while (!stopped) {
				const result = await iterator.next()
				if (result.done || stopped) break

				buffer.push(result.value)
				sizes.push(teeChunkCost(result.value))
				windowBytes += sizes[sizes.length - 1]
				wakeAll()

				if (
					(buffer.length >= cap || windowBytes >= capBytes) &&
					active > 0 &&
					!stopped
				)
					await new Promise<void>((resolve) => {
						drainResume = resolve
					})
			}
		} catch (error) {
			failed = true
			sourceError = error
		} finally {
			done = true
			wakeAll()
		}
	})()

	const makeBranch = (me: number): AsyncIterableIterator<T> => ({
		[Symbol.asyncIterator]() {
			return this
		},

		next: () =>
			new Promise<IteratorResult<T>>((resolve, reject) =>
				serve(me, { resolve, reject })
			),

		// Synchronous-effect return, see the tee() doc comment
		return: (value?: unknown) => {
			const p = pending[me]
			if (p) {
				pending[me] = null
				p.resolve(doneResult)
			}

			closeBranch(me)

			return Promise.resolve({ done: true as const, value: value as T })
		},

		throw: (error?: unknown) => {
			const p = pending[me]
			if (p) {
				pending[me] = null
				p.resolve(doneResult)
			}

			closeBranch(me)

			return Promise.reject(error)
		}
	})

	return Array.from({ length: branches }, (_, b) => makeBranch(b))
}
