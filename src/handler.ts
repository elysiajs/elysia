import type Context from './context'

const isNotEmpty = (obj: Object) => {
	for (const x in obj) return true

	return false
}

// We don't want to assign new variable to be used only once here
export const mapEarlyResponse = (response: unknown, context: Context) => {
	if (context._redirect)
		return Response.redirect(context._redirect, context._status)

	if (isNotEmpty(context.responseHeaders) || context._status !== 200)
		switch (typeof response) {
			case 'string':
				return new Response(response, {
					status: context._status,
					headers: context.responseHeaders
				})

			case 'object':
				if (response instanceof Error)
					return errorToResponse(response, context.responseHeaders)
				if (response instanceof Response) {
					for (const x of Object.entries(context.responseHeaders))
						response.headers.append(x[0], x[1])

					return response
				}

				context.responseHeaders['Content-Type'] = 'application/json'

				return new Response(JSON.stringify(response), {
					status: context._status,
					headers: context.responseHeaders
				})

			// ? Maybe response or Blob
			case 'function':
				if (response instanceof Blob)
					return new Response(response, {
						status: context._status,
						headers: context.responseHeaders
					})

				for (const x of Object.entries(context.responseHeaders))
					(response as unknown as Response).headers.append(x[0], x[1])

				return response as unknown as Response

			case 'number':
			case 'boolean':
				return new Response(response.toString(), {
					status: context._status,
					headers: context.responseHeaders
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
					return errorToResponse(response, context.responseHeaders)

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
	if (isNotEmpty(context.responseHeaders) || context._status !== 200)
		switch (typeof response) {
			case 'string':
				return new Response(response, {
					status: context._status,
					headers: context.responseHeaders
				})

			case 'object':
				if (response instanceof Error)
					return errorToResponse(response, context.responseHeaders)
				if (response instanceof Response) {
					for (const x of Object.entries(context.responseHeaders))
						response.headers.append(x[0], x[1])

					return response
				}

				context.responseHeaders['Content-Type'] = 'application/json'

				return new Response(JSON.stringify(response), {
					status: context._status,
					headers: context.responseHeaders
				})

			// ? Maybe response function or Blob
			case 'function':
				if (response instanceof Blob)
					return new Response(response, {
						status: context._status,
						headers: context.responseHeaders
					})

				return response()

			case 'number':
			case 'boolean':
				return new Response(response.toString(), {
					status: context._status,
					headers: context.responseHeaders
				})

			case 'undefined':
				return new Response('', {
					status: context._status,
					headers: context.responseHeaders
				})

			default:
				return new Response(response as any, {
					status: context._status,
					headers: context.responseHeaders
				})
		}
	else
		switch (typeof response) {
			case 'string':
				return new Response(response)

			case 'object':
				if (response instanceof Response) return response
				if (response instanceof Error)
					return errorToResponse(response, context.responseHeaders)

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
