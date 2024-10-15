/* eslint-disable sonarjs/no-nested-switch */
/* eslint-disable sonarjs/no-duplicate-string */
import { serialize } from 'cookie'

import { Readable } from 'node:stream'

import { isNotEmpty, hasHeaderShorthand, StatusMap } from '../../utils'

import { Cookie } from '../../cookies'

import type { Context } from '../../context'
import type { HTTPHeaders, Prettify } from '../../types'
import { ElysiaCustomStatusResponse } from '../../error'

type SetResponse = Prettify<
	Omit<Context['set'], 'status'> & {
		status: number
	}
>

export type ElysiaNodeResponse = [
	response: unknown,
	set: Omit<Context['set'], 'headers' | 'status'> & {
		headers?: HTTPHeaders
		status: number
	}
]

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
		if (set && isNotEmpty(set.headers)) {
			if (set.headers instanceof Headers)
				if (hasHeaderShorthand)
					set.headers = (set.headers as unknown as Headers).toJSON()
				else
					for (const [key, value] of set.headers.entries())
						if (key in set.headers) set.headers[key] = value

			return new Response(response as Blob, {
				status: set.status as number,
				headers: Object.assign(
					{
						'accept-ranges': 'bytes',
						'content-range': `bytes 0-${size - 1}/${size}`
					},
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

export const serializeCookie = (cookies: Context['set']['cookie']) => {
	if (!cookies || !isNotEmpty(cookies)) return undefined

	const set: string[] = []

	for (const [key, property] of Object.entries(cookies)) {
		if (!key || !property) continue

		const value = property.value
		if (value === undefined || value === null) continue

		set.push(
			serialize(
				key,
				typeof value === 'object' ? JSON.stringify(value) : value + '',
				property
			)
		)
	}

	if (set.length === 0) return undefined
	if (set.length === 1) return set[0]

	return set
}

const handleStream = (
	generator: Generator | AsyncGenerator,
	set?: Context['set'],
	abortSignal?: AbortSignal
): ElysiaNodeResponse => {
	if (!set)
		set = {
			status: 200,
			headers: {
				'transfer-encoding': 'chunked',
				'content-type': 'text/event-stream;charset=utf-8'
			}
		}
	else {
		set.headers['transfer-encoding'] = 'chunked'
		set.headers['content-type'] = 'text/event-stream;charset=utf-8'
	}

	return [
		handleStreamResponse(generator, set, abortSignal),
		set as SetResponse
	]
}

export const handleStreamResponse = (
	generator: Generator | AsyncGenerator,
	set?: Context['set'],
	abortSignal?: AbortSignal
) => {
	const readable = new Readable({
		read() {}
	})

	;(async () => {
		let init = generator.next()
		if (init instanceof Promise) init = await init

		if (init.done) {
			if (set) return mapResponse(init.value, set, abortSignal)
			return mapCompactResponse(init.value, abortSignal)
		}

		let end = false

		abortSignal?.addEventListener('abort', () => {
			end = true

			try {
				readable.push(null)
			} catch {
				// nothing
			}
		})

		if (init.value !== undefined && init.value !== null) {
			if (typeof init.value === 'object')
				try {
					readable.push(Buffer.from(JSON.stringify(init.value)))
				} catch {
					readable.push(Buffer.from(init.value.toString()))
				}
			else readable.push(Buffer.from(init.value.toString()))
		}

		for await (const chunk of generator) {
			if (end) break
			if (chunk === undefined || chunk === null) continue

			if (typeof chunk === 'object')
				try {
					readable.push(Buffer.from(JSON.stringify(chunk)))
				} catch {
					readable.push(Buffer.from(chunk.toString()))
				}
			else readable.push(Buffer.from(chunk.toString()))

			// Wait for the next event loop
			// Otherwise the data will be mixed up
			await new Promise<void>((resolve) => setTimeout(() => resolve(), 0))
		}

		readable.push(null)
	})()

	return readable
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

export const mapResponse = (
	response: unknown,
	set: Context['set'],
	abortSignal?: AbortSignal
): ElysiaNodeResponse => {
	if (
		isNotEmpty(set.headers) ||
		set.status !== 200 ||
		set.redirect ||
		set.cookie
	) {
		if (typeof set.status === 'string') set.status = StatusMap[set.status]

		if (set.redirect) {
			set.headers.Location = set.redirect
			if (!set.status || set.status < 300 || set.status >= 400)
				set.status = 302
		}

		if (set.cookie && isNotEmpty(set.cookie)) {
			const cookie = serializeCookie(set.cookie)

			if (cookie) set.headers['set-cookie'] = cookie
		}

		switch (response?.constructor?.name) {
			case 'String':
				set.headers['content-type'] = 'text/plain;charset=utf-8'

				return [response, set as SetResponse]

			case 'Blob':
				return [response as File | Blob, set as SetResponse]

			case 'Array':
			case 'Object':
				set.headers['content-type'] = 'application/json;charset=utf-8'

				return [JSON.stringify(response), set as SetResponse]

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					abortSignal
				)

			case 'ReadableStream':
				if (
					!set.headers['content-type']?.startsWith(
						'text/event-stream'
					)
				)
					set.headers['content-type'] =
						'text/event-stream;charset=utf-8'

				abortSignal?.addEventListener(
					'abort',
					{
						handleEvent() {
							if (!abortSignal.aborted)
								(response as ReadableStream).cancel()
						}
					},
					{
						once: true
					}
				)

				return [response as ReadableStream, set as SetResponse]

			case undefined:
				if (!response) return ['', set as SetResponse]

				set.headers['content-type'] = 'application/json;charset=utf-8'

				return [response, set as SetResponse]

			case 'Response':
				let isCookieSet = false

				if (set.headers instanceof Headers)
					for (const key of set.headers.keys()) {
						if (key === 'set-cookie') {
							if (isCookieSet) continue

							isCookieSet = true

							for (const cookie of set.headers.getSetCookie()) {
								;(response as Response).headers.append(
									'set-cookie',
									cookie
								)
							}
						} else
							(response as Response).headers.append(
								key,
								set.headers?.get(key) ?? ''
							)
					}
				else
					for (const key in set.headers)
						(response as Response).headers.append(
							key,
							set.headers[key]
						)

				if ((response as Response).status !== set.status)
					set.status = (response as Response).status

				if (
					(response as Response).headers.get('transfer-encoding') ===
					'chunked'
				)
					return handleStream(
						streamResponse(response as Response),
						set,
						abortSignal
					) as any

				return [response as Response, set as SetResponse]

			case 'Error':
				return errorToResponse(response as Error, set)

			case 'Promise':
				return (response as Promise<any>).then((x) =>
					mapResponse(x, set)
				) as any

			case 'Function':
				return mapResponse((response as Function)(), set)

			case 'Number':
			case 'Boolean':
				set.headers['content-type'] = 'text/plain;charset=utf-8'

				return [
					(response as number | boolean).toString(),
					set as SetResponse
				]

			case 'Cookie':
				if (response instanceof Cookie)
					return mapResponse(response.value, set)

				return mapResponse(response?.toString(), set)

			case 'FormData':
				return [response as FormData, set as SetResponse]

			default:
				if (response instanceof Response) {
					let isCookieSet = false

					if (set.headers instanceof Headers)
						for (const key of set.headers.keys()) {
							if (key === 'set-cookie') {
								if (isCookieSet) continue

								isCookieSet = true

								for (const cookie of set.headers.getSetCookie()) {
									;(response as Response).headers.append(
										'set-cookie',
										cookie
									)
								}
							} else
								(response as Response).headers.append(
									key,
									set.headers?.get(key) ?? ''
								)
						}
					else
						for (const key in set.headers)
							(response as Response).headers.append(
								key,
								set.headers[key]
							)

					if (hasHeaderShorthand)
						set.headers = (
							(response as Response).headers as Headers
						).toJSON()
					else
						for (const [key, value] of (
							response as Response
						).headers.entries())
							if (key in set.headers) set.headers[key] = value

					return [response as Response, set as SetResponse]
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
						abortSignal
					)
				}

				// @ts-expect-error
				if (typeof response?.next === 'function')
					return handleStream(response as any, set, abortSignal)

				if ('toResponse' in (response as any))
					return mapResponse((response as any).toResponse(), set)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						if (!set.headers['Content-Type'])
							set.headers['content-type'] =
								'application/json;charset=utf-8'

						return new Response(
							JSON.stringify(response),
							set as SetResponse
						) as any
					}
				}

				return [response as any, set as SetResponse]
		}
	} else
		switch (response?.constructor?.name) {
			case 'String':
				set.headers['content-type'] = 'text/plain;charset=utf-8'

				return [response, set as SetResponse]

			case 'Blob':
				return [
					handleFile(response as File | Blob, set),
					set as SetResponse
				]

			case 'Array':
			case 'Object':
				set.headers['content-type'] = 'application/json;charset=utf-8'

				return [JSON.stringify(response), set as SetResponse]

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					abortSignal
				)

			case 'ReadableStream':
				set.headers['content-type'] = 'text/event-stream;charset=utf-8'

				abortSignal?.addEventListener(
					'abort',
					{
						handleEvent() {
							if (!abortSignal?.aborted)
								(response as ReadableStream).cancel()
						}
					},
					{
						once: true
					}
				)

				return [response as ReadableStream, set as SetResponse]

			case undefined:
				if (!response) return ['', set as SetResponse]

				set.headers['content-type'] = 'application/json;charset=utf-8'

				return [response, set as SetResponse]

			case 'Response':
				if (
					(response as Response).headers.get('transfer-encoding') ===
					'chunked'
				)
					return handleStream(
						streamResponse(response as Response),
						set,
						abortSignal
					) as any

				return [response as Response, set as SetResponse]

			case 'Error':
				return errorToResponse(response as Error, set)

			case 'Promise':
				// @ts-ignore
				return (response as any as Promise<unknown>).then((x) => {
					const r = mapCompactResponse(x, abortSignal)

					if (r !== undefined) return r

					return new Response('')
				})

			// ? Maybe response or Blob
			case 'Function':
				return mapCompactResponse((response as Function)(), abortSignal)

			case 'Number':
			case 'Boolean':
				set.headers['content-type'] = 'text/plain;charset=utf-8'

				return [
					(response as number | boolean).toString(),
					set as SetResponse
				]

			case 'Cookie':
				if (response instanceof Cookie)
					return mapResponse(response.value, set)

				return mapResponse(response?.toString(), set)

			case 'FormData':
				return [response as FormData, set as SetResponse]

			default:
				if (response instanceof Response)
					return [response, set as SetResponse]

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
						abortSignal
					)
				}

				// @ts-expect-error
				if (typeof response?.next === 'function')
					return handleStream(response as any, set, abortSignal)

				if ('toResponse' in (response as any))
					return mapResponse((response as any).toResponse(), set)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						if (!set.headers['Content-Type'])
							set.headers['content-type'] =
								'application/json;charset=utf-8'

						return new Response(
							JSON.stringify(response),
							set as SetResponse
						) as any
					}
				}

				return [response, set as SetResponse]
		}
}

export const mapEarlyResponse = (
	response: unknown,
	set: Context['set'],
	abortSignal?: AbortSignal
): ElysiaNodeResponse | undefined => {
	if (response === undefined || response === null) return

	if (
		isNotEmpty(set.headers) ||
		set.status !== 200 ||
		set.redirect ||
		set.cookie
	) {
		if (typeof set.status === 'string') set.status = StatusMap[set.status]

		if (set.redirect) {
			set.headers.Location = set.redirect

			if (!set.status || set.status < 300 || set.status >= 400)
				set.status = 302
		}

		if (set.cookie && isNotEmpty(set.cookie)) {
			const cookie = serializeCookie(set.cookie)

			if (cookie) set.headers['set-cookie'] = cookie
		}

		switch (response?.constructor?.name) {
			case 'String':
				set.headers['content-type'] = 'text/plain;charset=utf-8'

				return [response, set as SetResponse]

			case 'Blob':
				return [
					handleFile(response as File | Blob, set),
					set as SetResponse
				]

			case 'Array':
			case 'Object':
				set.headers['content-type'] = 'application/json;charset=utf-8'

				return [JSON.stringify(response), set as SetResponse]

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapEarlyResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					abortSignal
				)

			case 'ReadableStream':
				if (
					!set.headers['content-type']?.startsWith(
						'text/event-stream'
					)
				)
					set.headers['content-type'] =
						'text/event-stream;charset=utf-8'

				abortSignal?.addEventListener(
					'abort',
					{
						handleEvent() {
							if (!abortSignal?.aborted)
								(response as ReadableStream).cancel()
						}
					},
					{
						once: true
					}
				)

				return [response as ReadableStream, set as SetResponse]

			case undefined:
				if (!response) return

				set.headers['content-type'] = 'application/json;charset=utf-8'

				return [response, set as SetResponse]

			case 'Response':
				let isCookieSet = false

				if (set.headers instanceof Headers)
					for (const key of set.headers.keys()) {
						if (key === 'set-cookie') {
							if (isCookieSet) continue

							isCookieSet = true

							for (const cookie of set.headers.getSetCookie()) {
								;(response as Response).headers.append(
									'set-cookie',
									cookie
								)
							}
						} else
							(response as Response).headers.append(
								key,
								set.headers?.get(key) ?? ''
							)
					}
				else
					for (const key in set.headers)
						(response as Response).headers.append(
							key,
							set.headers[key]
						)

				if ((response as Response).status !== set.status)
					set.status = (response as Response).status

				if (
					(response as Response).headers.get('transfer-encoding') ===
					'chunked'
				)
					return handleStream(
						streamResponse(response as Response),
						set,
						abortSignal
					) as any

				return [response as Response, set as SetResponse]

			case 'Promise':
				// @ts-ignore
				return (response as Promise<unknown>).then((x) => {
					const r = mapEarlyResponse(x, set)
					if (r !== undefined) return r
				})

			case 'Error':
				return errorToResponse(response as Error, set)

			case 'Function':
				return mapEarlyResponse((response as Function)(), set)

			case 'Number':
			case 'Boolean':
				set.headers['content-type'] = 'text/plain;charset=utf-8'

				return [
					(response as number | boolean).toString(),
					set as SetResponse
				]

			case 'Cookie':
				if (response instanceof Cookie)
					return mapEarlyResponse(response.value, set)

				return mapEarlyResponse(response?.toString(), set)

			case 'FormData':
				return [response as FormData, set as SetResponse]

			default:
				if (response instanceof Response) {
					let isCookieSet = false

					if (set.headers instanceof Headers)
						for (const key of set.headers.keys()) {
							if (key === 'set-cookie') {
								if (isCookieSet) continue

								isCookieSet = true

								for (const cookie of set.headers.getSetCookie()) {
									;(response as Response).headers.append(
										'set-cookie',
										cookie
									)
								}
							} else
								(response as Response).headers.append(
									key,
									set.headers?.get(key) ?? ''
								)
						}
					else
						for (const key in set.headers)
							(response as Response).headers.append(
								key,
								set.headers[key]
							)

					if ((response as Response).status !== set.status)
						set.status = (response as Response).status

					return [response as Response, set as SetResponse]
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
						abortSignal
					)
				}

				// @ts-ignore
				if (typeof response?.next === 'function')
					return handleStream(response as any, set, abortSignal)

				if ('toResponse' in (response as any))
					return mapEarlyResponse((response as any).toResponse(), set)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						if (!set.headers['Content-Type'])
							set.headers['content-type'] =
								'application/json;charset=utf-8'

						return new Response(
							JSON.stringify(response),
							set as SetResponse
						) as any
					}
				}

				return [response, set as SetResponse]
		}
	} else
		switch (response?.constructor?.name) {
			case 'String':
				set.headers['content-type'] = 'text/plain;charset=utf-8'

				return [response, set as SetResponse]

			case 'Blob':
				return [
					handleFile(response as File | Blob, set),
					set as SetResponse
				]

			case 'Array':
			case 'Object':
				set.headers['content-type'] = 'application/json;charset=utf-8'

				return [JSON.stringify(response), set as SetResponse]

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapEarlyResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					abortSignal
				)

			case 'ReadableStream':
				set.headers['content-type'] = 'text/event-stream;charset=utf-8'

				abortSignal?.addEventListener(
					'abort',
					{
						handleEvent() {
							if (!abortSignal?.aborted)
								(response as ReadableStream).cancel()
						}
					},
					{
						once: true
					}
				)

				return [response, set as SetResponse]

			case undefined:
				if (!response) return ['', set as SetResponse]

				set.headers['content-type'] = 'application/json;charset=utf-8'

				return [response, set as SetResponse]

			case 'Response':
				if (
					(response as Response).headers.get('transfer-encoding') ===
					'chunked'
				)
					return handleStream(
						streamResponse(response as Response)
					) as any

				return [response as Response, set as SetResponse]

			case 'Promise':
				// @ts-ignore
				return (response as Promise<unknown>).then((x) => {
					const r = mapEarlyResponse(x, set)
					if (r !== undefined) return r
				})

			case 'Error':
				return errorToResponse(response as Error, set)

			case 'Function':
				return mapCompactResponse((response as Function)(), abortSignal)

			case 'Number':
			case 'Boolean':
				set.headers['content-type'] = 'text/plain;charset=utf-8'

				return [
					(response as number | boolean).toString(),
					set as SetResponse
				]

			case 'Cookie':
				if (response instanceof Cookie)
					return mapEarlyResponse(response.value, set as SetResponse)

				return mapEarlyResponse(
					response?.toString(),
					set as SetResponse
				)

			case 'FormData':
				return [response as FormData, set as SetResponse]

			default:
				if (response instanceof Response)
					return [response, set as SetResponse]

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
						abortSignal
					)
				}

				// @ts-expect-error
				if (typeof response?.next === 'function')
					return handleStream(response as any, set, abortSignal)

				if ('toResponse' in (response as any))
					return mapEarlyResponse((response as any).toResponse(), set)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						if (!set.headers['Content-Type'])
							set.headers['content-type'] =
								'application/json;charset=utf-8'

						return new Response(
							JSON.stringify(response),
							set as SetResponse
						) as any
					}
				}

				return [response as any, set as SetResponse]
		}
}

export const mapCompactResponse = (
	response: unknown,
	abortSignal?: AbortSignal
): ElysiaNodeResponse => {
	switch (response?.constructor?.name) {
		case 'String':
			return [
				new Response(response as string),
				{
					status: 200,
					headers: {
						'content-type': 'text/plain;charset=utf-8'
					}
				}
			]

		case 'Blob':
			return [
				response as File | Blob,
				{
					status: 200
				}
			]

		case 'Array':
		case 'Object':
			return [
				JSON.stringify(response),
				{
					status: 200,
					headers: {
						'content-type': 'application/json;charset=utf-8'
					}
				}
			]

		case 'ElysiaCustomStatusResponse':
			return mapResponse(
				(response as ElysiaCustomStatusResponse<200>).response,
				{
					status: (response as ElysiaCustomStatusResponse<200>).code,
					headers: {}
				}
			)

		case 'ReadableStream':
			abortSignal?.addEventListener(
				'abort',
				{
					handleEvent() {
						if (!abortSignal?.aborted)
							(response as ReadableStream).cancel()
					}
				},
				{
					once: true
				}
			)

			return [
				response as ReadableStream,
				{
					status: 200,
					headers: {
						'Content-Type': 'text/event-stream;charset=utf-8'
					}
				}
			]

		case undefined:
			if (!response)
				return [
					'',
					{
						status: 200
					}
				]

			return [
				JSON.stringify(response),
				{
					status: 200,
					headers: {
						'content-type': 'application/json'
					}
				}
			]

		case 'Response':
			if (
				(response as Response).headers.get('transfer-encoding') ===
				'chunked'
			)
				return handleStream(streamResponse(response as Response)) as any

			return [
				response as Response,
				{
					status: 200
				}
			]

		case 'Error':
			return errorToResponse(response as Error)

		case 'Promise':
			// @ts-ignore
			return (response as any as Promise<unknown>).then((x) =>
				mapCompactResponse(x, abortSignal)
			)

		// ? Maybe response or Blob
		case 'Function':
			return mapCompactResponse((response as Function)(), abortSignal)

		case 'Number':
		case 'Boolean':
			return [
				(response as number | boolean).toString(),
				{
					status: 200,
					headers: {
						'content-type': 'text/plain;charset=utf-8'
					}
				}
			]

		case 'Cookie':
			if (response instanceof Cookie)
				return mapCompactResponse(response.value)

			return [
				response?.toString(),
				{
					status: 200,
					headers: {
						'content-type': 'text/plain;charset=utf-8'
					}
				}
			]

		case 'FormData':
			return [
				response as FormData,
				{
					status: 200
				}
			]

		default:
			if (response instanceof Response) return [response, { status: 200 }]

			if (response instanceof Promise)
				return response.then((x) =>
					mapCompactResponse(x, abortSignal)
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
				return handleStream(response as any, undefined, abortSignal)

			if ('toResponse' in (response as any))
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

			return [response as any, { status: 200 }]
	}
}

export const errorToResponse = (error: Error, set?: Context['set']) =>
	[
		JSON.stringify({
			name: error?.name,
			message: error?.message,
			cause: error?.cause
		}),
		{
			status:
				set?.status !== 200 ? ((set?.status as number) ?? 500) : 500,
			headers: set?.headers
		}
	] as const satisfies ElysiaNodeResponse

export const readableStreamToReadable = (webStream: ReadableStream) =>
	new Readable({
		async read() {
			const reader = webStream.getReader()

			try {
				// eslint-disable-next-line no-constant-condition
				while (true) {
					const { done, value } = await reader.read()

					if (done) break

					this.push(Buffer.from(value))
				}
			} catch (error) {
				this.destroy(error as Error)
			}
		}
	})
