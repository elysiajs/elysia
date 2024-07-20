/* eslint-disable sonarjs/no-nested-switch */
/* eslint-disable sonarjs/no-duplicate-string */
import { serialize } from 'cookie'
import { StatusMap, form } from './utils'

import { Cookie } from './cookies'
import { ELYSIA_RESPONSE } from './error'

import type { Context } from './context'

const hasHeaderShorthand = 'toJSON' in new Headers()

type SetResponse = Omit<Context['set'], 'status'> & {
	status: number
}

export const isNotEmpty = (obj?: Object) => {
	if (!obj) return false

	for (const x in obj) return true

	return false
}

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
				'content-range': `bytes 0-${size - 1}/${size}`
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

// const concatUint8Array = (a: Uint8Array, b: Uint8Array) => {
// 	const arr = new Uint8Array(a.length + b.length)
// 	arr.set(a, 0)
// 	arr.set(b, a.length)

// 	return arr
// }
const handleStream = async (
	generator: Generator | AsyncGenerator,
	set?: Context['set'],
	request?: Request
) => {
	let init
	try {
		init = generator.next()
		if (init instanceof Promise) init = await init

		if (init.done) {
			if (set) return mapResponse(init.value, set, request)
			return mapCompactResponse(init.value, request)
		}
	} catch (error) {
		// TODO should call app.onError if set
		if (set) return mapResponse(error, set, request)
		return mapCompactResponse(error, request)
	}

	return new Response(
		new ReadableStream({
			async start(controller) {
				let end = false

				request?.signal.addEventListener('abort', () => {
					end = true

					try {
						controller.close()
					} catch {
						// nothing
					}
				})

				if (init.value !== undefined && init.value !== null)
					controller.enqueue(
						Buffer.from(
							`event: message\ndata: ${JSON.stringify(init.value)}\n\n`
						)
					)

				try {
					for await (const chunk of generator) {
						if (end) break
						if (chunk === undefined || chunk === null) continue

						controller.enqueue(
							Buffer.from(
								`event: message\ndata: ${JSON.stringify(chunk)}\n\n`
							)
						)
					}
				} catch (error: any) {
					controller.enqueue(
						Buffer.from(
							`event: error\ndata: ${JSON.stringify(error.message || error.name || 'Error')}\n\n`
						)
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
				...set?.headers
			}
		}
	)
}

export const mapResponse = (
	response: unknown,
	set: Context['set'],
	request?: Request
): Response => {
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

		if (
			set.headers['set-cookie'] &&
			Array.isArray(set.headers['set-cookie'])
		) {
			set.headers = parseSetCookies(
				new Headers(set.headers) as Headers,
				set.headers['set-cookie']
			) as any
		}

		switch (response?.constructor?.name) {
			case 'String':
				return new Response(response as string, set as SetResponse)

			case 'Blob':
				return handleFile(response as File | Blob, set)

			case 'Array':
				return Response.json(response, set as SetResponse)

			case 'Object':
				// @ts-ignore
				const status = response[ELYSIA_RESPONSE]
				if (status) {
					set.status = status

					// @ts-ignore
					return mapResponse(response.response, set, request)
				}

				for (const value in Object.values(response as Object)) {
					switch (value?.constructor?.name) {
						case 'Blob':
						case 'File':
						case 'ArrayBuffer':
						case 'FileRef':
							return new Response(form(response as any))

						default:
							break
					}
				}

				return Response.json(response, set as SetResponse)

			case 'ReadableStream':
				if (
					!set.headers['content-type']?.startsWith(
						'text/event-stream'
					)
				)
					set.headers['content-type'] =
						'text/event-stream; charset=utf-8'

				request?.signal.addEventListener(
					'abort',
					{
						handleEvent() {
							if (!request?.signal.aborted)
								(response as ReadableStream).cancel(request)
						}
					},
					{
						once: true
					}
				)

				return new Response(
					response as ReadableStream,
					set as SetResponse
				)

			case undefined:
				if (!response) return new Response('', set as SetResponse)

				return Response.json(response, set as SetResponse)

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

				return response as Response

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
				return new Response(
					(response as number | boolean).toString(),
					set as SetResponse
				)

			case 'Cookie':
				if (response instanceof Cookie)
					return new Response(response.value, set as SetResponse)

				return new Response(response?.toString(), set as SetResponse)

			case 'FormData':
				return new Response(response as FormData, set as SetResponse)

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

					return response as Response
				}

				if (response instanceof Promise)
					return response.then((x) => mapResponse(x, set)) as any

				if (response instanceof Error)
					return errorToResponse(response as Error, set)

				// @ts-expect-error
				if (typeof response?.next === 'function')
					// @ts-expect-error
					return handleStream(response as any, set, request)

				if ('toResponse' in (response as any))
					return mapResponse((response as any).toResponse(), set)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						if (!set.headers['Content-Type'])
							set.headers['Content-Type'] = 'application/json'

						return new Response(
							JSON.stringify(response),
							set as SetResponse
						) as any
					}
				}

				return new Response(response as any, set as SetResponse)
		}
	} else
		switch (response?.constructor?.name) {
			case 'String':
				return new Response(response as string)

			case 'Blob':
				return handleFile(response as File | Blob, set)

			case 'Array':
				return Response.json(response)

			case 'Object':
				// @ts-ignore
				const status = response[ELYSIA_RESPONSE]
				if (status) {
					set.status = status

					// @ts-ignore
					return mapResponse(response.response, set, request)
				}

				for (const value in Object.values(response as Object)) {
					switch (value?.constructor?.name) {
						case 'Blob':
						case 'File':
						case 'ArrayBuffer':
						case 'FileRef':
							return new Response(
								form(response as any),
								set as SetResponse
							)

						default:
							break
					}
				}

				return Response.json(response, set as SetResponse)

			case 'ReadableStream':
				request?.signal.addEventListener(
					'abort',
					{
						handleEvent() {
							if (!request?.signal.aborted)
								(response as ReadableStream).cancel(request)
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
				return response as Response

			case 'Error':
				return errorToResponse(response as Error, set)

			case 'Promise':
				// @ts-ignore
				return (response as any as Promise<unknown>).then((x) => {
					const r = mapCompactResponse(x, request)

					if (r !== undefined) return r

					return new Response('')
				})

			// ? Maybe response or Blob
			case 'Function':
				return mapCompactResponse((response as Function)(), request)

			case 'Number':
			case 'Boolean':
				return new Response((response as number | boolean).toString())

			case 'Cookie':
				if (response instanceof Cookie)
					return new Response(response.value, set as SetResponse)

				return new Response(response?.toString(), set as SetResponse)

			case 'FormData':
				return new Response(response as FormData, set as SetResponse)

			default:
				if (response instanceof Response)
					return new Response(response.body, {
						headers: {
							'Content-Type': 'application/json'
						}
					})

				if (response instanceof Promise)
					return response.then((x) => mapResponse(x, set)) as any

				if (response instanceof Error)
					return errorToResponse(response as Error, set)

				// @ts-expect-error
				if (typeof response?.next === 'function')
					// @ts-expect-error
					return handleStream(response as any, set, request)

				if ('toResponse' in (response as any))
					return mapResponse((response as any).toResponse(), set)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						if (!set.headers['Content-Type'])
							set.headers['Content-Type'] = 'application/json'

						return new Response(
							JSON.stringify(response),
							set as SetResponse
						) as any
					}
				}

				return new Response(response as any)
		}
}

export const mapEarlyResponse = (
	response: unknown,
	set: Context['set'],
	request?: Request
): Response | undefined => {
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

		if (
			set.headers['set-cookie'] &&
			Array.isArray(set.headers['set-cookie'])
		)
			set.headers = parseSetCookies(
				new Headers(set.headers) as Headers,
				set.headers['set-cookie']
			) as any

		switch (response?.constructor?.name) {
			case 'String':
				return new Response(response as string, set as SetResponse)

			case 'Blob':
				return handleFile(response as File | Blob, set)

			case 'Array':
				return Response.json(response, set as SetResponse)

			case 'Object':
				// @ts-ignore
				const status = response[ELYSIA_RESPONSE]
				if (status) {
					set.status = status

					// @ts-ignore
					return mapEarlyResponse(response.response, set, request)
				}

				for (const value in Object.values(response as Object)) {
					switch (value?.constructor?.name) {
						case 'Blob':
						case 'File':
						case 'ArrayBuffer':
						case 'FileRef':
							return new Response(
								form(response as any),
								set as SetResponse
							)

						default:
							break
					}
				}

				return Response.json(response, set as SetResponse)

			case 'ReadableStream':
				if (
					!set.headers['content-type']?.startsWith(
						'text/event-stream'
					)
				)
					set.headers['content-type'] =
						'text/event-stream; charset=utf-8'

				request?.signal.addEventListener(
					'abort',
					{
						handleEvent() {
							if (!request?.signal.aborted)
								(response as ReadableStream).cancel(request)
						}
					},
					{
						once: true
					}
				)

				return new Response(
					response as ReadableStream,
					set as SetResponse
				)

			case undefined:
				if (!response) return

				return Response.json(response, set as SetResponse)

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
				return mapEarlyResponse((response as Function)(), set)

			case 'Number':
			case 'Boolean':
				return new Response(
					(response as number | boolean).toString(),
					set as SetResponse
				)

			case 'FormData':
				return new Response(response as FormData)

			case 'Cookie':
				if (response instanceof Cookie)
					return new Response(response.value, set as SetResponse)

				return new Response(response?.toString(), set as SetResponse)

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

					return response as Response
				}

				if (response instanceof Promise)
					return response.then((x) => mapEarlyResponse(x, set)) as any

				if (response instanceof Error)
					return errorToResponse(response as Error, set)

				// @ts-expect-error
				if (typeof response?.next === 'function')
					// @ts-expect-error
					return handleStream(response as any, set, request)

				if ('toResponse' in (response as any))
					return mapEarlyResponse((response as any).toResponse(), set)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						if (!set.headers['Content-Type'])
							set.headers['Content-Type'] = 'application/json'

						return new Response(
							JSON.stringify(response),
							set as SetResponse
						) as any
					}
				}

				return new Response(response as any, set as SetResponse)
		}
	} else
		switch (response?.constructor?.name) {
			case 'String':
				return new Response(response as string)

			case 'Blob':
				return handleFile(response as File | Blob, set)

			case 'Array':
				return Response.json(response)

			case 'Object':
				// @ts-ignore
				const status = response[ELYSIA_RESPONSE]
				if (status) {
					set.status = status

					// @ts-ignore
					return mapEarlyResponse(response.response, set, request)
				}

				for (const value in Object.values(response as Object)) {
					switch (value?.constructor?.name) {
						case 'Blob':
						case 'File':
						case 'ArrayBuffer':
						case 'FileRef':
							return new Response(
								form(response as any),
								set as SetResponse
							)

						default:
							break
					}
				}

				return Response.json(response, set as SetResponse)

			case 'ReadableStream':
				request?.signal.addEventListener(
					'abort',
					{
						handleEvent() {
							if (!request?.signal.aborted)
								(response as ReadableStream).cancel(request)
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
					return new Response(response.value, set as SetResponse)

				return new Response(response?.toString(), set as SetResponse)

			case 'FormData':
				return new Response(response as FormData)

			default:
				if (response instanceof Response)
					return new Response(response.body, {
						headers: {
							'Content-Type': 'application/json'
						}
					})

				if (response instanceof Promise)
					return response.then((x) => mapEarlyResponse(x, set)) as any

				if (response instanceof Error)
					return errorToResponse(response as Error, set)

				// @ts-expect-error
				if (typeof response?.next === 'function')
					// @ts-expect-error
					return handleStream(response as any, set, request)

				if ('toResponse' in (response as any))
					return mapEarlyResponse((response as any).toResponse(), set)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						if (!set.headers['Content-Type'])
							set.headers['Content-Type'] = 'application/json'

						return new Response(
							JSON.stringify(response),
							set as SetResponse
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

		case 'Blob':
			return handleFile(response as File | Blob)

		case 'Array':
			return Response.json(response)

		case 'Object':
			// @ts-ignore
			if (response[ELYSIA_RESPONSE])
				// @ts-ignore
				return mapResponse(response.response, {
					// @ts-ignore
					status: response[ELYSIA_RESPONSE],
					headers: {}
				})

			form: for (const value of Object.values(response as Object))
				switch (value?.constructor?.name) {
					case 'Blob':
					case 'File':
					case 'ArrayBuffer':
					case 'FileRef':
						return new Response(form(response as any))

					case 'Object':
						break form

					default:
						break
				}

			return Response.json(response)

		case 'ReadableStream':
			request?.signal.addEventListener(
				'abort',
				{
					handleEvent() {
						if (!request?.signal.aborted)
							(response as ReadableStream).cancel(request)
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
			return response as Response

		case 'Error':
			return errorToResponse(response as Error)

		case 'Promise':
			// @ts-ignore
			return (response as any as Promise<unknown>).then((x) =>
				mapCompactResponse(x, request)
			)

		// ? Maybe response or Blob
		case 'Function':
			return mapCompactResponse((response as Function)(), request)

		case 'Number':
		case 'Boolean':
			return new Response((response as number | boolean).toString())

		case 'FormData':
			return new Response(response as FormData)

		default:
			if (response instanceof Response)
				return new Response(response.body, {
					headers: {
						'Content-Type': 'application/json'
					}
				})

			if (response instanceof Promise)
				return response.then((x) =>
					mapCompactResponse(x, request)
				) as any

			if (response instanceof Error)
				return errorToResponse(response as Error)

			// @ts-expect-error
			if (typeof response?.next === 'function')
				// @ts-expect-error
				return handleStream(response as any, undefined, request)

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
			headers: set?.headers
		}
	)
