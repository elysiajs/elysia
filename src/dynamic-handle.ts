import type { Elysia } from '.'

import { mapEarlyResponse, mapResponse } from './handler'
import { ElysiaErrors, NotFoundError, ValidationError } from './error'

import type { Context } from './context'
import type { Handler, LifeCycleStore, SchemaValidator } from './types'

import { parse as parseQuery } from 'fast-querystring'
import { TypeCheck } from '@sinclair/typebox/compiler'
import { TObject } from '@sinclair/typebox'

import { sign as signCookie } from 'cookie-signature'
import { parseCookie } from './cookie'

// JIT Handler
export type DynamicHandler = {
	handle: Handler<any, any>
	content?: string
	hooks: LifeCycleStore
	validator?: SchemaValidator
}

export const createDynamicHandler =
	(app: Elysia<any, any, any, any, any>) =>
	async (request: Request): Promise<Response> => {
		const set: Context['set'] = {
			cookie: {},
			status: 200,
			headers: {}
		}

		let context: Context

		// @ts-ignore
		if (app.decorators) {
			// @ts-ignore
			context = app.decorators as any as Context

			context.request = request
			context.set = set
			context.store = app.store
		} else {
			context = {
				set,
				store: app.store,
				request
			} as any as Context
		}

		const url = request.url,
			s = url.indexOf('/', 11),
			q = url.indexOf('?', s + 1),
			path = q === -1 ? url.substring(s) : url.substring(s, q)

		try {
			for (let i = 0; i < app.event.request.length; i++) {
				// @ts-ignore
				const onRequest = app.event.request[i]
				let response = onRequest(context as any)
				if (response instanceof Promise) response = await response

				response = mapEarlyResponse(response, set)
				if (response) return response
			}

			const handler =
				// @ts-ignore
				app.dynamicRouter.find(request.method, path) ??
				// @ts-ignore
				app.dynamicRouter.find('ALL', path)

			if (!handler) throw new NotFoundError()

			const { handle, hooks, validator, content } = handler.store

			let body: string | Record<string, any> | undefined
			if (request.method !== 'GET' && request.method !== 'HEAD') {
				if (content) {
					switch (content) {
						case 'application/json':
							body = await request.json()
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

						for (let i = 0; i < app.event.parse.length; i++) {
							// @ts-ignore
							let temp = app.event.parse[i](context, contentType)
							if (temp instanceof Promise) temp = await temp

							if (temp) {
								body = temp
								break
							}
						}

						// body might be empty string thus can't use !body
						if (body === undefined) {
							switch (contentType) {
								case 'application/json':
									body = await request.json()
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

			context.body = body
			// @ts-ignore
			context.params = handler?.params || undefined
			context.query = q === -1 ? {} : parseQuery(url.substring(q + 1))

			context.headers = {}
			for (const [key, value] of request.headers.entries())
				context.headers[key] = value

			// @ts-ignore
			const cookieMeta = validator?.cookie?.schema as {
				secrets?: string | string[]
				sign: string[] | true
				properties: { [x: string]: Object }
			}

			context.cookie = parseCookie(
				context.set,
				context.headers.cookie,
				cookieMeta
					? {
							secret:
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
			)

			if (body && validator?.body?.Decode)
				context.body = (validator.body as TypeCheck<TObject>).Decode(
					body
				) as any

			if (context.query && validator?.query?.Decode)
				context.query = (validator.query as TypeCheck<TObject>).Decode(
					context.query
				) as any

			if (context.params && validator?.params?.Decode)
				// @ts-ignore
				context.params = (
					validator.params as TypeCheck<TObject>
				).Decode(context.params) as any

			if (context.cookie && validator?.cookie?.Decode)
				// @ts-ignore
				context.cookie = (
					validator.cookie as TypeCheck<TObject>
				).Decode(context.cookie) as any

			if (context.headers && validator?.headers?.Decode)
				context.headers = (
					validator.headers as TypeCheck<TObject>
				).Decode(context.headers) as any

			for (let i = 0; i < hooks.transform.length; i++) {
				const operation = hooks.transform[i](context)

				// @ts-ignore
				if (hooks.transform[i].$elysia === 'derive') {
					if (operation instanceof Promise)
						Object.assign(context, await operation)
					else Object.assign(context, operation)
				} else if (operation instanceof Promise) await operation
			}

			if (validator) {
				if (validator.headers) {
					const _header: Record<string, string> = {}
					for (const key in request.headers)
						_header[key] = request.headers.get(key)!

					if (validator.headers.Check(_header) === false)
						throw new ValidationError(
							'header',
							validator.headers,
							_header
						)
				}

				if (validator.params?.Check(context.params) === false)
					throw new ValidationError(
						'params',
						validator.params,
						context.params
					)

				if (validator.query?.Check(context.query) === false)
					throw new ValidationError(
						'query',
						validator.query,
						context.query
					)

				if (validator.cookie) {
					const cookieValue: Record<string, unknown> = {}
					for (const [key, value] of Object.entries(context.cookie))
						cookieValue[key] = value.value

					if (validator.cookie?.Check(cookieValue) === false)
						throw new ValidationError(
							'cookie',
							validator.cookie,
							cookieValue
						)
				}

				if (validator.body?.Check(body) === false)
					throw new ValidationError('body', validator.body, body)
			}

			for (let i = 0; i < hooks.beforeHandle.length; i++) {
				let response = hooks.beforeHandle[i](context)
				if (response instanceof Promise) response = await response

				// `false` is a falsey value, check for undefined instead
				if (response !== undefined) {
					;(
						context as Context & {
							response: unknown
						}
					).response = response

					for (let i = 0; i < hooks.afterHandle.length; i++) {
						let newResponse = hooks.afterHandle[i](
							context as Context & {
								response: unknown
							}
						)
						if (newResponse instanceof Promise)
							newResponse = await newResponse

						if (newResponse) response = newResponse
					}

					const result = mapEarlyResponse(response, context.set)
					if (result) return result
				}
			}

			let response = handle(context)
			if (response instanceof Promise) response = await response

			if (!hooks.afterHandle.length) {
				const responseValidator = validator?.response?.[response.status]

				if (responseValidator?.Check(response) === false)
					throw new ValidationError(
						'response',
						responseValidator,
						response
					)
			} else {
				;(
					context as Context & {
						response: unknown
					}
				).response = response

				for (let i = 0; i < hooks.afterHandle.length; i++) {
					let newResponse = hooks.afterHandle[i](
						context as Context & {
							response: unknown
						}
					)
					if (newResponse instanceof Promise)
						newResponse = await newResponse

					const result = mapEarlyResponse(newResponse, context.set)
					if (result !== undefined) {
						const responseValidator =
							validator?.response?.[response.status]

						if (responseValidator?.Check(result) === false)
							throw new ValidationError(
								'response',
								responseValidator,
								result
							)

						return result
					}
				}
			}

			if (context.set.cookie && cookieMeta?.sign) {
				const secret = !cookieMeta.secrets
					? undefined
					: typeof cookieMeta.secrets === 'string'
					? cookieMeta.secrets
					: cookieMeta.secrets[0]

				if (cookieMeta.sign === true)
					for (const [key, cookie] of Object.entries(
						context.set.cookie
					))
						context.set.cookie[key].value = signCookie(
							cookie.value,
							'${secret}'
						)
				else
					for (const name of cookieMeta.sign) {
						if (!(name in cookieMeta.properties)) continue

						if (context.set.cookie[name]?.value) {
							context.set.cookie[name].value = signCookie(
								context.set.cookie[name].value,
								secret as any
							)
						}
					}
			}

			return mapResponse(response, context.set)
		} catch (error) {
			if ((error as ElysiaErrors).status)
				set.status = (error as ElysiaErrors).status

			// @ts-ignore
			return app.handleError(context, error)
		} finally {
			// @ts-ignore
			for (const onResponse of app.event.onResponse)
				await onResponse(context)
		}
	}

export const createDynamicErrorHandler =
	(app: Elysia<any, any, any, any, any, any>) =>
	async (context: Context, error: ElysiaErrors) => {
		const errorContext = Object.assign(context, error)
		errorContext.set = context.set

		// @ts-ignore
		for (let i = 0; i < app.event.error.length; i++) {
			let response = app.event.error[i](errorContext as any)
			if (response instanceof Promise) response = await response
			if (response !== undefined && response !== null)
				return mapResponse(response, context.set)
		}

		return new Response(
			typeof error.cause === 'string' ? error.cause : error.message,
			{
				headers: context.set.headers,
				status: error.status ?? 500
			}
		)
	}
