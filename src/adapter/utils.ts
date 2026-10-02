import { isByteStream, isNotEmpty, nullObject, sseData } from '../utils'
import { StatusMap } from '../constants'

import { serializeCookie } from '../cookie/serialize'
import { hasHeaderShorthand } from '../universal/constants'
import type { ElysiaFile } from '../universal/file'
import type { Context } from '../context'

import { skipClone } from './skip-clone'
import { isBorrowedResponse } from './response-ownership'
import { defaultHeaders } from './default-headers'

const setCookie = 'set-cookie' as const

export function materializeSetHeaders(set: Context['set']) {
	const headers = set.headers
	if ((headers as any)[defaultHeaders] !== headers) return headers

	return (set.headers = Object.assign(nullObject(), headers))
}

const sseFormat = (data: string) => sseData(data) + '\n'
const identityFormat = (data: string) => data

const textEncoder = new TextEncoder()

export function normalizeContentType(contentType: string) {
	if (contentType === 'application/json') return contentType

	const end = contentType.indexOf(';')
	return (end === -1 ? contentType : contentType.slice(0, end))
		.trim()
		.toLowerCase()
}

export function handleFile(
	response: File | Blob | ElysiaFile,
	set?: Context['set'],
	request?: Request,
	size = (response as File | Blob).size
): Response {
	const rangeHeader = request?.headers.get('range')
	if (rangeHeader) {
		const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
		if (match) {
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

			if ((!match[1] && !match[2]) || start >= size || start > end)
				return new Response(null, {
					status: 416,
					headers: mergeHeaders(
						new Headers({ 'content-range': `bytes */${size}` }),
						set?.headers ?? nullObject()
					)
				})

			const contentLength = end - start + 1
			const rangeHeaders = new Headers({
				'accept-ranges': 'bytes',
				'content-range': `bytes ${start}-${end}/${size}`,
				'content-length': String(contentLength)
			})

			return new Response(
				(response as any).slice(start, end + 1, response.type),
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

	const body = 'value' in response ? response.value : response

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

	if (!set && !size) return new Response(body as Blob)

	if (!set)
		return new Response(body as Blob, {
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

		return new Response(body as Blob, set as any)
	}

	return new Response(body as Blob, {
		status: set.status as number,
		headers: Object.assign(defaultHeader, set.headers)
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

	for (let i = 0; i < setCookie.length; i++)
		headers.append('set-cookie', setCookie[i])

	return headers
}

export function responseToSetHeaders(response: Response, set?: Context['set']) {
	if (set && set.headers instanceof Headers) normalizeHeaders(set)
	if (set) materializeSetHeaders(set)

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
	if (set!.headers['content-encoding'])
		delete set!.headers['content-encoding']

	return set!
}

interface CreateHandlerParameter {
	mapResponse(
		response: unknown,
		set: Context['set'],
		request?: Request,
		owned?: boolean
	): Response
	mapCompactResponse(
		response: unknown,
		request?: Request,
		owned?: boolean
	): Response
}

export function createStreamHandler({
	mapResponse,
	mapCompactResponse
}: CreateHandlerParameter) {
	return async (
		generator: Generator | AsyncGenerator | ReadableStream,
		set?: Context['set'],
		request?: Request,
		skipFormat?: boolean,
		owned = false
	) => {
		// Internal preparation marker; valid public requests still map normally.
		if (request === null) return undefined!

		if (isByteStream(generator)) {
			if (generator.locked)
				throw new TypeError(
					'Cannot transfer a locked or consumed byte stream'
				)

			if (set) {
				handleSet(set)
				const headers = materializeSetHeaders(set)

				if (headers instanceof Headers) {
					if (!headers.has('content-type'))
						headers.set('content-type', 'application/octet-stream')
				} else if (!headers['content-type'])
					headers['content-type'] = 'application/octet-stream'

				return new Response(generator, set as ResponseInit)
			}

			return new Response(generator, {
				headers: { 'content-type': 'application/octet-stream' }
			})
		}

		const typedSSE =
			!skipFormat && 'sse' in generator && (generator as any).sse === true
		const sourceIterator =
			typeof (generator as any).next === 'function'
				? (generator as AsyncIterator<unknown>)
				: undefined

		// Since ReadableStream doesn't have next, init might be undefined
		let init = (
			typedSSE ? undefined : (generator as Generator).next?.()
		) as IteratorResult<unknown> | undefined

		if (set) handleSet(set)
		if (init instanceof Promise) init = await init

		const yieldedStream = init?.value instanceof ReadableStream
		if (yieldedStream)
			// @ts-ignore
			generator = init.value
		else if (init && (typeof init?.done === 'undefined' || init?.done)) {
			if (set) return mapResponse(init.value, set, request, owned)
			return mapCompactResponse(init.value, request, owned)
		}

		// Check if stream is from a pre-formatted Response body
		const isSSE =
			typedSSE ||
			(!skipFormat &&
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
							))))

		const format = isSSE ? sseFormat : identityFormat

		const contentType = isSSE
			? 'text/event-stream'
			: init?.value && typeof init?.value === 'object'
				? ArrayBuffer.isView(init.value)
					? 'application/octet-stream'
					: 'application/json'
				: 'text/plain'

		if (set) materializeSetHeaders(set)
		const headers = set?.headers
		if (headers instanceof Headers) {
			if (!typedSSE && !headers.has('transfer-encoding'))
				headers.set('transfer-encoding', 'chunked')

			if (!headers.has('content-type'))
				headers.set('content-type', contentType)

			if (!headers.has('cache-control'))
				headers.set('cache-control', 'no-cache')
		} else if (headers) {
			if (!typedSSE && !headers['transfer-encoding'])
				headers['transfer-encoding'] = 'chunked'
			if (!headers['content-type']) headers['content-type'] = contentType
			if (!headers['cache-control']) headers['cache-control'] = 'no-cache'
		} else if (typedSSE)
			set = {
				status: 200,
				headers: {
					'content-type': contentType,
					'cache-control': 'no-cache'
				}
			}
		else
			set = {
				status: 200,
				headers: {
					'content-type': contentType,
					'transfer-encoding': 'chunked',
					'cache-control': 'no-cache',
					connection: 'keep-alive'
				}
			}

		const sourceStream =
			generator instanceof ReadableStream ? generator : undefined
		let streamReader:
			| {
					read(): Promise<IteratorResult<unknown>>
					cancel(): Promise<void>
					releaseLock(): void
			  }
			| undefined
		const iterator: AsyncIterator<unknown> = sourceStream
			? {
					next: () =>
						(streamReader ??= sourceStream.getReader()).read(),
					async return() {
						if (!streamReader) {
							await sourceStream.cancel()

							return { done: true, value: undefined }
						}

						try {
							await streamReader.cancel()
						} finally {
							streamReader.releaseLock()
						}

						return { done: true, value: undefined }
					}
				}
			: (sourceIterator ?? (generator as any)[Symbol.asyncIterator]())
		const outerIterator =
			yieldedStream && !init!.done ? sourceIterator : undefined

		let end = false
		let finalizing: Promise<void> | undefined
		const signal = request?.signal
		let onAbort: (() => void) | undefined

		const cleanupAbort = () => {
			if (signal && onAbort) {
				signal.removeEventListener('abort', onAbort)
				onAbort = undefined
			}
		}

		const safeReturn = async (target?: AsyncIterator<unknown>) => {
			try {
				await target?.return?.()
			} catch {}
		}

		const finalize = (
			mode: 'close' | 'error',
			controller?: ReadableStreamDefaultController,
			error?: unknown
		) => {
			if (end) return finalizing

			end = true
			cleanupAbort()
			finalizing = safeReturn(iterator).then(() =>
				safeReturn(outerIterator)
			)

			if (!controller) return finalizing

			try {
				if (mode === 'error') controller.error(error)
				else controller.close()
			} catch {}
		}

		// Synchronous except for a Blob, whose bytes arrive later: an async
		// function here cost a Promise and an await per chunk
		const enqueueValue = (
			controller: ReadableStreamDefaultController,
			value: unknown
		): Promise<void> | undefined => {
			// @ts-ignore
			if (value.toSSE) {
				// @ts-ignore
				controller.enqueue(textEncoder.encode(value.toSSE()))
				return
			}

			let p: Promise<void> | boolean
			if (value instanceof Blob)
				p = value.arrayBuffer().then((buffer) => {
					controller.enqueue(new Uint8Array(buffer))
				})
			else if (value instanceof Uint8Array) {
				controller.enqueue(value)
				p = true
			} else if (value instanceof ArrayBuffer) {
				controller.enqueue(new Uint8Array(value))
				p = true
			} else if (ArrayBuffer.isView(value)) {
				controller.enqueue(
					new Uint8Array(
						value.buffer,
						value.byteOffset,
						value.byteLength
					)
				)
				p = true
			} else p = false

			if (p !== false) return p === true ? undefined : p

			if (typeof value === 'object')
				try {
					controller.enqueue(
						textEncoder.encode(format(JSON.stringify(value)))
					)
				} catch {
					controller.enqueue(
						textEncoder.encode(format((value as object).toString()))
					)
				}
			else
				controller.enqueue(
					textEncoder.encode(format((value as any).toString()))
				)
		}

		return new Response(
			new ReadableStream(
				{
					start(controller) {
						if (signal) {
							onAbort = () => finalize('close', controller)

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

						const fail = (error: unknown) => {
							finalize('error', controller, error)
						}

						try {
							return enqueueValue(controller, init.value)?.catch(
								fail
							)
						} catch (error) {
							fail(error)
						}
					},

					pull(controller) {
						// Respect abort/cancel that happened between pull() calls.
						if (end) return

						const fail = (error: unknown) => {
							finalize('error', controller, error)
						}

						// `null` / `undefined` are skipped; returning without an
						// enqueue would leave the stream waiting for a pull
						// that never comes
						const step = (
							result: IteratorResult<unknown>
						): Promise<void> | undefined => {
							while (true) {
								if (result.done || end) {
									finalize('close', controller)
									return
								}

								const chunk = result.value
								if (chunk !== undefined && chunk !== null)
									return enqueueValue(controller, chunk)

								const next = iterator.next() as
									| IteratorResult<unknown>
									| Promise<IteratorResult<unknown>>
								if (
									typeof (next as Promise<unknown>).then ===
									'function'
								)
									return Promise.resolve(next).then(step)

								result = next as IteratorResult<unknown>
							}
						}

						// A sync generator steps without a microtask per chunk
						try {
							const next = iterator.next() as
								| IteratorResult<unknown>
								| Promise<IteratorResult<unknown>>

							// a custom async iterator may hand back any thenable
							return (
								typeof (next as Promise<unknown>).then ===
								'function'
									? Promise.resolve(next).then(step)
									: step(next as IteratorResult<unknown>)
							)?.catch(fail)
						} catch (error) {
							fail(error)
						}
					},

					cancel() {
						finalize('close')
					}
				},
				typedSSE ? { highWaterMark: 0 } : undefined
			),
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

		for (const key of Object.keys(set.headers)) flat[key] = set.headers[key]
		set.headers = flat as Context['set']['headers']
	}

	if (set.cookie && isNotEmpty(set.cookie)) {
		materializeSetHeaders(set)
		const cookie = serializeCookie(set.cookie)

		if (cookie) {
			const existing = set.headers[setCookie] as
				| string
				| string[]
				| undefined

			if (existing) {
				const kept =
					typeof existing === 'string' ? [existing] : existing
				const added = (
					typeof cookie === 'string' ? [cookie] : cookie
				).filter((value) => !kept.includes(value))

				set.headers[setCookie] = (
					added.length ? kept.concat(added) : existing
				) as any
			} else set.headers[setCookie] = cookie
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
	if (setHeaders instanceof Headers) {
		const incoming = setHeaders.getSetCookie()
		if (incoming.length) {
			const cookies = target.getSetCookie()
			for (const cookie of incoming)
				if (!cookies.includes(cookie)) {
					target.append(setCookie, cookie)
					cookies.push(cookie)
				}
		}

		for (const key of setHeaders.keys())
			if (key !== setCookie && !present.has(key))
				target.set(key, setHeaders.get(key) ?? '')
	} else {
		let cookies: string[] | undefined
		for (const key of Object.keys(setHeaders))
			if (key === setCookie) {
				const cookie = setHeaders[key] as string
				cookies ??= target.getSetCookie()
				if (!cookies.includes(cookie)) {
					target.append(key, cookie)
					cookies.push(cookie)
				}
			} else if (!present.has(key))
				target.set(key, setHeaders[key] as any)
	}
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
	orphanedBranch: ReadableStream,
	preserveOrphan = false
) {
	const reader = clonedBody.getReader()

	return new ReadableStream({
		async pull(controller) {
			const { done, value } = await reader.read()

			if (done) controller.close()
			else controller.enqueue(value)
		},
		cancel(reason) {
			if (preserveOrphan) {
				// Tee waits for every branch before resolving cancellation
				// Detach this response while leaving the owner reusable branch intact
				reader.cancel(reason).catch(() => {})
				return
			}

			orphanedBranch.cancel(reason)
			return reader.cancel(reason)
		}
	})
}

export function createResponseHandler(handler: CreateHandlerParameter) {
	const handleStream = createStreamHandler(handler)

	return (
		response: Response,
		set?: Context['set'],
		request?: Request,
		owned = false
	) => {
		// Framework-fresh Response (error/static clone-at-source): single-owner
		if (skipClone.has(response) && !response.bodyUsed) {
			skipClone.delete(response)
			owned = true
		}

		const explicitlyBorrowed = isBorrowedResponse(response)
		const borrowed = !owned || explicitlyBorrowed
		const mustClone = owned && explicitlyBorrowed

		if (!borrowed && response.bodyUsed)
			throw new TypeError(
				'Cannot reuse a consumed Response across requests'
			)

		let status: Context['set']['status']

		if (set) {
			status = mergeStatus(response.status, set.status)
			const statusUnchanged =
				status === undefined || status === response.status

			if (
				!mustClone &&
				statusUnchanged &&
				!set.cookie &&
				!isNotEmpty(set.headers)
			)
				return response
		} else if (!mustClone) return response

		if (!borrowed && response.body?.locked)
			throw new TypeError('Cannot patch a Response whose body is locked')

		let body = response.body

		if (borrowed) {
			const cloned = response.clone()

			body =
				cloned.body && response.body
					? cancelPropagatingBody(
							cloned.body,
							response.body,
							explicitlyBorrowed
						)
					: cloned.body
		}

		const newResponse = new Response(
			body,
			set
				? {
						headers: mergeHeaders(response.headers, set.headers),
						status: status as any,
						statusText: response.statusText
					}
				: {
						headers: response.headers,
						status: response.status,
						statusText: response.statusText
					}
		)

		if (
			borrowed &&
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

function teeChunkCost(chunk: unknown) {
	if (typeof chunk === 'string') return chunk.length
	if (typeof chunk !== 'object' || chunk === null) return 64

	const byteLength = (chunk as { byteLength?: number }).byteLength
	if (typeof byteLength === 'number') return byteLength

	const size = (chunk as { size?: number }).size
	if (typeof size === 'number') return size

	return 64
}

const doneResult = { done: true as const, value: undefined } as const

interface Pending<T> {
	resolve: (r: IteratorResult<T>) => void
	reject: (e: unknown) => void
}

/**
 * A returned `ReadableStream` is consumed after the handler returns, so
 * afterResponse, `defer()` and derive dispose must wait for it the way a tee'd
 * generator is waited on
 *
 * A returned `Response` is not observed, reading `.body` would move
 * every Response on these routes off Bun's native send path; a `bytes()`
 * stream keeps its exact-stream contract and releases early as before
 */
export function observeStream(
	source: ReadableStream
):
	| [ReadableStream, AsyncIterable<unknown>, AsyncIterableIterator<unknown>]
	| undefined {
	if (source.locked || isByteStream(source)) return

	const reader = source.getReader()
	const [value, observer] = tee({
		[Symbol.asyncIterator]: () => ({
			next: () => reader.read() as Promise<IteratorResult<unknown>>,
			return: (reason?: unknown) =>
				reader
					.cancel(reason)
					.then(() => ({ done: true, value: undefined }))
		})
	})

	const body = new ReadableStream(
		{
			async pull(controller) {
				try {
					const result = await value.next()
					if (result.done) controller.close()
					else controller.enqueue(result.value)
				} catch (error) {
					controller.error(error)
				}
			},
			cancel(reason) {
				return value.return?.(reason) as Promise<void> | undefined
			}
		},
		{ highWaterMark: 0 }
	)

	if ((source as any).sse === true) (body as any).sse = true

	// the value branch, stopped by an exit that never sends `body`
	return [body, observer, value]
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

	const makeBranch = (me: number): AsyncIterableIterator<T> =>
		Object.assign(Object.create(null) as AsyncIterableIterator<T>, {
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

				return Promise.resolve({
					done: true as const,
					value: value as T
				})
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
