import type { Hook, Handler, Context, ComposedHandler } from './types'

export const mapResponse = (response: unknown, request: Context) => {
	switch (typeof response) {
		case 'string':
			return new Response(response, {
				headers: request.responseHeaders
			})

		case 'object':
			request.responseHeaders.append('Content-Type', 'application/json')

			return new Response(JSON.stringify(response), {
				headers: request.responseHeaders
			})

		// ? Maybe response or Blob
		case 'function':
			if (response instanceof Blob) return new Response(response)

			for (const [key, value] of request.responseHeaders.entries())
				(response as unknown as Response).headers.append(key, value)

			return response as unknown as Response

		case 'number':
		case 'boolean':
			return new Response(response.toString(), {
				headers: request.responseHeaders
			})

		default:
			break
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const mapResponseWithoutHeaders = (response: unknown, request?: Context) => {
	switch (typeof response) {
		case 'string':
			return new Response(response)

		case 'object':
			return new Response(JSON.stringify(response), {
				headers: {
					'Content-Type': 'application/json'
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

// Currying to merge hook
export const composeHandler = (
	handler: Handler<any, any>,
	hook: Hook<any>
): ComposedHandler => [handler, hook]
