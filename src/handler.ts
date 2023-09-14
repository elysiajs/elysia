/* eslint-disable no-case-declarations */
import type { Context } from './context'

const hasHeaderShorthand = 'toJSON' in new Headers()

export const isNotEmpty = (obj: Object) => {
	for (const x in obj) return true

	return false
}

const parseSetCookies = (headers: Headers, setCookie: string[]) => {
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

export const mapEarlyResponse = (
	response: unknown,
	set: Context['set']
): Response | undefined => {
	if (isNotEmpty(set.headers) || set.status !== 200 || set.redirect) {
		if (set.redirect) {
			set.headers.Location = set.redirect
			if (set.status === 200) set.status = 302
		}

		if (
			set.headers['Set-Cookie'] &&
			Array.isArray(set.headers['Set-Cookie'])
		)
			// @ts-ignore
			set.headers = parseSetCookies(
				new Headers(set.headers),
				set.headers['Set-Cookie']
			)

		switch (response?.constructor?.name) {
			case 'String':
			case 'Blob':
				return new Response(response as string | Blob, set)

			case 'Object':
			case 'Array':
				return Response.json(response, set)

			case undefined:
				if (!response) return

				return Response.json(response, set)

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

					return
				})

			case 'Error':
				return errorToResponse(response as Error, set.headers)

			case 'Function':
				return (response as Function)()

			case 'Number':
			case 'Boolean':
				return new Response(
					(response as number | boolean).toString(),
					set
				)

			default:
				if (response instanceof Response) return response

				const r = JSON.stringify(response)
				if (r.charCodeAt(0) === 123) {
					if (!set.headers['Content-Type'])
						set.headers['Content-Type'] = 'application/json'

					return new Response(JSON.stringify(response), set) as any
				}

				return new Response(r, set)
		}
	} else
		switch (response?.constructor?.name) {
			case 'String':
			case 'Blob':
				return new Response(response as string | Blob)

			case 'Object':
			case 'Array':
				return new Response(JSON.stringify(response), {
					headers: {
						'content-type': 'application/json'
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

					return
				})

			case 'Error':
				return errorToResponse(response as Error, set.headers)

			case 'Function':
				return (response as Function)()

			case 'Number':
			case 'Boolean':
				return new Response((response as number | boolean).toString())

			default:
				if (response instanceof Response) return response

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

export const mapResponse = (
	response: unknown,
	set: Context['set']
): Response => {
	if (isNotEmpty(set.headers) || set.status !== 200 || set.redirect) {
		if (set.redirect) {
			set.headers.Location = set.redirect
			if (set.status === 200) set.status = 302
		}

		if (
			set.headers['Set-Cookie'] &&
			Array.isArray(set.headers['Set-Cookie'])
		)
			// @ts-ignore
			set.headers = parseSetCookies(
				new Headers(set.headers),
				set.headers['Set-Cookie']
			)

		switch (response?.constructor?.name) {
			case 'String':
			case 'Blob':
				return new Response(response as string | Blob, {
					status: set.status,
					headers: set.headers
				})

			case 'Object':
			case 'Array':
				return Response.json(response, set)

			case undefined:
				if (!response) return new Response('', set)

				return Response.json(response, set)

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

				return response as Response

			case 'Error':
				return errorToResponse(response as Error, set.headers)

			case 'Promise':
				// @ts-ignore
				return response.then((x) => mapResponse(x, set))

			case 'Function':
				return (response as Function)()

			case 'Number':
			case 'Boolean':
				return new Response(
					(response as number | boolean).toString(),
					set
				)

			default:
				if (response instanceof Response) return response

				const r = JSON.stringify(response)
				if (r.charCodeAt(0) === 123) {
					if (!set.headers['Content-Type'])
						set.headers['Content-Type'] = 'application/json'

					return new Response(JSON.stringify(response), set) as any
				}

				return new Response(r, set)
		}
	} else
		switch (response?.constructor?.name) {
			case 'String':
			case 'Blob':
				return new Response(response as string | Blob)

			case 'Object':
			case 'Array':
				return new Response(JSON.stringify(response), {
					headers: {
						'content-type': 'application/json'
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
				return (response as any as Promise<unknown>).then((x) => {
					const r = mapResponse(x, set)

					if (r !== undefined) return r

					return new Response('')
				})

			// ? Maybe response or Blob
			case 'Function':
				return (response as Function)()

			case 'Number':
			case 'Boolean':
				return new Response((response as number | boolean).toString())

			default:
				if (response instanceof Response) return response

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
	switch (response?.constructor?.name) {
		case 'String':
		case 'Blob':
			return new Response(response as string | Blob)

		case 'Object':
		case 'Array':
			return new Response(JSON.stringify(response), {
				headers: {
					'content-type': 'application/json'
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
			return (response as any as Promise<unknown>).then((x) => {
				const r = mapCompactResponse(x)

				if (r !== undefined) return r

				return new Response('')
			})

		// ? Maybe response or Blob
		case 'Function':
			return (response as Function)()

		case 'Number':
		case 'Boolean':
			return new Response((response as number | boolean).toString())

		default:
			if (response instanceof Response) return response

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

export const errorToResponse = (error: Error, headers?: HeadersInit) =>
	new Response(
		JSON.stringify({
			name: error?.name,
			message: error?.message,
			cause: error?.cause
		}),
		{
			status: 500,
			headers
		}
	)
