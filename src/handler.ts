import type { Context } from './context'

export const isNotEmpty = (obj: Object) => {
	for (const x in obj) return true

	return false
}

const parseSetCookies = (headers: Headers, setCookie: string | string[]) => {
	if (Array.isArray(setCookie)) {
		headers.delete('Set-Cookie')

		for (let i = 0; i < setCookie.length; i++) {
			const index = setCookie[i].indexOf('=')

			console.log(
				'Append',
				`${setCookie[i].slice(0, index)}=${setCookie[i].slice(
					index + 1
				)}`
			)

			headers.append(
				'Set-Cookie',
				`${setCookie[i].slice(0, index)}=${setCookie[i].slice(
					index + 1
				)}`
			)
		}
	}

	return headers
}

// We don't want to assign new variable to be used only once here
export const mapEarlyResponse = (response: unknown, set: Context['set']) => {
	if (set.redirect) {
		set.headers.Location = set.redirect
		set.status = 302
	}

	if (set.headers['Set-Cookie'])
		// @ts-ignore
		set.headers = parseSetCookies(
			new Headers(set.headers),
			set.headers['Set-Cookie']
		)

	if (isNotEmpty(set.headers) || set.status !== 200)
		switch (typeof response) {
			case 'string':
				return new Response(response, {
					status: set.status,
					headers: set.headers
				})

			case 'object':
				if (response instanceof Error)
					return errorToResponse(response, set.headers)
				if (response instanceof Response) {
					for (const key in set.headers)
						response.headers.append(key, set.headers[key])

					return response
				}
				if (response instanceof Blob)
					return new Response(response, {
						status: set.status,
						headers: set.headers
					})

				if (!set.headers['Content-Type'])
					set.headers['Content-Type'] = 'application/json'

				return new Response(JSON.stringify(response), {
					status: set.status,
					headers: set.headers
				})

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
	else
		switch (typeof response) {
			case 'string':
				return new Response(response)

			case 'object':
				if (response instanceof Response) return response
				if (response instanceof Error)
					return errorToResponse(response, set.headers)
				if (response instanceof Blob) return new Response(response)

				return new Response(JSON.stringify(response), {
					headers: {
						'content-type': 'application/json'
					}
				})

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
	if (set.redirect) {
		set.headers.Location = set.redirect
		set.status = 302
	}

	if (set.headers?.['Set-Cookie']) {
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
				switch (response!.constructor) {
					case Error:
						return errorToResponse(response as Error, set.headers)

					case Response:
						for (const key in set.headers)
							(response as Response)!.headers.append(
								key,
								set.headers[key]
							)

						return response as Response

					case Blob:
						return new Response(response as Blob, {
							status: set.status,
							headers: set.headers
						})

					default:
						if (!set.headers['Content-Type'])
							if (set.headers instanceof Headers)
								set.headers.append(
									'Content-Type',
									'application/json'
								)
							else
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
	}

	if (set.redirect)
		return Response.redirect(set.redirect, {
			headers: set.headers
		})

	if (Object.keys(set.headers).length || set.status !== 200)
		switch (typeof response) {
			case 'string':
				return new Response(response, {
					status: set.status,
					headers: set.headers
				})

			case 'object':
				switch (response?.constructor) {
					case Error:
						return errorToResponse(response as Error, set.headers)

					case Response:
						for (const key in set.headers)
							(response as Response)!.headers.append(
								key,
								set.headers[key]
							)

						return response as Response

					case Blob:
						return new Response(response as Blob, {
							status: set.status,
							headers: set.headers
						})

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
	else
		switch (typeof response) {
			case 'string':
				return new Response(response)

			case 'object':
				if (response instanceof Response) return response
				if (response instanceof Error)
					return errorToResponse(response, set.headers)
				if (response instanceof Blob) return new Response(response)

				return new Response(JSON.stringify(response), {
					headers: {
						'content-type': 'application/json'
					}
				})

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
