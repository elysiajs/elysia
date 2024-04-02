/* eslint-disable sonarjs/no-duplicate-string */
import { serialize } from 'cookie'
import { StatusMap } from './utils'

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
/** */

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

	headers.delete('Set-Cookie')

	for (let i = 0; i < setCookie.length; i++) {
		const index = setCookie[i].indexOf('=')

		headers.append(
			'Set-Cookie',
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

export const mapResponse = (
	response: unknown,
	set: Context['set'],
	request?: Request
): Response => {
	// @ts-ignore
	if (response?.$passthrough)
		// @ts-ignore
		response = response?.[response.$passthrough]

	// @ts-ignore
	if (response?.[ELYSIA_RESPONSE]) {
		// @ts-ignore
		set.status = response[ELYSIA_RESPONSE]
		// @ts-ignore
		response = response.response
	}

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

		if (set.cookie && isNotEmpty(set.cookie))
			set.headers['Set-Cookie'] = serializeCookie(set.cookie)

		if (
			set.headers['Set-Cookie'] &&
			Array.isArray(set.headers['Set-Cookie'])
		)
			set.headers = parseSetCookies(
				new Headers(set.headers) as Headers,
				set.headers['Set-Cookie']
			) as any

		switch (response?.constructor?.name) {
			case 'String':
				return new Response(response as string, set as SetResponse)

			case 'Blob':
				return handleFile(response as File | Blob, set)

			case 'Object':
			case 'Array':
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
				const inherits = { ...set.headers }

				if (hasHeaderShorthand)
					set.headers = (
						(response as Response).headers as Headers
					).toJSON()
				else
					for (const [key, value] of (
						response as Response
					).headers.entries())
						if (key in set.headers) set.headers[key] = value

				for (const key in inherits)
					(response as Response).headers.append(key, inherits[key])

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

			default:
				if (response instanceof Response) {
					const inherits = Object.assign({}, set.headers)

					if (hasHeaderShorthand)
						set.headers = (
							(response as Response).headers as Headers
						).toJSON()
					else
						for (const [key, value] of (
							response as Response
						).headers.entries())
							if (key in set.headers) set.headers[key] = value

					for (const key in inherits)
						(response as Response).headers.append(
							key,
							inherits[key]
						)

					return response as Response
				}

				if (response instanceof Promise)
					return response.then((x) => mapResponse(x, set)) as any

				if (response instanceof Error)
					return errorToResponse(response as Error, set)

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

			case 'Object':
			case 'Array':
				return new Response(JSON.stringify(response), {
					headers: {
						'content-type': 'application/json'
					}
				})

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
					const r = mapCompactResponse(x)

					if (r !== undefined) return r

					return new Response('')
				})

			// ? Maybe response or Blob
			case 'Function':
				return mapCompactResponse((response as Function)())

			case 'Number':
			case 'Boolean':
				return new Response((response as number | boolean).toString())

			case 'Cookie':
				if (response instanceof Cookie)
					return new Response(response.value, set as SetResponse)

				return new Response(response?.toString(), set as SetResponse)

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

				console.log('HERE')

				return new Response(response as any)
		}
}

export const mapEarlyResponse = (
	response: unknown,
	set: Context['set'],
	request?: Request
): Response | undefined => {
	if (response === undefined || response === null) return

	// @ts-ignore
	if (response?.$passthrough)
		// @ts-ignore
		response = response?.[response.$passthrough]

	// @ts-ignore
	if (response?.[ELYSIA_RESPONSE]) {
		// @ts-ignore
		set.status = response[ELYSIA_RESPONSE]
		// @ts-ignore
		response = response.response
	}

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

		if (set.cookie && isNotEmpty(set.cookie))
			set.headers['Set-Cookie'] = serializeCookie(set.cookie)

		if (
			set.headers['Set-Cookie'] &&
			Array.isArray(set.headers['Set-Cookie'])
		)
			set.headers = parseSetCookies(
				new Headers(set.headers) as Headers,
				set.headers['Set-Cookie']
			) as any

		switch (response?.constructor?.name) {
			case 'String':
				return new Response(response as string, set as SetResponse)

			case 'Blob':
				return handleFile(response as File | Blob, set)

			case 'Object':
			case 'Array':
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
				const inherits = Object.assign({}, set.headers)

				if (hasHeaderShorthand)
					// @ts-ignore
					set.headers = (response as Response).headers.toJSON()
				else
					for (const [key, value] of (
						response as Response
					).headers.entries())
						if (!(key in set.headers)) set.headers[key] = value

				for (const key in inherits)
					(response as Response).headers.append(key, inherits[key])

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

			case 'Cookie':
				if (response instanceof Cookie)
					return new Response(response.value, set as SetResponse)

				return new Response(response?.toString(), set as SetResponse)

			default:
				if (response instanceof Response) {
					const inherits = { ...set.headers }

					if (hasHeaderShorthand)
						set.headers = (
							(response as Response).headers as Headers
						).toJSON()
					else
						for (const [key, value] of (
							response as Response
						).headers.entries())
							if (key in set.headers) set.headers[key] = value

					for (const key in inherits)
						(response as Response).headers.append(
							key,
							inherits[key]
						)

					return response as Response
				}

				if (response instanceof Promise)
					return response.then((x) => mapEarlyResponse(x, set)) as any

				if (response instanceof Error)
					return errorToResponse(response as Error, set)

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

			case 'Object':
			case 'Array':
				return new Response(JSON.stringify(response), {
					headers: {
						'content-type': 'application/json'
					}
				})

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
				return mapCompactResponse((response as Function)())

			case 'Number':
			case 'Boolean':
				return new Response((response as number | boolean).toString())

			case 'Cookie':
				if (response instanceof Cookie)
					return new Response(response.value, set as SetResponse)

				return new Response(response?.toString(), set as SetResponse)

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
	// @ts-ignore
	if (response?.$passthrough)
		// @ts-ignore
		response = response?.[response.$passthrough]

	// @ts-ignore
	if (response?.[ELYSIA_RESPONSE])
		// @ts-ignore
		return mapResponse(response.response, {
			// @ts-ignore
			status: response[ELYSIA_RESPONSE],
			headers: {}
		})

	switch (response?.constructor?.name) {
		case 'String':
			return new Response(response as string)

		case 'Blob':
			return handleFile(response as File | Blob)

		case 'Object':
		case 'Array':
			return new Response(JSON.stringify(response), {
				headers: {
					'content-type': 'application/json'
				}
			})

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
			return (response as any as Promise<unknown>).then(
				mapCompactResponse
			)

		// ? Maybe response or Blob
		case 'Function':
			return mapCompactResponse((response as Function)())

		case 'Number':
		case 'Boolean':
			return new Response((response as number | boolean).toString())

		default:
			if (response instanceof Response)
				return new Response(response.body, {
					headers: {
						'Content-Type': 'application/json'
					}
				})

			if (response instanceof Promise)
				return response.then(mapCompactResponse) as any

			if (response instanceof Error)
				return errorToResponse(response as Error)

			if ('charCodeAt' in (response as any)) {
				const code = (response as any).charCodeAt(0)

				if (code === 123 || code === 91) {
					return new Response(
						JSON.stringify(response),
						{
							headers: {
								'Content-Type': 'application/json'
							}
						}
					) as any
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
			status: set?.status !== 200 ? (set?.status as number) ?? 500 : 500,
			headers: set?.headers
		}
	)
