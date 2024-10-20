/* eslint-disable sonarjs/no-duplicated-branches */
/* eslint-disable sonarjs/no-nested-switch */
/* eslint-disable sonarjs/no-duplicate-string */
import { serialize } from 'cookie'

import { type IncomingMessage, type ServerResponse } from 'http'
import { Readable } from 'stream'

import { isNotEmpty, StatusMap } from '../../utils'

import { Cookie } from '../../cookies'
import { ElysiaCustomStatusResponse } from '../../error'

import type { Context } from '../../context'
import type { HTTPHeaders, Prettify } from '../../types'

import type { ReadStream } from 'fs'
import type { ElysiaFile } from '../../universal/file'

type SetResponse = Prettify<
	Omit<Context['set'], 'status'> & {
		status: number
	}
>

export type ElysiaNodeResponse = [
	response: unknown,
	set: Omit<Context['set'], 'headers' | 'status'> & {
		headers?: HTTPHeaders
		status: number
	}
]

const handleFile = (
	response: File | Blob,
	set?: Context['set'],
	res?: HttpResponse
) => {
	const size = response.size

	if (set) {
		let setHeaders: Record<string, any>

		if (set.headers instanceof Headers) {
			setHeaders = {
				'accept-ranges': 'bytes',
				'content-range': `bytes 0-${size - 1}/${size}`,
				'transfer-encoding': 'chunked'
			}

			for (const [key, value] of set.headers.entries())
				if (key in set.headers) setHeaders[key] = value
		} else if (isNotEmpty(set.headers)) {
			Object.assign(
				{
					'accept-ranges': 'bytes',
					'content-range': `bytes 0-${size - 1}/${size}`,
					'transfer-encoding': 'chunked'
				},
				set.headers
			)

			setHeaders = set.headers
		}
	}

	if (res) readableStreamToReadable(response.stream()).pipe(res)

	return [response, set] as ElysiaNodeResponse
}

const handleElysiaFile = (
	response: ElysiaFile,
	set?: SetResponse,
	res?: HttpResponse
) => {
	let headers
	let status

	if (!set) {
		headers = {
			'accept-range': 'bytes',
			'content-type': (response as ElysiaFile).type,
			'content-range': `bytes 0-${(response as ElysiaFile).length - 1}/${(response as ElysiaFile).length}`
		}

		if (res) res.writeHead(200, headers)

		status = 200
	} else {
		Object.assign(set.headers, {
			'accept-range': 'bytes',
			'content-type': (response as ElysiaFile).type,
			'content-range': `bytes 0-${(response as ElysiaFile).length - 1}/${(response as ElysiaFile).length}`
		})

		if (res) res.writeHead(set.status, set.headers)

		status = set.status
		headers = set.headers
	}

	if (res) {
		;((response as ElysiaFile).value as ReadStream).pipe(res)
	}

	return [
		response,
		{
			status,
			headers
		}
	] satisfies ElysiaNodeResponse
}

export const serializeCookie = (cookies: Context['set']['cookie']) => {
	if (!cookies || !isNotEmpty(cookies)) return undefined

	const set: string[] = []

	for (const [key, property] of Object.entries(cookies)) {
		if (!key || !property) continue

		const value = property.value
		if (value === undefined || value === null) continue

		set.push(
			serialize(
				key,
				typeof value === 'object' ? JSON.stringify(value) : value + '',
				property
			)
		)
	}

	if (set.length === 0) return undefined
	if (set.length === 1) return set[0]

	return set
}

const handleStream = (
	generator: Generator | AsyncGenerator,
	set?: Context['set'],
	res?: HttpResponse
): ElysiaNodeResponse => {
	if (!set)
		set = {
			status: 200,
			headers: {
				'transfer-encoding': 'chunked',
				'content-type': 'text/event-stream;charset=utf8'
			}
		}
	else {
		set.headers['transfer-encoding'] = 'chunked'
		set.headers['content-type'] = 'text/event-stream;charset=utf8'
	}

	if (res) res.writeHead(set.status as number, set.headers)

	return [handleStreamResponse(generator, set, res), set as SetResponse]
}

export const handleStreamResponse = (
	generator: Generator | AsyncGenerator,
	set?: Context['set'],
	res?: HttpResponse
) => {
	const readable = new Readable({
		read() {}
	})

	if (res) readable.pipe(res)
	;(async () => {
		let init = generator.next()
		if (init instanceof Promise) init = await init

		if (init.done) {
			if (set) return mapResponse(init.value, set, res)
			return mapCompactResponse(init.value, res)
		}

		// abortSignal?.addEventListener('abort', () => {
		// 	end = true

		// 	try {
		// 		readable.push(null)
		// 	} catch {
		// 		// nothing
		// 	}
		// })

		if (init.value !== undefined && init.value !== null) {
			if (typeof init.value === 'object')
				try {
					readable.push(Buffer.from(JSON.stringify(init.value)))
				} catch {
					readable.push(Buffer.from(init.value.toString()))
				}
			else readable.push(Buffer.from(init.value.toString()))
		}

		for await (const chunk of generator) {
			if (chunk === undefined || chunk === null) continue

			if (typeof chunk === 'object')
				try {
					readable.push(Buffer.from(JSON.stringify(chunk)))
				} catch {
					readable.push(Buffer.from(chunk.toString()))
				}
			else readable.push(Buffer.from(chunk.toString()))

			// Wait for the next event loop
			// Otherwise the data will be mixed up
			await new Promise<void>((resolve) => setTimeout(() => resolve(), 0))
		}

		readable.push(null)
	})()

	return readable
}

export async function* streamResponse(response: Response) {
	const body = response.body

	if (!body) return

	const reader = body.getReader()
	const decoder = new TextDecoder()

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			yield decoder.decode(value)
		}
	} finally {
		reader.releaseLock()
	}
}

type HttpResponse = ServerResponse<IncomingMessage> & {
	req: IncomingMessage
}

export const mapResponse = (
	response: unknown,
	set: Context['set'],
	res?: HttpResponse
): ElysiaNodeResponse => {
	if (
		isNotEmpty(set.headers) ||
		set.status !== 200 ||
		set.redirect ||
		set.cookie
	) {
		if (typeof set.status === 'string') set.status = StatusMap[set.status]

		if (set.redirect) {
			set.headers.Location = set.redirect
			if (!set.status || set.status < 300 || set.status >= 400)
				set.status = 302
		}

		if (set.cookie && isNotEmpty(set.cookie)) {
			const cookie = serializeCookie(set.cookie)

			if (cookie) set.headers['set-cookie'] = cookie
		}

		switch (response?.constructor?.name) {
			case 'String':
				set.headers['content-type'] = 'text/plain;charset=utf-8'

				if (res) {
					set.headers['content-length'] = (response as string)
						.length as any
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'Array':
			case 'Object':
				response = JSON.stringify(response)

				set.headers['content-type'] = 'application/json;charset=utf8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'ElysiaFile':
				return handleElysiaFile(response as ElysiaFile, set as SetResponse, res)

			case 'Blob':
				set.headers['content-length'] = (response as File | Blob)
					.size as any

				return handleFile(response as File | Blob, set, res)

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					res
				)

			case 'ReadableStream':
				if (
					!set.headers['content-type']?.startsWith(
						'text/event-stream'
					)
				)
					set.headers['content-type'] =
						'text/event-stream;charset=utf8'

				// Already set by Node
				// set.headers['transfer-encoding'] = 'chunked'

				if (res) {
					res.writeHead(set.status!, set.headers)
					readableStreamToReadable(response as ReadableStream).pipe(
						res
					)
				}

				// abortSignal?.addEventListener(
				// 	'abort',
				// 	{
				// 		handleEvent() {
				// 			if (!abortSignal.aborted)
				// 				(response as ReadableStream).cancel()
				// 		}
				// 	},
				// 	{
				// 		once: true
				// 	}
				// )

				return [response as ReadableStream, set as SetResponse]

			case undefined:
				if (!response) {
					if (res) {
						set.headers['content-length'] = 0 as any
						res.writeHead(set.status!, set.headers)
						res.end('')
					}

					return ['', set as SetResponse]
				}

				response = JSON.stringify(response)

				set.headers['content-type'] = 'application/json;charset=utf8'
				set.headers['content-length'] = (response as string)
					?.length as any

				if (res) {
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'Response':
				let isCookieSet = false

				if (set.headers instanceof Headers)
					for (const key of set.headers.keys()) {
						if (key === 'set-cookie') {
							if (isCookieSet) continue

							isCookieSet = true

							for (const cookie of set.headers.getSetCookie()) {
								;(response as Response).headers.append(
									'set-cookie',
									cookie
								)
							}
						} else
							(response as Response).headers.append(
								key,
								set.headers?.get(key) ?? ''
							)
					}
				else
					for (const key in set.headers)
						(response as Response).headers.append(
							key,
							set.headers[key]
						)

				if ((response as Response).status !== set.status)
					set.status = (response as Response).status

				if (
					(response as Response).headers.get('transfer-encoding') ===
					'chunked'
				)
					return handleStream(
						streamResponse(response as Response),
						set,
						res
					) as any

				if (res) responseToValue(response as Response, res)

				return [response as Response, set as SetResponse]

			case 'Error':
				return errorToResponse(response as Error, set, res)

			case 'Promise':
				return (response as Promise<any>).then((x) =>
					mapResponse(x, set, res)
				) as any

			case 'Function':
				return mapResponse((response as Function)(), set, res)

			case 'Number':
			case 'Boolean':
				response = (response as number | boolean).toString()

				set.headers['content-type'] = 'text/plain;charset=utf-8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'Cookie':
				if (response instanceof Cookie)
					return mapResponse(response.value, set, res)

				return mapResponse(response?.toString(), set, res)

			case 'FormData':
				if (res) {
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response as FormData, set as SetResponse]

			default:
				if (response instanceof Response) {
					let isCookieSet = false

					if (set.headers instanceof Headers)
						for (const key of set.headers.keys()) {
							if (key === 'set-cookie') {
								if (isCookieSet) continue

								isCookieSet = true

								for (const cookie of set.headers.getSetCookie()) {
									;(response as Response).headers.append(
										'set-cookie',
										cookie
									)
								}
							} else
								(response as Response).headers.append(
									key,
									set.headers?.get(key) ?? ''
								)
						}
					else
						for (const key in set.headers)
							(response as Response).headers.append(
								key,
								set.headers[key]
							)

					for (const [key, value] of (
						response as Response
					).headers.entries())
						if (key in set.headers) set.headers[key] = value

					if (res) responseToValue(response as Response, res)

					return [response as Response, set as SetResponse]
				}

				if (response instanceof Promise)
					return response.then((x) => mapResponse(x, set, res)) as any

				if (response instanceof Error)
					return errorToResponse(response as Error, set, res)

				if (response instanceof ElysiaCustomStatusResponse) {
					set.status = (
						response as ElysiaCustomStatusResponse<200>
					).code

					return mapResponse(
						(response as ElysiaCustomStatusResponse<200>).response,
						set,
						res
					)
				}

				// @ts-expect-error
				if (typeof response?.next === 'function')
					return handleStream(response as any, set, res)

				if ('toResponse' in (response as any))
					return mapResponse((response as any).toResponse(), set, res)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						if (!set.headers['Content-Type'])
							set.headers['content-type'] =
								'application/json;charset=utf8'

						response = JSON.stringify(response)
						set.headers['content-length'] = (response as string)
							.length as any

						if (res) {
							res.writeHead(set.status!, set.headers)
							res.end(response)
						}

						return [response, set as SetResponse]
					}
				}

				set.headers['content-type'] = 'text/plain;charset=utf-8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response as any, set as SetResponse]
		}
	} else
		switch (response?.constructor?.name) {
			case 'String':
				set.headers['content-type'] = 'text/plain;charset=utf-8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(200, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'Array':
			case 'Object':
				response = JSON.stringify(response)

				set.headers['content-type'] = 'application/json;charset=utf8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(200, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'ElysiaFile':
				return handleElysiaFile(response as ElysiaFile, set as SetResponse, res)

			case 'Blob':
				set.headers['content-length'] = (response as File | Blob)
					.size as any

				return handleFile(response as File | Blob, set, res)

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					res
				)

			case 'ReadableStream':
				set.headers['content-type'] = 'text/event-stream;charset=utf8'

				if (res) {
					res.writeHead(200, set.headers)
					readableStreamToReadable(response as ReadableStream).pipe(
						res
					)
				}

				// abortSignal?.addEventListener(
				// 	'abort',
				// 	{
				// 		handleEvent() {
				// 			if (!abortSignal?.aborted)
				// 				(response as ReadableStream).cancel()
				// 		}
				// 	},
				// 	{
				// 		once: true
				// 	}
				// )

				return [response as ReadableStream, set as SetResponse]

			case undefined:
				if (!response) {
					if (res) {
						set.headers['content-length'] = 0 as any
						res.writeHead(set.status!, set.headers)
						res.end(response)
					}

					return ['', set as SetResponse]
				}

				response = JSON.stringify(response)

				set.headers['content-type'] = 'application/json;charset=utf8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(200, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'Response':
				if (
					(response as Response).headers.get('transfer-encoding') ===
					'chunked'
				)
					return handleStream(
						streamResponse(response as Response),
						set,
						res
					) as any

				if (res) responseToValue(response as Response, res)

				return [response as Response, set as SetResponse]

			case 'Error':
				return errorToResponse(response as Error, set, res)

			case 'Promise':
				// @ts-ignore
				return (response as any as Promise<unknown>).then((x) => {
					const r = mapCompactResponse(x, res)

					if (r !== undefined) return [r, set]

					return ['', set as SetResponse]
				})

			// ? Maybe response or Blob
			case 'Function':
				return mapCompactResponse((response as Function)(), res)

			case 'Number':
			case 'Boolean':
				response = (response as number | boolean).toString()

				set.headers['content-type'] = 'text/plain;charset=utf-8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(200, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'Cookie':
				if (response instanceof Cookie)
					return mapResponse(response.value, set, res)

				return mapResponse(response?.toString(), set, res)

			case 'FormData':
				if (res) {
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response as FormData, set as SetResponse]

			default:
				if (response instanceof Response) {
					if (res) responseToValue(response as Response, res)

					return [response, set as SetResponse]
				}

				if (response instanceof Promise)
					return response.then((x) => mapResponse(x, set, res)) as any

				if (response instanceof Error) {
					response = errorToResponse(response as Error, set, res)

					return response as ElysiaNodeResponse
				}

				if (response instanceof ElysiaCustomStatusResponse) {
					set.status = (
						response as ElysiaCustomStatusResponse<200>
					).code

					return mapResponse(
						(response as ElysiaCustomStatusResponse<200>).response,
						set,
						res
					)
				}

				// @ts-expect-error
				if (typeof response?.next === 'function')
					return handleStream(response as any, set, res)

				if ('toResponse' in (response as any))
					return mapResponse((response as any).toResponse(), set, res)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						response = JSON.stringify(response)

						if (!set.headers['Content-Type'])
							set.headers['content-type'] =
								'application/json;charset=utf8'
						set.headers['content-length'] = (response as string)
							.length as any

						if (res) {
							res.writeHead(set.status!, set.headers)
							res.end(response)
						}

						return [response, set as SetResponse]
					}
				}

				set.headers['content-type'] = 'text/plain;charset=utf-8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(200, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]
		}
}

export const mapEarlyResponse = (
	response: unknown,
	set: Context['set'],
	res?: HttpResponse
): ElysiaNodeResponse | undefined => {
	if (response === undefined || response === null) return

	if (
		isNotEmpty(set.headers) ||
		set.status !== 200 ||
		set.redirect ||
		set.cookie
	) {
		if (typeof set.status === 'string') set.status = StatusMap[set.status]

		if (set.redirect) {
			set.headers.Location = set.redirect

			if (!set.status || set.status < 300 || set.status >= 400)
				set.status = 302
		}

		if (set.cookie && isNotEmpty(set.cookie)) {
			const cookie = serializeCookie(set.cookie)

			if (cookie) set.headers['set-cookie'] = cookie
		}

		switch (response?.constructor?.name) {
			case 'String':
				set.headers['content-type'] = 'text/plain;charset=utf-8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'Array':
			case 'Object':
				response = JSON.stringify(response)

				set.headers['content-type'] = 'application/json;charset=utf8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'ElysiaFile':
				return handleElysiaFile(response as ElysiaFile, set as SetResponse, res)

			case 'Blob':
				return handleFile(response as File | Blob, set, res)

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapEarlyResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					res
				)

			case 'ReadableStream':
				if (
					!set.headers['content-type']?.startsWith(
						'text/event-stream'
					)
				)
					set.headers['content-type'] =
						'text/event-stream;charset=utf8'

				if (res) {
					res.writeHead(set.status!, set.headers)
					readableStreamToReadable(response as ReadableStream).pipe(
						res
					)
				}

				// abortSignal?.addEventListener(
				// 	'abort',
				// 	{
				// 		handleEvent() {
				// 			if (!abortSignal?.aborted)
				// 				(response as ReadableStream).cancel()
				// 		}
				// 	},
				// 	{
				// 		once: true
				// 	}
				// )

				return [response as ReadableStream, set as SetResponse]

			case undefined:
				if (!response) {
					set.headers['content-length'] = 0 as any

					if (res) {
						res.writeHead(set.status!, set.headers)
						res.end(response)
					}

					return ['', set as SetResponse]
				}

				response = JSON.stringify(response)

				set.headers['content-type'] = 'application/json;charset=utf8'
				set.headers['content-length'] = (response as string)
					.length as any

				return [response, set as SetResponse]

			case 'Response':
				let isCookieSet = false

				if (set.headers instanceof Headers)
					for (const key of set.headers.keys()) {
						if (key === 'set-cookie') {
							if (isCookieSet) continue

							isCookieSet = true

							for (const cookie of set.headers.getSetCookie()) {
								;(response as Response).headers.append(
									'set-cookie',
									cookie
								)
							}
						} else
							(response as Response).headers.append(
								key,
								set.headers?.get(key) ?? ''
							)
					}
				else
					for (const key in set.headers)
						(response as Response).headers.append(
							key,
							set.headers[key]
						)

				if ((response as Response).status !== set.status)
					set.status = (response as Response).status

				if (
					(response as Response).headers.get('transfer-encoding') ===
					'chunked'
				)
					return handleStream(
						streamResponse(response as Response),
						set,
						res
					) as any

				if (res) responseToValue(response as Response, res)

				return [response as Response, set as SetResponse]

			case 'Error':
				return errorToResponse(response as Error, set, res)

			case 'Promise':
				// @ts-ignore
				return (response as Promise<unknown>).then((x) => {
					const r = mapEarlyResponse(x, set, res)

					if (r !== undefined) return [r, set]
				})

			case 'Function':
				return mapEarlyResponse((response as Function)(), set, res)

			case 'Number':
			case 'Boolean':
				response = (response as number | boolean).toString()

				set.headers['content-type'] = 'text/plain;charset=utf-8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response as number | boolean, set as SetResponse]

			case 'Cookie':
				if (response instanceof Cookie)
					return mapEarlyResponse(response.value, set, res)

				return mapEarlyResponse(response?.toString(), set, res)

			case 'FormData':
				if (res) {
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response as FormData, set as SetResponse]

			default:
				if (response instanceof Response) {
					let isCookieSet = false

					if (set.headers instanceof Headers)
						for (const key of set.headers.keys()) {
							if (key === 'set-cookie') {
								if (isCookieSet) continue

								isCookieSet = true

								for (const cookie of set.headers.getSetCookie()) {
									;(response as Response).headers.append(
										'set-cookie',
										cookie
									)
								}
							} else
								(response as Response).headers.append(
									key,
									set.headers?.get(key) ?? ''
								)
						}
					else
						for (const key in set.headers)
							(response as Response).headers.append(
								key,
								set.headers[key]
							)

					if ((response as Response).status !== set.status)
						set.status = (response as Response).status

					if (res) responseToValue(response as Response, res)

					return [response as Response, set as SetResponse]
				}

				if (response instanceof Promise)
					return response.then((x) =>
						mapEarlyResponse(x, set, res)
					) as any

				if (response instanceof Error)
					return errorToResponse(response as Error, set, res)

				if (response instanceof ElysiaCustomStatusResponse) {
					set.status = (
						response as ElysiaCustomStatusResponse<200>
					).code

					return mapEarlyResponse(
						(response as ElysiaCustomStatusResponse<200>).response,
						set,
						res
					)
				}

				// @ts-ignore
				if (typeof response?.next === 'function')
					return handleStream(response as any, set, res)

				if ('toResponse' in (response as any))
					return mapEarlyResponse(
						(response as any).toResponse(),
						set,
						res
					)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						response = JSON.stringify(response)

						if (!set.headers['Content-Type'])
							set.headers['content-type'] =
								'application/json;charset=utf8'
						set.headers['content-length'] = (response as string)
							.length as any

						if (res) {
							res.writeHead(set.status!, set.headers)
							res.end(response)
						}

						return [response, set as SetResponse]
					}
				}

				set.headers['content-type'] = 'text/plain;charset=utf-8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]
		}
	} else
		switch (response?.constructor?.name) {
			case 'String':
				set.headers['content-type'] = 'text/plain;charset=utf-8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(200, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'Array':
			case 'Object':
				response = JSON.stringify(response)

				set.headers['content-type'] = 'application/json;charset=utf8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(200, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'ElysiaFile':
				return handleElysiaFile(response as ElysiaFile, set as SetResponse, res)

			case 'Blob':
				return handleFile(response as File | Blob, set, res)

			case 'ElysiaCustomStatusResponse':
				set.status = (response as ElysiaCustomStatusResponse<200>).code

				return mapEarlyResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					set,
					res
				)

			case 'ReadableStream':
				set.headers['content-type'] = 'text/event-stream;charset=utf8'

				if (res) {
					res.writeHead(200, set.headers)
					readableStreamToReadable(response as ReadableStream).pipe(
						res
					)
				}

				// abortSignal?.addEventListener(
				// 	'abort',
				// 	{
				// 		handleEvent() {
				// 			if (!abortSignal?.aborted)
				// 				(response as ReadableStream).cancel()
				// 		}
				// 	},
				// 	{
				// 		once: true
				// 	}
				// )

				return [response, set as SetResponse]

			case undefined:
				if (!response) {
					set.headers['content-length'] = 0 as any

					if (res) {
						res.writeHead(set.status!, set.headers)
						res.end(response)
					}

					return ['', set as SetResponse]
				}

				response = JSON.stringify(response)

				set.headers['content-type'] = 'application/json;charset=utf8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(200, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'Response':
				if (
					(response as Response).headers.get('transfer-encoding') ===
					'chunked'
				)
					return handleStream(
						streamResponse(response as Response),
						set,
						res
					) as any

				if (res) responseToValue(response as Response, res)

				return [response as Response, set as SetResponse]

			case 'Error':
				return errorToResponse(response as Error, set, res)

			case 'Promise':
				// @ts-ignore
				return (response as Promise<unknown>).then((x) => {
					const r = mapEarlyResponse(x, set, res)
					if (r !== undefined) return r
				})

			case 'Function':
				return mapCompactResponse((response as Function)(), res)

			case 'Number':
			case 'Boolean':
				response = (response as number | boolean).toString()

				set.headers['content-type'] = 'text/plain;charset=utf-8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(200, set.headers)
					res.end(response)
				}

				return [response, set as SetResponse]

			case 'Cookie':
				if (response instanceof Cookie)
					return mapEarlyResponse(
						response.value,
						set as SetResponse,
						res
					)

				return mapEarlyResponse(
					response?.toString(),
					set as SetResponse,
					res
				)

			case 'FormData':
				if (res) {
					res.writeHead(set.status!, set.headers)
					res.end(response)
				}

				return [response as FormData, set as SetResponse]

			default:
				if (response instanceof Response) {
					if (res) responseToValue(response as Response, res)

					return [response, set as SetResponse]
				}

				if (response instanceof Promise)
					return response.then((x) =>
						mapEarlyResponse(x, set, res)
					) as any

				if (response instanceof Error)
					return errorToResponse(response as Error, set, res)

				if (response instanceof ElysiaCustomStatusResponse) {
					set.status = (
						response as ElysiaCustomStatusResponse<200>
					).code

					return mapEarlyResponse(
						(response as ElysiaCustomStatusResponse<200>).response,
						set,
						res
					)
				}

				// @ts-expect-error
				if (typeof response?.next === 'function')
					return handleStream(response as any, set, res)

				if ('toResponse' in (response as any))
					return mapEarlyResponse(
						(response as any).toResponse(),
						set,
						res
					)

				if ('charCodeAt' in (response as any)) {
					const code = (response as any).charCodeAt(0)

					if (code === 123 || code === 91) {
						response = JSON.stringify(response)

						if (!set.headers['Content-Type'])
							set.headers['content-type'] =
								'application/json;charset=utf8'

						set.headers['content-length'] = (response as string)
							.length as any

						if (res) {
							res.writeHead(set.status!, set.headers)
							res.end(response)
						}

						return [response, set as SetResponse]
					}
				}

				set.headers['content-type'] = 'text/plain;charset=utf-8'
				set.headers['content-length'] = (response as string)
					.length as any

				if (res) {
					res.writeHead(200, set.headers)
					res.end(response)
				}

				return [response as any, set as SetResponse]
		}
}

export const mapCompactResponse = (
	response: unknown,
	res?: HttpResponse
): ElysiaNodeResponse => {
	switch (response?.constructor?.name) {
		case 'String':
			if (res) {
				res.writeHead(200, {
					'content-type': 'text/plain;charset=utf-8',
					'content-length': (response as string).length
				})
				res.end(response)
			}

			return [
				response,
				{
					status: 200,
					headers: {
						'content-type': 'text/plain;charset=utf-8'
					}
				}
			]

		case 'Array':
		case 'Object':
			response = JSON.stringify(response)

			if (res) {
				res.writeHead(200, {
					'content-type': 'application/json;charset=utf8',
					'content-length': (response as string).length
				})
				res.end(response)
			}

			return [
				response,
				{
					status: 200,
					headers: {
						'content-type': 'application/json;charset=utf8'
					}
				}
			]

		case 'ElysiaFile':
			return handleElysiaFile(response as ElysiaFile, undefined, res)

		case 'Blob':
			if (res) {
				res.writeHead(200)
				res.end(response)
			}

			return [
				response as File | Blob,
				{
					status: 200
				}
			]

		case 'ElysiaCustomStatusResponse':
			return mapResponse(
				(response as ElysiaCustomStatusResponse<200>).response,
				{
					status: (response as ElysiaCustomStatusResponse<200>).code,
					headers: {}
				},
				res
			)

		case 'ReadableStream':
			// abortSignal?.addEventListener(
			// 	'abort',
			// 	{
			// 		handleEvent() {
			// 			if (!abortSignal?.aborted)
			// 				(response as ReadableStream).cancel()
			// 		}
			// 	},
			// 	{
			// 		once: true
			// 	}
			// )
			//
			if (res) {
				res.writeHead(200, {
					'content-type': 'text/event-stream;charset=utf8'
				})
				readableStreamToReadable(response as ReadableStream).pipe(res)
			}

			return [
				response as ReadableStream,
				{
					status: 200,
					headers: {
						'Content-Type': 'text/event-stream;charset=utf8'
					}
				}
			]

		case undefined:
			if (!response) {
				if (res) {
					res.writeHead(200, {
						'content-type': 'text/plain;charset=utf-8',
						'content-length': 0
					})
					res.end('')
				}

				return [
					'',
					{
						status: 200,
						headers: {
							'content-type': 'text/plain;charset=utf-8'
						}
					}
				]
			}

			response = JSON.stringify(response)

			res?.writeHead(200, {
				'content-type': 'application/json;charset=utf-8',
				'content-length': (response as string).length
			})

			return [
				response,
				{
					status: 200,
					headers: {
						'content-type': 'application/json;charset=utf-8'
					}
				}
			]

		case 'Response':
			if (
				(response as Response).headers.get('transfer-encoding') ===
				'chunked'
			)
				return handleStream(
					streamResponse(response as Response),
					undefined,
					res
				) as any

			if (res) responseToValue(response as Response, res)

			return [
				response as Response,
				{
					status: 200
				}
			]

		case 'Error':
			return errorToResponse(response as Error, undefined, res)

		case 'Promise':
			// @ts-ignore
			return (response as any as Promise<unknown>).then((x) =>
				mapCompactResponse(x, res)
			)

		// ? Maybe response or Blob
		case 'Function':
			return mapCompactResponse((response as Function)(), res)

		case 'Number':
		case 'Boolean':
			response = (response as number | boolean).toString()

			if (res) {
				res.writeHead(200, {
					'content-type': 'text/plain;charset=utf-8',
					'content-length': (response as string).length
				})
				res.end(response)
			}

			return [
				response,
				{
					status: 200,
					headers: {
						'content-type': 'text/plain;charset=utf-8'
					}
				}
			]

		case 'Cookie':
			if (response instanceof Cookie)
				return mapCompactResponse(response.value, res)

			if (res) {
				res.writeHead(200, {
					'content-type': 'text/plain;charset=utf-8',
					'content-length': response?.toString()
				})
				res.end(response?.toString())
			}

			return [
				response?.toString(),
				{
					status: 200,
					headers: {
						'content-type': 'text/plain;charset=utf-8'
					}
				}
			]

		case 'FormData':
			if (res) {
				res.writeHead(200)
				res.end(response)
			}

			return [
				response as FormData,
				{
					status: 200
				}
			]

		default:
			if (response instanceof Response) {
				if (res) responseToValue(response, res)

				return [response, { status: 200 }]
			}

			if (response instanceof Promise)
				return response.then((x) => mapCompactResponse(x, res)) as any

			if (response instanceof Error)
				return errorToResponse(response as Error, undefined, res)

			if (response instanceof ElysiaCustomStatusResponse)
				return mapResponse(
					(response as ElysiaCustomStatusResponse<200>).response,
					{
						status: (response as ElysiaCustomStatusResponse<200>)
							.code,
						headers: {}
					},
					res
				)

			// @ts-expect-error
			if (typeof response?.next === 'function')
				return handleStream(response as any, undefined, res)

			if ('toResponse' in (response as any))
				return mapCompactResponse(
					(response as any).toResponse() as Response
				)

			if ('charCodeAt' in (response as any)) {
				const code = (response as any).charCodeAt(0)

				if (code === 123 || code === 91) {
					response = JSON.stringify(response)

					if (res) {
						res.writeHead(200, {
							'content-type': 'application/json;charset=utf8',
							'content-length': (response as string).length
						})
						res.end(response)
					}

					return [response, { status: 200 } as SetResponse]
				}
			}

			if (res) {
				res.writeHead(200, {
					'content-type': 'text/plain;charset=utf-8',
					'content-length': (response as string).length
				})
				res.end(response)
			}

			return [
				response as any,
				{
					status: 200,
					headers: {
						'content-type': 'text/plain;charset=utf-8'
					}
				}
			]
	}
}

export const errorToResponse = (
	error: Error,
	set?: Context['set'],
	res?: HttpResponse
) => {
	const response = JSON.stringify({
		name: error?.name,
		message: error?.message,
		cause: error?.cause
	})
	let status: number = set?.status as number
	if (!status) status = 500
	if (set?.status === 200) status = 500

	let headers = set?.headers
	if (!headers)
		headers = {
			'content-length': response.length as any,
			'content-type': 'application/json;charset=utf-8'
		}
	else {
		headers['content-length'] = response.length as any
		headers['content-type'] = 'application/json;charset=utf-8'
	}

	if (res) {
		console.log(200, headers)
		res.writeHead(200, headers)
		res.end(response)
	}

	return [
		response,
		{
			status,
			headers
		}
	] as const satisfies ElysiaNodeResponse
}

export const readableStreamToReadable = (webStream: ReadableStream) =>
	new Readable({
		async read() {
			const reader = webStream.getReader()

			try {
				// eslint-disable-next-line no-constant-condition
				while (true) {
					const { done, value } = await reader.read()

					if (done) break

					this.push(Buffer.from(value))
				}
			} catch (error) {
				this.destroy(error as Error)
			}
		}
	})

export const responseToValue = (r: Response, res: HttpResponse) => {
	for (const [name, value] of Object.entries(r.headers))
		res.setHeader(name, value)

	res.statusCode = r.status
	r.arrayBuffer()
		.then(res.end)
		.catch((error) => errorToResponse(error, undefined, res))
}
