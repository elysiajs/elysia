import type { AnyElysia, CookieOptions } from '.'

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
	// @ts-expect-error private property
	let schema = typeChecker.schema
	if (!schema) return

	if (schema.$defs?.[schema.$ref]) schema = schema.$defs[schema.$ref]

	if (!schema?.properties) return

	for (const [key, keySchema] of Object.entries(schema.properties)) {
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

			if (!handler) {
				// @ts-ignore
				context.query =
					qi === -1 ? {} : parseQuery(url.substring(qi + 1))

				throw new NotFoundError()
			}

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
					let contentType
					if (request.body)
						contentType = request.headers.get('content-type')

					if (contentType) {
						const index = contentType.indexOf(';')
						if (index !== -1)
							contentType = contentType.slice(0, index)

						// @ts-expect-error
						context.contentType = contentType

						if (hooks.parse)
							for (let i = 0; i < hooks.parse.length; i++) {
								const hook = hooks.parse[i].fn

								if (typeof hook === 'string')
									switch (hook) {
										case 'json':
										case 'application/json':
											body = (await request.json()) as any
											break

										case 'text':
										case 'text/plain':
											body = await request.text()
											break

										case 'urlencoded':
										case 'application/x-www-form-urlencoded':
											body = parseQuery(
												await request.text()
											)
											break

										case 'arrayBuffer':
										case 'application/octet-stream':
											body = await request.arrayBuffer()
											break

										case 'formdata':
										case 'multipart/form-data':
											body = {}

											const form =
												await request.formData()
											for (const key of form.keys()) {
												if (body[key]) continue

												const value = form.getAll(key)
												if (value.length === 1)
													body[key] = value[0]
												else body[key] = value
											}

											break

										default:
											const parser = app['~parser'][hook]
											if (parser) {
												let temp = parser(
													context as any,
													contentType
												)
												if (temp instanceof Promise)
													temp = await temp

												if (temp) {
													body = temp
													break
												}
											}
											break
									}
								else {
									let temp = hook(context as any, contentType)
									if (temp instanceof Promise)
										temp = await temp

									if (temp) {
										body = temp
										break
									}
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

			const cookieMeta = {
				domain:
					app.config.cookie?.domain ??
					// @ts-ignore
					validator?.cookie?.config.domain,
				expires:
					app.config.cookie?.expires ??
					// @ts-ignore
					validator?.cookie?.config.expires,
				httpOnly:
					app.config.cookie?.httpOnly ??
					// @ts-ignore
					validator?.cookie?.config.httpOnly,
				maxAge:
					app.config.cookie?.maxAge ??
					// @ts-ignore
					validator?.cookie?.config.maxAge,
				// @ts-ignore
				path: app.config.cookie?.path ?? validator?.cookie?.config.path,
				priority:
					app.config.cookie?.priority ??
					// @ts-ignore
					validator?.cookie?.config.priority,
				partitioned:
					app.config.cookie?.partitioned ??
					// @ts-ignore
					validator?.cookie?.config.partitioned,
				sameSite:
					app.config.cookie?.sameSite ??
					// @ts-ignore
					validator?.cookie?.config.sameSite,
				secure:
					app.config.cookie?.secure ??
					// @ts-ignore
					validator?.cookie?.config.secure,
				secrets:
					app.config.cookie?.secrets ??
					// @ts-ignore
					validator?.cookie?.config.secrets,
				// @ts-ignore
				sign: app.config.cookie?.sign ?? validator?.cookie?.config.sign
			} as CookieOptions & {
				sign?: true | string | string[]
			}

			const cookieHeaderValue = request.headers.get('cookie')

			context.cookie = (await parseCookie(
				context.set,
				cookieHeaderValue,
				cookieMeta
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

				if (validator.query?.schema) {
					let schema = validator.query.schema
					if (schema.$defs?.[schema.$ref])
						schema = schema.$defs[schema.$ref]

					const properties = schema.properties

					for (const property of Object.keys(properties)) {
						const value = properties[property]
						if (
							(value.type === 'array' ||
								value.items?.type === 'string') &&
							typeof context.query[property] === 'string' &&
							context.query[property]
						) {
							// @ts-ignore
							context.query[property] =
								context.query[property].split(',')
						}
					}
				}

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

			if (!hooks.afterHandle?.length) {
				const isCustomStatuResponse =
					response instanceof ElysiaCustomStatusResponse

				const status = isCustomStatuResponse
					? response.code
					: set.status
						? typeof set.status === 'string'
							? StatusMap[set.status]
							: set.status
						: 200

				if (isCustomStatuResponse) {
					set.status = status
					response = response.response
				}

				const responseValidator =
					validator?.createResponse?.()?.[status]

				if (responseValidator?.Check(response) === false) {
					if (responseValidator?.Clean) {
						const temp = responseValidator.Clean(response)
						if (responseValidator?.Check(temp) === false)
							throw new ValidationError(
								'response',
								responseValidator,
								response
							)

						response = temp
					} else
						throw new ValidationError(
							'response',
							responseValidator,
							response
						)
				}

				if (responseValidator?.Encode)
					response = responseValidator.Encode(response)

				if (responseValidator?.Clean)
					response = responseValidator.Clean(response)
			} else {
				;(
					context as Context & {
						response: unknown
					}
				).response = response

				for (let i = 0; i < hooks.afterHandle.length; i++) {
					let response: unknown = hooks.afterHandle[i].fn(
						context as Context & {
							response: unknown
						}
					)
					if (response instanceof Promise) response = await response

					const isCustomStatuResponse =
						response instanceof ElysiaCustomStatusResponse

					const status = isCustomStatuResponse
						? (response as ElysiaCustomStatusResponse<any>).code
						: set.status
							? typeof set.status === 'string'
								? StatusMap[set.status]
								: set.status
							: 200

					if (isCustomStatuResponse) {
						set.status = status
						response = (response as ElysiaCustomStatusResponse<any>)
							.response
					}

					const responseValidator =
						validator?.createResponse?.()?.[status]

					if (responseValidator?.Check(response) === false) {
						if (responseValidator?.Clean) {
							const temp = responseValidator.Clean(response)
							if (responseValidator?.Check(temp) === false)
								throw new ValidationError(
									'response',
									responseValidator,
									response
								)

							response = temp
						} else
							throw new ValidationError(
								'response',
								responseValidator,
								response
							)
					}

					if (responseValidator?.Encode)
						context.response = response =
							responseValidator.Encode(response)

					if (responseValidator?.Clean)
						context.response = response =
							responseValidator.Clean(response)

					const result = mapEarlyResponse(response, context.set)
					// @ts-ignore
					if (result !== undefined) return (context.response = result)
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
				setImmediate(async () => {
					for (const afterResponse of app.event.afterResponse!)
						await afterResponse.fn(context as any)
				})
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
