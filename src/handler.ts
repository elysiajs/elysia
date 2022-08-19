import type { Hook, Handler, Context, ComposedHandler } from './types'

const json = new Headers()
json.append('Content-Type', 'application/json')
export const jsonHeader = {
	headers: json
}

// We don't want to assign new variable to be used only once here
export const mapResponse = (
	response: unknown,
	request: Context,
	status: number
) => {
	switch (typeof response) {
		case 'string':
			return new Response(response, {
				status,
				headers: request.responseHeaders
			})

		case 'object':
			if (response instanceof Error) return errorToResponse(response)
			if (response instanceof Response) {
				for (const [key, value] of request.responseHeaders.entries())
					response.headers.append(key, value)

				return response
			}

			request.responseHeaders.append('Content-Type', 'application/json')

			return new Response(JSON.stringify(response), {
				status,
				headers: request.responseHeaders
			})

		// ? Maybe response or Blob
		case 'function':
			if (response instanceof Blob)
				return new Response(response, {
					status,
					headers: request.responseHeaders
				})

			for (const [key, value] of request.responseHeaders.entries())
				(response as unknown as Response).headers.append(key, value)

			return response as unknown as Response

		case 'number':
		case 'boolean':
			return new Response(response.toString(), {
				status,
				headers: request.responseHeaders
			})

		default:
			break
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const mapResponseWithoutHeaders = (
	response: unknown,
	request?: Context,
	status?: number
) => {
	switch (typeof response) {
		case 'string':
			return new Response(response)

		case 'object':
			if (response instanceof Response) return response
			if (response instanceof Error) return errorToResponse(response)

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

// Currying to merge hook
export const composeHandler = (
	handler: Handler<any, any>,
	hook: Hook<any>
): ComposedHandler => [handler, hook]

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
