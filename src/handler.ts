// @ts-ignore
import { serialize } from 'cookie'
import { StatusMap } from './utils'

import type { Context } from './context'
import { Cookie } from './cookie'
import { ELYSIA_RESPONSE } from './error'

const hasHeaderShorthand = 'toJSON' in new Headers()

type SetResponse = Omit<Context['set'], 'status'> & {
	status: number
}

export const isNotEmpty = (obj: Object) => {
	for (const x in obj) return true

	return false
}

const handleFile = (response: File | Blob, set?: Context['set']) => {
	const size = response.size

	if (
		(size &&
			set &&
			set.status !== 206 &&
			set.status !== 304 &&
			set.status !== 412 &&
			set.status !== 416) ||
		(!set && size)
	) {
		if (set) {
			if (set.headers instanceof Headers)
				if (hasHeaderShorthand) set.headers = set.headers.toJSON()
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
	if (!headers || !Array.isArray(setCookie)) return headers

	headers.delete('Set-Cookie')

	for (let i = 0; i < setCookie.length; i++) {
		const index = setCookie[i].indexOf('=')

		headers.append(
			'Set-Cookie',
			`${setCookie[i].slice(0, index)}=${setCookie[i].slice(index + 1)}`
		)
	}

	return headers
}

export const cookieToHeader = (cookies: Context['set']['cookie']) => {
	if (!cookies || typeof cookies !== 'object' || !isNotEmpty(cookies))
		return undefined

	const set: string[] = []

	for (const [key, property] of Object.entries(cookies)) {
		if (!key || !property) continue

		if (Array.isArray(property.value)) {
			for (let i = 0; i < property.value.length; i++) {
				let value = property.value[i]
				if (value === undefined || value === null) continue

				if (typeof value === 'object') value = JSON.stringify(value)

				set.push(serialize(key, value, property))
			}
		} else {
			let value = property.value
			if (value === undefined || value === null) continue

			if (typeof value === 'object') value = JSON.stringify(value)

			set.push(serialize(key, property.value, property))
		}
	}

	if (set.length === 0) return undefined
	if (set.length === 1) return set[0]

	return set
}

export const mapResponse = (
	response: unknown,
	set: Context['set']
): Response => {
	// @ts-ignore
	if (response?.[response.$passthrough])
		// @ts-ignore
		response = response[response.$passthrough]

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
			set.headers['Set-Cookie'] = cookieToHeader(set.cookie)

		if (
			set.headers['Set-Cookie'] &&
			Array.isArray(set.headers['Set-Cookie'])
		)
			set.headers = parseSetCookies(
				new Headers(set.headers),
				set.headers['Set-Cookie']
			) as any

		switch (response?.constructor) {
			case undefined:
				if (!response) return new Response('', set as SetResponse)

				return Response.json(response, set as SetResponse)

			case Boolean:
			case Number:
				return new Response(
					(response as number | boolean).toString(),
					set as SetResponse
				)
				
			case String:
				return new Response(response as string, set as SetResponse)

			case Object:
			case Array:
				return Response.json(response, set as SetResponse)

			case Function:
				return mapResponse((response as Function)(), set)
	
			case Blob:
				return handleFile(response as File | Blob, set)

			case ReadableStream:
				if (
					!set.headers['content-type']?.startsWith(
						'text/event-stream'
					)
				)
					set.headers['content-type'] =
						'text/event-stream; charset=utf-8'

				return new Response(
					response as ReadableStream,
					set as SetResponse
				)

			case Promise:
				// @ts-ignore
				return response.then((x) => mapResponse(x, set))

			case Cookie:
				if (response instanceof Cookie)
					return new Response(response.value, set as SetResponse)

				return new Response(response?.toString(), set as SetResponse)
			
			case Response:
			case Error:
			default:
				if (response instanceof Response) {
					const inherits = { ...set.headers }

					if (hasHeaderShorthand)
						set.headers = (response).headers.toJSON()
					else
						for (const [key, value] of (
							response
						).headers.entries())
							if (key in set.headers) set.headers[key] = value
	
					for (const key in inherits)
						(response).headers.append(key, inherits[key])
	
					return response
				}

				if (response instanceof Error){
					return errorToResponse(response, set)
				}

				const r = JSON.stringify(response)
				if (r.charCodeAt(0) === 123) {
					if (!set.headers['Content-Type'])
						set.headers['Content-Type'] = 'application/json'

					return new Response(
						JSON.stringify(response),
						set as SetResponse
					) as any
				}

				return new Response(r, set as SetResponse)
		}
	} else
		switch (response?.constructor) {
			case undefined:
				if (!response) return new Response('')

				return new Response(JSON.stringify(response), {
					headers: {
						'content-type': 'application/json'
					}
				})


			case Boolean:
			case Number:
				return new Response((response as number | boolean).toString())
			
			case String:
				return new Response(response as string)

			case Object:
			case Array:
				return new Response(JSON.stringify(response), {
					headers: {
						'content-type': 'application/json'
					}
				})
							// ? Maybe response or Blob
			case Function:
				return mapCompactResponse((response as Function)())

			case Blob:
				return handleFile(response as File | Blob, set)

			case ReadableStream:
				return new Response(response as ReadableStream, {
					headers: {
						'Content-Type': 'text/event-stream; charset=utf-8'
					}
				})

			case Promise:
				// @ts-ignore
				return (response as any as Promise<unknown>).then((x) => {
					const r = mapCompactResponse(x)

					if (r !== undefined) return r

					return new Response('')
				})

			case Cookie:
				if (response instanceof Cookie)
					return new Response(response.value, set as SetResponse)

				return new Response(response?.toString(), set as SetResponse)
			
			case Response:
			case Error:
			default:
				if (response instanceof Response) {
					return response
				}

				if (response instanceof Error){
					return errorToResponse(response, set)
				}
				
				const r = JSON.stringify(response)
				if (r.charCodeAt(0) === 123)
					return new Response(JSON.stringify(response), {
						headers: {
							'Content-Type': 'application/json'
						}
					}) as any

				return new Response(r)
		}
}

export const mapEarlyResponse = (
	response: unknown,
	set: Context['set']
): Response | undefined => {
	if (response === undefined || response === null) return

	if (
		// @ts-ignore
		response?.$passthrough
	)
		// @ts-ignore
		response = response[response.$passthrough]

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
			set.headers['Set-Cookie'] = cookieToHeader(set.cookie)

		if (
			set.headers['Set-Cookie'] &&
			Array.isArray(set.headers['Set-Cookie'])
		)
			set.headers = parseSetCookies(
				new Headers(set.headers),
				set.headers['Set-Cookie']
			) as any

		switch (response?.constructor) {
			case undefined:
				if (!response) return

				return Response.json(response, set as SetResponse)
			
			case Boolean:
			case Number:
				return new Response(
					(response as number | boolean).toString(),
					set as SetResponse
				)

			case String:
				return new Response(response as string, set as SetResponse)

			case Object:
			case Array:
				return Response.json(response, set as SetResponse)

			case Function:
				return mapEarlyResponse((response as Function)(), set)
	
			case Blob:
				return handleFile(response as File | Blob, set)

			case ReadableStream:
				if (
					!set.headers['content-type']?.startsWith(
						'text/event-stream'
					)
				)
					set.headers['content-type'] =
						'text/event-stream; charset=utf-8'

				return new Response(
					response as ReadableStream,
					set as SetResponse
				)


			case Promise:
				// @ts-ignore
				return (response as Promise<unknown>).then((x) => {
					const r = mapEarlyResponse(x, set)

					if (r !== undefined) return r

					return
				})

			case Cookie:
				if (response instanceof Cookie)
					return new Response(response.value, set as SetResponse)

				return new Response(response?.toString(), set as SetResponse)

			case Response:
			case Error:
			default:
				if (response instanceof Response) {
					const inherits = Object.assign({}, set.headers)

					if (hasHeaderShorthand)
						// @ts-ignore
						set.headers = (response).headers.toJSON()
					else
						for (const [key, value] of (
							response
						).headers.entries())
							if (!(key in set.headers)) set.headers[key] = value
	
					for (const key in inherits)
						(response).headers.append(key, inherits[key])
	
					if ((response).status !== set.status)
						set.status = (response).status
	
					return response
				}

				if (response instanceof Error){
					return errorToResponse(response, set)
				}

				const r = JSON.stringify(response)
				if (r.charCodeAt(0) === 123) {
					if (!set.headers['Content-Type'])
						set.headers['Content-Type'] = 'application/json'

					return new Response(
						JSON.stringify(response),
						set as SetResponse
					) as any
				}

				return new Response(r, set as SetResponse)
		}
	} else
		switch (response?.constructor) {
			case undefined:
				if (!response) return new Response('')

				return new Response(JSON.stringify(response), {
					headers: {
						'content-type': 'application/json'
					}
				})
				
			case Boolean:
			case Number:
				return new Response((response as number | boolean).toString())

			case String:
				return new Response(response as string)
			
			case Object:
			case Array:
				return new Response(JSON.stringify(response), {
					headers: {
						'content-type': 'application/json'
					}
				})

			case Function:
				return mapCompactResponse((response as Function)())
				
			case Blob:
				return handleFile(response as File | Blob, set)

			case ReadableStream:
				return new Response(response as ReadableStream, {
					headers: {
						'Content-Type': 'text/event-stream; charset=utf-8'
					}
				})

			case Promise:
				// @ts-ignore
				return (response as Promise<unknown>).then((x) => {
					const r = mapEarlyResponse(x, set)

					if (r !== undefined) return r

					return
				})

			case Cookie:
				if (response instanceof Cookie)
					return new Response(response.value, set as SetResponse)

				return new Response(response?.toString(), set as SetResponse)
			
			case Response:
			case Error:
			default:
				if (response instanceof Response) {
					return response
				}

				if (response instanceof Error){
					return errorToResponse(response, set)
				}

				const r = JSON.stringify(response)
				if (r.charCodeAt(0) === 123)
					return new Response(JSON.stringify(response), {
						headers: {
							'Content-Type': 'application/json'
						}
					}) as any

				return new Response(r)
		}
}

export const mapCompactResponse = (response: unknown): Response => {
	if (
		// @ts-ignore
		response?.$passthrough
	)
		// @ts-ignore
		response = response[response.$passthrough]

	// @ts-ignore
	if (response?.[ELYSIA_RESPONSE])
		// @ts-ignore
		return mapResponse(response.response, {
			// @ts-ignore
			status: response[ELYSIA_RESPONSE],
			headers: {}
		})

	switch (response?.constructor) {
		case undefined:
			if (!response) return new Response('')

			return new Response(JSON.stringify(response), {
				headers: {
					'content-type': 'application/json'
				}
			})

		case Boolean:
		case Number:
			return new Response((response as number | boolean).toString())

		case String:
			return new Response(response as string)
		
		case Object:
		case Array:
			return new Response(JSON.stringify(response), {
				headers: {
					'content-type': 'application/json'
				}
			})

		// ? Maybe response or Blob
		case Function:
			return mapCompactResponse((response as Function)())
		
		case Blob:
			return handleFile(response as File | Blob)

		case ReadableStream:
			return new Response(response as ReadableStream, {
				headers: {
					'Content-Type': 'text/event-stream; charset=utf-8'
				}
			})

		case Promise:
			// @ts-ignore
			return (response as any as Promise<unknown>).then((x) => {
				const r = mapCompactResponse(x)

				if (r !== undefined) return r

				return new Response('')
			})

		case Response:
		case Error:
		default:
			if (response instanceof Response) {
				return response
			}

			if (response instanceof Error) {
				return errorToResponse(response)
			}

			const r = JSON.stringify(response)
			if (r.charCodeAt(0) === 123)
				return new Response(JSON.stringify(response), {
					headers: {
						'Content-Type': 'application/json'
					}
				}) as any

			return new Response(r)
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
