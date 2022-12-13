import type { Context } from './context'

const jsonHeader = {
	headers: {
		'content-type': 'application/json'
	}
}

const isNotEmpty = (obj: Object) => {
	for (const x in obj) return true

	return false
}

// We don't want to assign new variable to be used only once here
export const mapEarlyResponse = (response: unknown, set: Context['set']) => {
	if (set.redirect)
		return Response.redirect(set.redirect, {
			headers: set.headers
		})

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

				if (set.headers['Content-Type'] !== null)
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

				return new Response(JSON.stringify(response), jsonHeader)

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
	if (set.redirect)
		return Response.redirect(set.redirect, {
			headers: set.headers
		})

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

				if (set.headers['Content-Type'] !== null)
					set.headers['Content-Type'] = 'application/json'

				return new Response(JSON.stringify(response), {
					status: set.status,
					headers: set.headers
				})

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

				return new Response(JSON.stringify(response), jsonHeader)

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
