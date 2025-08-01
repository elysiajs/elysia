import type { AnyElysia } from '.'

import { TransformDecodeError } from '@sinclair/typebox/value'
import { TypeCheck } from './type-system'

import type { Context } from './context'
import type { ElysiaTypeCheck } from './schema'

import {
	ElysiaCustomStatusResponse,
	ElysiaErrors,
	status,
	NotFoundError,
	ValidationError
} from './error'

import { parseQuery } from './parse-query'

import { redirect, signCookie, StatusMap } from './utils'
import { parseCookie } from './cookies'

import type { Handler, LifeCycleStore, SchemaValidator } from './types'

// JIT Handler
export type DynamicHandler = {
	handle: unknown | Handler<any, any>
	content?: string
	hooks: Partial<LifeCycleStore>
	validator?: SchemaValidator
	route: string
}

const injectDefaultValues = (
	typeChecker: TypeCheck<any> | ElysiaTypeCheck<any>,
	obj: Record<string, any>
) => {
	for (const [key, keySchema] of Object.entries(
		// @ts-expect-error private
		typeChecker.schema.properties
	)) {
		// @ts-expect-error private
		obj[key] ??= keySchema.default
	}
}

export const createDynamicHandler = (app: AnyElysia) => {
	const { mapResponse, mapEarlyResponse } = app['~adapter'].handler

	// @ts-ignore
	const defaultHeader = app.setHeaders

	return async (request: Request): Promise<Response> => {
		const url = request.url,
			s = url.indexOf('/', 11),
			qi = url.indexOf('?', s + 1),
			path = qi === -1 ? url.substring(s) : url.substring(s, qi)

		const set: Context['set'] = {
			cookie: {},
			status: 200,
			headers: defaultHeader ? { ...defaultHeader } : {}
		}

		const context = Object.assign(
			{},
			// @ts-expect-error
			app.singleton.decorator,
			{
				set,
				// @ts-expect-error
				store: app.singleton.store,
				request,
				path,
				qi,
				error: status,
				status,
				redirect
			}
		) as unknown as Context & {
			response: unknown
		}

		try {
			if (app.event.request)
				for (let i = 0; i < app.event.request.length; i++) {
					const onRequest = app.event.request[i].fn
					let response = onRequest(context as any)
					if (response instanceof Promise) response = await response

					response = mapEarlyResponse(response, set)
					if (response) return (context.response = response)
				}

			const isWS =
				request.method === 'GET' &&
				request.headers.get('upgrade')?.toLowerCase() === 'websocket'

			const methodKey = isWS ? 'WS' : request.method

			const handler =
				app.router.dynamic.find(request.method, path) ??
				app.router.dynamic.find(methodKey, path) ??
				app.router.dynamic.find('ALL', path)

			if (!handler) throw new NotFoundError()

			const { handle, hooks, validator, content, route } = handler.store

			let body: string | Record<string, any> | undefined
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				if (content) {
					switch (content) {
						case 'application/json':
							body = (await request.json()) as any
							break

						case 'text/plain':
							body = await request.text()
							break

						case 'application/x-www-form-urlencoded':
							body = parseQuery(await request.text())
							break

						case 'application/octet-stream':
							body = await request.arrayBuffer()
							break

						case 'multipart/form-data':
							body = {}

							const form = await request.formData()
							for (const key of form.keys()) {
								if (body[key]) continue

								const value = form.getAll(key)
								if (value.length === 1) body[key] = value[0]
								else body[key] = value
							}

							break
					}
				} else {
					let contentType = request.headers.get('content-type')

					if (contentType) {
						const index = contentType.indexOf(';')
						if (index !== -1)
							contentType = contentType.slice(0, index)

						// @ts-expect-error
						context.contentType = contentType

						if (hooks.parse)
							for (let i = 0; i < hooks.parse.length; i++) {
								const hook = hooks.parse[i].fn
								let temp = hook(context as any, contentType)
								if (temp instanceof Promise) temp = await temp

								if (temp) {
									body = temp
									break
								}
							}

						// @ts-expect-error
						delete context.contentType

						// body might be empty string thus can't use !body
						if (body === undefined) {
							switch (contentType) {
								case 'application/json':
									body = (await request.json()) as any
									break

								case 'text/plain':
									body = await request.text()
									break

								case 'application/x-www-form-urlencoded':
									body = parseQuery(await request.text())
									break

								case 'application/octet-stream':
									body = await request.arrayBuffer()
									break

								case 'multipart/form-data':
									body = {}

									const form = await request.formData()
									for (const key of form.keys()) {
										if (body[key]) continue

										const value = form.getAll(key)
										if (value.length === 1)
											body[key] = value[0]
										else body[key] = value
									}

									break
							}
						}
					}
				}
			}

			context.route = route
			context.body = body
			context.params = handler?.params || undefined

			// @ts-ignore
			context.query = qi === -1 ? {} : parseQuery(url.substring(qi + 1))

			context.headers = {}
			for (const [key, value] of request.headers.entries())
				context.headers[key] = value

			const cookieMeta = Object.assign(
				{},
				app.config?.cookie,
				validator?.cookie?.config
			) as {
				secrets?: string | string[]
				sign: string[] | true
				properties: { [x: string]: Object }
			}

			const cookieHeaderValue = request.headers.get('cookie')

			context.cookie = (await parseCookie(
				context.set,
				cookieHeaderValue,
				cookieMeta
					? {
							secrets:
								cookieMeta.secrets !== undefined
									? typeof cookieMeta.secrets === 'string'
										? cookieMeta.secrets
										: cookieMeta.secrets.join(',')
									: undefined,
							sign:
								cookieMeta.sign === true
									? true
									: cookieMeta.sign !== undefined
										? typeof cookieMeta.sign === 'string'
											? cookieMeta.sign
											: cookieMeta.sign.join(',')
										: undefined
						}
					: undefined
			)) as any

			const headerValidator = validator?.createHeaders?.()
			if (headerValidator)
				injectDefaultValues(headerValidator, context.headers)

			const paramsValidator = validator?.createParams?.()
			if (paramsValidator)
				injectDefaultValues(paramsValidator, context.params)

			const queryValidator = validator?.createQuery?.()
			if (queryValidator)
				injectDefaultValues(queryValidator, context.query)

			if (hooks.transform)
				for (let i = 0; i < hooks.transform.length; i++) {
					const hook = hooks.transform[i]
					let response = hook.fn(context)

					if (response instanceof Promise) response = await response

					// @ts-ignore jusut in case
					if (response instanceof ElysiaCustomStatusResponse) {
						const result = mapEarlyResponse(response, context.set)
						if (result)
							return (context.response = result) as Response
					}

					if (hook.subType === 'derive')
						Object.assign(context, response)
				}

			if (validator) {
				if (headerValidator) {
					const _header = structuredClone(context.headers)
					for (const [key, value] of request.headers)
						_header[key] = value

					if (validator.headers!.Check(_header) === false)
						throw new ValidationError(
							'header',
							validator.headers!,
							_header
						)
				} else if (validator.headers?.Decode)
					// @ts-ignore
					context.headers = validator.headers.Decode(context.headers)

				if (paramsValidator?.Check(context.params) === false) {
					throw new ValidationError(
						'params',
						validator.params!,
						context.params
					)
				} else if (validator.params?.Decode)
					// @ts-ignore
					context.params = validator.params.Decode(context.params)

				if (queryValidator?.Check(context.query) === false)
					throw new ValidationError(
						'query',
						validator.query!,
						context.query
					)
				else if (validator.query?.Decode)
					context.query = validator.query.Decode(context.query) as any

				if (validator.createCookie?.()) {
					let cookieValue: Record<string, unknown> = {}
					for (const [key, value] of Object.entries(context.cookie))
						cookieValue[key] = value.value

					if (validator.cookie!.Check(cookieValue) === false)
						throw new ValidationError(
							'cookie',
							validator.cookie!,
							cookieValue
						)
					else if (validator.cookie?.Decode)
						cookieValue = validator.cookie.Decode(
							cookieValue
						) as any
				}

				if (validator.createBody?.()?.Check(body) === false)
					throw new ValidationError('body', validator.body!, body)
				else if (validator.body?.Decode)
					context.body = validator.body.Decode(body) as any
			}

			if (hooks.beforeHandle)
				for (let i = 0; i < hooks.beforeHandle.length; i++) {
					const hook = hooks.beforeHandle[i]
					let response = hook.fn(context)
					if (response instanceof Promise) response = await response

					if (response instanceof ElysiaCustomStatusResponse) {
						const result = mapEarlyResponse(response, context.set)
						if (result)
							return (context.response = result) as Response
					}

					if (hook.subType === 'resolve') {
						Object.assign(context, response)
						continue
					}

					// `false` is a falsey value, check for undefined instead
					if (response !== undefined) {
						;(
							context as Context & {
								response: unknown
							}
						).response = response

						if (hooks.afterHandle)
							for (let i = 0; i < hooks.afterHandle.length; i++) {
								let newResponse = hooks.afterHandle[i].fn(
									context as Context & {
										response: unknown
									}
								)
								if (newResponse instanceof Promise)
									newResponse = await newResponse

								if (newResponse) response = newResponse
							}

						const result = mapEarlyResponse(response, context.set)
						// @ts-expect-error
						if (result) return (context.response = result)
					}
				}

			let response =
				typeof handle === 'function' ? handle(context) : handle
			if (response instanceof Promise) response = await response

			if (hooks.afterHandle)
				if (!hooks.afterHandle.length) {
					const status =
						response instanceof ElysiaCustomStatusResponse
							? response.code
							: set.status
								? typeof set.status === 'string'
									? StatusMap[set.status]
									: set.status
								: 200

					const responseValidator =
						validator?.createResponse?.()?.[status]

					if (responseValidator?.Check(response) === false)
						throw new ValidationError(
							'response',
							responseValidator,
							response
						)
					else if (responseValidator?.Encode)
						response = responseValidator.Encode(response)
				} else {
					;(
						context as Context & {
							response: unknown
						}
					).response = response

					for (let i = 0; i < hooks.afterHandle.length; i++) {
						let newResponse = hooks.afterHandle[i].fn(
							context as Context & {
								response: unknown
							}
						)
						if (newResponse instanceof Promise)
							newResponse = await newResponse

						const result = mapEarlyResponse(
							newResponse,
							context.set
						)
						if (result !== undefined) {
							const responseValidator =
								// @ts-expect-error
								validator?.response?.[result.status]

							if (responseValidator?.Check(result) === false)
								throw new ValidationError(
									'response',
									responseValidator,
									result
								)
							else if (responseValidator?.Encode)
								response = responseValidator.Encode(response)

							// @ts-expect-error
							return (context.response = result)
						}
					}
				}

			if (context.set.cookie && cookieMeta?.sign) {
				const secret = !cookieMeta.secrets
					? undefined
					: typeof cookieMeta.secrets === 'string'
						? cookieMeta.secrets
						: cookieMeta.secrets[0]

				if (cookieMeta.sign === true) {
					if (secret)
						for (const [key, cookie] of Object.entries(
							context.set.cookie
						))
							context.set.cookie[key].value = await signCookie(
								cookie.value as any,
								secret
							)
				} else {
					const properties = validator?.cookie?.schema?.properties

					if (secret)
						for (const name of cookieMeta.sign) {
							if (!(name in properties)) continue

							if (context.set.cookie[name]?.value) {
								context.set.cookie[name].value =
									await signCookie(
										context.set.cookie[name].value as any,
										secret
									)
							}
						}
				}
			}

			// @ts-expect-error
			return mapResponse((context.response = response), context.set)
		} catch (error) {
			const reportedError =
				error instanceof TransformDecodeError && error.error
					? error.error
					: error

			// ? Since error is reconciled in mergeResponseWithHeaders, this is not needed (if I'm not drunk)
			// if ((reportedError as ElysiaErrors).status)
			// 	set.status = (reportedError as ElysiaErrors).status

			// @ts-expect-error private
			return app.handleError(context, reportedError)
		} finally {
			if (app.event.afterResponse)
				for (const afterResponse of app.event.afterResponse)
					await afterResponse.fn(context as any)
		}
	}
}

export const createDynamicErrorHandler = (app: AnyElysia) => {
	const { mapResponse } = app['~adapter'].handler

	return async (
		context: Context & {
			response: unknown
		},
		error: ElysiaErrors
	) => {
		const errorContext = Object.assign(context, { error, code: error.code })
		errorContext.set = context.set

		if (app.event.error)
			for (let i = 0; i < app.event.error.length; i++) {
				const hook = app.event.error[i]
				let response = hook.fn(errorContext as any)
				if (response instanceof Promise) response = await response
				if (response !== undefined && response !== null)
					return (context.response = mapResponse(
						response,
						context.set
					))
			}

		return new Response(
			typeof error.cause === 'string' ? error.cause : error.message,
			{
				headers: context.set.headers as any,
				status: error.status ?? 500
			}
		)
	}
}
