import type { Context } from './types'

const json = new Headers()
json.append('Content-Type', 'application/json')
export const jsonHeader = {
	headers: json
}

// We don't want to assign new variable to be used only once here
export const mapEarlyResponse = (
	headerAvailable: boolean,
	response: unknown,
	context: Context,
	status: number
) => {
	if (headerAvailable)
		switch (typeof response) {
			case 'string':
				return new Response(response, {
					status,
					headers: context.responseHeaders
				})

			case 'object':
				if (response instanceof Error)
					return errorToResponse(response, context.responseHeaders)
				if (response instanceof Response) {
					for (const [
						key,
						value
					] of context.responseHeaders.entries())
						response.headers.append(key, value)

					return response
				}

				context.responseHeaders.append(
					'Content-Type',
					'application/json'
				)

				return new Response(JSON.stringify(response), {
					status,
					headers: context.responseHeaders
				})

			// ? Maybe response or Blob
			case 'function':
				if (response instanceof Blob)
					return new Response(response, {
						status,
						headers: context.responseHeaders
					})

				for (const [key, value] of context.responseHeaders.entries())
					(response as unknown as Response).headers.append(key, value)

				return response as unknown as Response

			case 'number':
			case 'boolean':
				return new Response(response.toString(), {
					status,
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
	headerAvailable: boolean,
	response: unknown,
	context: Context,
	status: number
) => {
	if (headerAvailable)
		switch (typeof response) {
			case 'string':
				return new Response(response, {
					status,
					headers: context.responseHeaders
				})

			case 'object':
				if (response instanceof Error)
					return errorToResponse(response, context.responseHeaders)
				if (response instanceof Response) {
					for (const [key, value] of context.responseHeaders!.entries())
						response.headers.append(key, value)

					return response
				}

				context.responseHeaders.append(
					'Content-Type',
					'application/json'
				)

				return new Response(JSON.stringify(response), {
					status,
					headers: context.responseHeaders
				})

			// ? Maybe response function or Blob
			case 'function':
				if (response instanceof Blob)
					return new Response(response, {
						status,
						headers: context.responseHeaders
					})

				return response()

			case 'number':
			case 'boolean':
				return new Response(response.toString(), {
					status,
					headers: context.responseHeaders
				})

			case 'undefined':
				return new Response('', {
					status,
					headers: context.responseHeaders
				})

			default:
				return new Response(response as any, {
					status,
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
