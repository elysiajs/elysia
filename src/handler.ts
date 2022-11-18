import type Context from './context'

const isNotEmpty = (obj: Object) => {
	for (const x in obj) return true

	return false
}

// We don't want to assign new variable to be used only once here
export const mapEarlyResponse = (response: unknown, context: Context) => {
	if (context.set.redirect)
		return Response.redirect(context.set.redirect, {
			headers: context.set.headers
		})

	if (isNotEmpty(context.set.headers) || context.set.status)
		switch (typeof response) {
			case 'string':
				return new Response(response, {
					status: context.set.status,
					headers: context.set.headers
				})

			case 'object':
				if (response instanceof Error)
					return errorToResponse(response, context.set.headers)
				if (response instanceof Response) {
					for (const key in context.set.headers)
						response.headers.append(key, context.set.headers[key])

					return response
				}
				if (response instanceof Blob)
					return new Response(response, {
						status: context.set.status,
						headers: context.set.headers
					})

				if (context.set.headers['Content-Type'] !== null)
					context.set.headers['Content-Type'] = 'application/json'

				return new Response(JSON.stringify(response), {
					status: context.set.status,
					headers: context.set.headers
				})

			// ? Maybe response or Blob
			case 'function':
				if (response instanceof Blob)
					return new Response(response, {
						status: context.set.status,
						headers: context.set.headers
					})

				for (const key in context.set.headers)
					(response as unknown as Response).headers.append(
						key,
						context.set.headers[key]
					)

				return response as unknown as Response

			case 'number':
			case 'boolean':
				return new Response(response.toString(), {
					status: context.set.status,
					headers: context.set.headers
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
					return errorToResponse(response, context.set.headers)
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

export const mapResponse = (response: unknown, context: Context) => {
	if (context.set.redirect)
		return Response.redirect(context.set.redirect, {
			headers: context.set.headers
		})

	if (isNotEmpty(context.set.headers) || context.set.status)
		switch (typeof response) {
			case 'string':
				return new Response(response, {
					status: context.set.status,
					headers: context.set.headers
				})

			case 'object':
				if (response instanceof Error)
					return errorToResponse(response, context.set.headers)
				if (response instanceof Response) {
					for (const key in context.set.headers)
						response.headers.append(key, context.set.headers[key])

					return response
				}
				if (response instanceof Blob)
					return new Response(response, {
						status: context.set.status,
						headers: context.set.headers
					})

				if (context.set.headers['Content-Type'] !== null)
					context.set.headers['Content-Type'] = 'application/json'

				return new Response(JSON.stringify(response), {
					status: context.set.status,
					headers: context.set.headers
				})

			// ? Maybe response function or Blob
			case 'function':
				if (response instanceof Blob)
					return new Response(response, {
						status: context.set.status,
						headers: context.set.headers
					})

				return response()

			case 'number':
			case 'boolean':
				return new Response(response.toString(), {
					status: context.set.status,
					headers: context.set.headers
				})

			case 'undefined':
				return new Response('', {
					status: context.set.status,
					headers: context.set.headers
				})

			default:
				return new Response(response as any, {
					status: context.set.status,
					headers: context.set.headers
				})
		}
	else
		switch (typeof response) {
			case 'string':
				return new Response(response)

			case 'object':
				if (response instanceof Response) return response
				if (response instanceof Error)
					return errorToResponse(response, context.set.headers)
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
