import type Context from './context'

const json = new Headers()
json.append('Content-Type', 'application/json')
export const jsonHeader = {
	headers: json
}

// We don't want to assign new variable to be used only once here
export const mapEarlyResponse = (response: unknown, context: Context) => {
	if (context._headers || context._status !== 200)
		switch (typeof response) {
			case 'string':
				return new Response(response, {
					status: context._status,
					headers: context._headers
				})

			case 'object':
				if (response instanceof Error)
					return errorToResponse(response, context._headers)
				if (response instanceof Response) {
					for (const [key, value] of context._headers?.entries() ??
						[])
						response.headers.append(key, value)

					return response
				}

				context.responseHeaders.append(
					'Content-Type',
					'application/json'
				)

				return new Response(JSON.stringify(response), {
					status: context._status,
					headers: context._headers
				})

			// ? Maybe response or Blob
			case 'function':
				if (response instanceof Blob)
					return new Response(response, {
						status: context._status,
						headers: context._headers
					})

				for (const [key, value] of context._headers?.entries() ?? [])
					(response as unknown as Response).headers.append(key, value)

				return response as unknown as Response

			case 'number':
			case 'boolean':
				return new Response(response.toString(), {
					status: context._status,
					headers: context._headers
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
					return errorToResponse(response, context._headers)

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

export const mapResponse = (response: unknown, context: Context) => {
	if (context._headers || context._status !== 200)
		switch (typeof response) {
			case 'string':
				return new Response(response, {
					status: context._status,
					headers: context._headers
				})

			case 'object':
				if (response instanceof Error)
					return errorToResponse(response, context._headers)
				if (response instanceof Response) {
					for (const [key, value] of context._headers?.entries() ??
						[])
						response.headers.append(key, value)

					return response
				}

				context.responseHeaders.append(
					'Content-Type',
					'application/json'
				)

				return new Response(JSON.stringify(response), {
					status: context._status,
					headers: context._headers
				})

			// ? Maybe response function or Blob
			case 'function':
				if (response instanceof Blob)
					return new Response(response, {
						status: context._status,
						headers: context._headers
					})

				return response()

			case 'number':
			case 'boolean':
				return new Response(response.toString(), {
					status: context._status,
					headers: context._headers
				})

			case 'undefined':
				return new Response('', {
					status: context._status,
					headers: context._headers
				})

			default:
				return new Response(response as any, {
					status: context._status,
					headers: context._headers
				})
		}
	else
		switch (typeof response) {
			case 'string':
				return new Response(response)

			case 'object':
				if (response instanceof Response) return response
				if (response instanceof Error)
					return errorToResponse(response, context._headers)

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
