/* eslint-disable no-case-declarations */
import type { Context } from './context'

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

// We don't want to assign new variable to be used only once here
export const mapEarlyResponse = (
	response: unknown,
	set: Context['set']
): Response | undefined => {
	if (isNotEmpty(set.headers) || set.status !== 200 || set.redirect) {
		if (set.redirect) {
			set.headers.Location = set.redirect
			set.status = 302
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

		switch (typeof response) {
			case 'string':
				return new Response(response, {
					status: set.status,
					headers: set.headers
				})

			case 'object':
				switch (response?.constructor.name) {
					case 'Object':
					case undefined:
						return Response.json(response)
	
					case 'Error':
						return errorToResponse(response as Error, set.headers)

					case 'Response':
						for (const key in set.headers)
							(response as Response)!.headers.append(
								key,
								set.headers[key]
							)

						return response as Response

					case 'Blob':
						return new Response(response as Blob, {
							status: set.status,
							headers: set.headers
						})

					case 'Promise':
						// @ts-ignore
						return (response as Promise<unknown>).then((x) => {
							const r = mapEarlyResponse(x, set)

							if (r !== undefined) return r

							return
						})

					default:
						if (!set.headers['Content-Type'])
							set.headers['Content-Type'] = 'application/json'

						return new Response(JSON.stringify(response), {
							status: set.status,
							headers: set.headers
						})
				}

			// ? Maybe response or Blob
			case 'function':
				if (response instanceof Blob)
					return new Response(response, {
						status: set.status,
						headers: set.headers
					})

				for (const key in set.headers)
					(response as unknown as Response).headers.append(
						key,
						set.headers[key]
					)

				return response as unknown as Response

			case 'number':
			case 'boolean':
				return new Response(response.toString(), {
					status: set.status,
					headers: set.headers
				})

			default:
				break
		}
	} else
		switch (typeof response) {
			case 'string':
				return new Response(response)

			case 'object':
				switch (response?.constructor?.name) {
					case 'Object':
					case undefined:
						return Response.json(response)

					case 'Response':
						return response as Response

					case 'Error':
						return errorToResponse(response as Error, set.headers)

					case 'Blob':
						return new Response(response as Blob)

					case 'Promise':
						// @ts-ignore
						return (response as Promise<unknown>).then((x) => {
							const r = mapEarlyResponse(x, set)

							if (r !== undefined) return r

							return
						})

					default:
						return Response.json(response)
				}

			// ? Maybe response or Blob
			case 'function':
				if (response instanceof Blob) return new Response(response)

				return response as unknown as Response

			case 'number':
			case 'boolean':
				return new Response(response.toString())

			default:
				break
		}
}

export const mapResponse = (
	response: unknown,
	set: Context['set']
): Response => {
	if (isNotEmpty(set.headers) || set.status !== 200 || set.redirect) {
		if (set.redirect) {
			set.headers.Location = set.redirect
			set.status = 302
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

		switch (typeof response) {
			case 'string':
				return new Response(response, {
					status: set.status,
					headers: set.headers
				})

			case 'object':
				switch (response?.constructor?.name) {
					case 'Object':
					case undefined:
						return Response.json(response)

					case 'Error':
						return errorToResponse(response as Error, set.headers)

					case 'Response':
						for (const key in set.headers)
							(response as Response)!.headers.append(
								key,
								set.headers[key]
							)

						return response as Response

					case 'Blob':
						return new Response(response as Blob, {
							status: set.status,
							headers: set.headers
						})

					case 'Promise':
						// @ts-ignore
						return response.then((x) => mapResponse(x, set))

					default:
						if (!set.headers['Content-Type'])
							set.headers['Content-Type'] = 'application/json'

						return new Response(JSON.stringify(response), {
							status: set.status,
							headers: set.headers
						})
				}

			// ? Maybe response function or Blob
			case 'function':
				if (response instanceof Blob)
					return new Response(response, {
						status: set.status,
						headers: set.headers
					})

				return response()

			case 'number':
			case 'boolean':
				return new Response(response.toString(), {
					status: set.status,
					headers: set.headers
				})

			case 'undefined':
				return new Response('', {
					status: set.status,
					headers: set.headers
				})

			default:
				return new Response(response as any, {
					status: set.status,
					headers: set.headers
				})
		}
	} else
		switch (typeof response) {
			case 'string':
				return new Response(response)

			case 'object':
				switch (response?.constructor?.name) {
					case 'Object':
					case undefined:
						return Response.json(response)

					case 'Response':
						return response as Response

					case 'Error':
						return errorToResponse(response as Error, set.headers)

					case 'Blob':
						return new Response(response as Blob)

					case 'Promise':
						// @ts-ignore
						return (response as any as Promise<unknown>).then((x) => {
							const r = mapEarlyResponse(x, set)

							if (r !== undefined) return r

							return new Response('')
						})

					default:
						return Response.json(response)
				}

			// ? Maybe response or Blob
			case 'function':
				if (response instanceof Blob) return new Response(response)

				return response()

			case 'number':
			case 'boolean':
				return new Response(response.toString())

			case 'undefined':
				return new Response('')

			default:
				return new Response(response as any)
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
