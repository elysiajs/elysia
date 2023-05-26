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

		if (response === null || response === undefined) {
			return
		}

		if (typeof response === 'string' || response instanceof Blob) {
			return new Response(response as string | Blob, set)
		}

		if (typeof response === 'function') {
			return (response as Function)()
		}

		if (typeof response === 'number' || typeof response === 'boolean') {
			return new Response(
				(response as number | boolean).toString(),
				set
			)
		}

		if (typeof response === 'object') {
			if (response instanceof Response) {
				for (const key in set.headers)
					(response as Response)!.headers.append(
						key,
						set.headers[key]
					)

				return response as Response
			}

			if (response instanceof Promise) {
				// @ts-ignore
				return (response as Promise<unknown>).then((x) => {
					const r = mapEarlyResponse(x, set)

					if (r !== undefined) return r

					return
				})
			}

			if (response instanceof Error) {
				return errorToResponse(response as Error, set.headers)
			}

			return new Response(JSON.stringify(response), set)
		}
	} else {
		if (response === null || response === undefined) {
			return new Response('')
		}

		if (typeof response === 'string' || response instanceof Blob) {
			return new Response(response as string | Blob)
		}

		if (typeof response === 'function') {
			return (response as Function)()
		}

		if (typeof response === 'number' || typeof response === 'boolean') {
			return new Response((response as number | boolean).toString())
		}

		if (typeof response === 'object') {
			if (response instanceof Response) {
				return response as Response
			}

			if (response instanceof Promise) {
				// @ts-ignore
				return (response as Promise<unknown>).then((x) => {
					const r = mapEarlyResponse(x, set)

					if (r !== undefined) return r

					return
				})
			}

			if (response instanceof Error) {
				return errorToResponse(response as Error, set.headers)
			}

			return new Response(JSON.stringify(response), {
				headers: {
					'content-type': 'application/json'
				}
			})
		}
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

		if (response === null || response === undefined) {
			return new Response('', set)
		}

		if (typeof response === 'string' || response instanceof Blob) {
			return new Response(response as string | Blob, {
				status: set.status,
				headers: set.headers
			})
		}

		if (typeof response === 'function') {
			return (response as Function)()
		}

		if (typeof response === 'number' || typeof response === 'boolean') {
			return new Response(
				(response as number | boolean).toString(),
				set
			)
		}

		if (typeof response === 'object') {
			if (response instanceof Response) {
				for (const key in set.headers)
					(response as Response)!.headers.append(
						key,
						set.headers[key]
					)

				return response as Response
			}

			if (response instanceof Promise) {
				// @ts-ignore
				return response.then((x) => mapResponse(x, set))
			}

			if (response instanceof Error) {
				return errorToResponse(response as Error, set.headers)
			}

			return Response.json(response, set)
		}

		return new Response(response as any, set)
	} else {
		if (response === null || response === undefined) {
			return new Response('')
		}

		if (typeof response === 'string' || response instanceof Blob) {
			return new Response(response as string | Blob)
		}

		// ? Maybe response or Blob
		if (typeof response === 'function') {
			return (response as Function)()
		}

		if (typeof response === 'number' || typeof response === 'boolean') {
			return new Response((response as number | boolean).toString())
		}

		if (typeof response === 'object') {
			if (response instanceof Response) {
				return response as Response
			}

			if (response instanceof Promise) {
				// @ts-ignore
				return (response as Promise<unknown>).then((x) => {
					const r = mapResponse(x, set)

					if (r !== undefined) return r

					return new Response('')
				})
			}

			if (response instanceof Error) {
				return errorToResponse(response as Error)
			}

			return new Response(JSON.stringify(response), {
				headers: {
					'content-type': 'application/json'
				}
			})
		}

		return response as any
	}
}

export const mapCompactResponse = (response: unknown): Response => {
	if (response === null || response === undefined) {
		return new Response('')
	}

	if (typeof response === 'string' || response instanceof Blob) {
		return new Response(response as string | Blob)
	}

	// ? Maybe response or Blob
	if (typeof response === 'function') {
		return (response as Function)()
	}

	if (typeof response === 'number' || typeof response === 'boolean') {
		return new Response((response as number | boolean).toString())
	}

	if (typeof response === 'object') {
		if (response instanceof Response) {
			return response as Response
		}

		if (response instanceof Promise) {
			// @ts-ignore
			return (response as any as Promise<unknown>).then((x) => {
				const r = mapCompactResponse(x)

				if (r !== undefined) return r

				return new Response('')
			})
		}

		if (response instanceof Error) {
			return errorToResponse(response as Error)
		}

		return new Response(JSON.stringify(response), {
			headers: {
				'content-type': 'application/json'
			}
		})
	}

	return response as any
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
