import type { Elysia } from '.'

import { mapEarlyResponse, mapResponse } from './handler'
import {
	ELYSIA_RESPONSE,
	ElysiaErrors,
	NotFoundError,
	ValidationError
} from './error'

import type { Context } from './context'
import { type error } from './error'

import { parseQuery } from './fast-querystring'

import { redirect, signCookie, StatusMap } from './utils'
import { parseCookie } from './cookies'

import type { Handler, LifeCycleStore, SchemaValidator } from './types'

// JIT Handler
export type DynamicHandler = {
	handle: Handler<any, any>
	content?: string
	hooks: LifeCycleStore
	validator?: SchemaValidator
}

export const createDynamicHandler =
	(app: Elysia<any, any, any, any, any, any, any, any>) =>
	async (request: Request): Promise<Response> => {
		const url = request.url,
			s = url.indexOf('/', 11),
			qi = url.indexOf('?', s + 1),
			path = qi === -1 ? url.substring(s) : url.substring(s, qi)

		const set: Context['set'] = {
			cookie: {},
			status: 200,
			headers: {}
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
				redirect
			}
		) as unknown as Context & {
			response: unknown
		}

		try {
			for (let i = 0; i < app.event.request.length; i++) {
				const onRequest = app.event.request[i].fn
				let response = onRequest(context as any)
				if (response instanceof Promise) response = await response

				response = mapEarlyResponse(response, set)
				if (response) return (context.response = response)
			}

			const handler =
				app.router.dynamic.find(request.method, path) ??
				app.router.dynamic.find('ALL', path)

			if (!handler) throw new NotFoundError()

			const { handle, hooks, validator, content } = handler.store

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

			context.body = body
			// @ts-expect-error
			context.params = handler?.params || undefined
			context.query = qi === -1 ? {} : parseQuery(url.substring(qi + 1))

			context.headers = {}
			for (const [key, value] of request.headers.entries())
				context.headers[key] = value

			const cookieMeta = Object.assign(
				{},
				app.config?.cookie,
				// @ts-expect-error
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

			for (let i = 0; i < hooks.transform.length; i++) {
				const hook = hooks.transform[i]
				const operation = hook.fn(context)

				if (hook.subType === 'derive') {
					if (operation instanceof Promise)
						Object.assign(context, await operation)
					else Object.assign(context, operation)
				} else if (operation instanceof Promise) await operation
			}

			if (validator) {
				if (validator.createHeaders?.()) {
					const _header: Record<string, string> = {}
					for (const key in request.headers)
						_header[key] = request.headers.get(key)!

					if (validator.headers!.Check(_header) === false)
						throw new ValidationError(
							'header',
							validator.headers!,
							_header
						)
				}

				if (validator.createParams?.()?.Check(context.params) === false)
					throw new ValidationError(
						'params',
						validator.params!,
						context.params
					)

				if (validator.createQuery?.()?.Check(context.query) === false)
					throw new ValidationError(
						'query',
						validator.query!,
						context.query
					)

				if (validator.createCookie?.()) {
					const cookieValue: Record<string, unknown> = {}
					for (const [key, value] of Object.entries(context.cookie))
						cookieValue[key] = value.value

					if (validator.cookie!.Check(cookieValue) === false)
						throw new ValidationError(
							'cookie',
							validator.cookie!,
							cookieValue
						)
				}

				if (validator.createBody?.()?.Check(body) === false)
					throw new ValidationError('body', validator.body!, body)
			}

			for (let i = 0; i < hooks.beforeHandle.length; i++) {
				let response = hooks.beforeHandle[i].fn(context)
				if (response instanceof Promise) response = await response

				// `false` is a falsey value, check for undefined instead
				if (response !== undefined) {
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

						if (newResponse) response = newResponse
					}

					const result = mapEarlyResponse(response, context.set)
					if (result) return (context.response = result)
				}
			}

			let response = handle(context)
			if (response instanceof Promise) response = await response

			if (!hooks.afterHandle.length) {
				const status =
					(response as ReturnType<typeof error>)?.[ELYSIA_RESPONSE] ??
					(set.status
						? typeof set.status === 'string'
							? StatusMap[set.status]
							: set.status
						: 200)

				const responseValidator =
					validator?.createResponse?.()?.[status]

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
					let newResponse = hooks.afterHandle[i].fn(
						context as Context & {
							response: unknown
						}
					)
					if (newResponse instanceof Promise)
						newResponse = await newResponse

					const result = mapEarlyResponse(newResponse, context.set)
					if (result !== undefined) {
						const responseValidator =
							validator?.response?.[result.status]

						if (responseValidator?.Check(result) === false)
							throw new ValidationError(
								'response',
								responseValidator,
								result
							)

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

				if (cookieMeta.sign === true)
					for (const [key, cookie] of Object.entries(
						context.set.cookie
					))
						context.set.cookie[key].value = await signCookie(
							cookie.value as any,
							'${secret}'
						)
				else {
					// @ts-expect-error private
					const properties = validator?.cookie?.schema?.properties

					for (const name of cookieMeta.sign) {
						if (!(name in properties)) continue

						if (context.set.cookie[name]?.value) {
							context.set.cookie[name].value = await signCookie(
								context.set.cookie[name].value as any,
								secret as any
							)
						}
					}
				}
			}

			return (context.response = mapResponse(response, context.set))
		} catch (error) {
			if ((error as ElysiaErrors).status)
				set.status = (error as ElysiaErrors).status

			// @ts-expect-error private
			return app.handleError(context, error)
		} finally {
			for (const afterResponse of app.event.afterResponse)
				await afterResponse.fn(context as any)
		}
	}

export const createDynamicErrorHandler =
	(app: Elysia<any, any, any, any, any, any, any, any>) =>
	async (
		context: Context & {
			response: unknown
		},
		error: ElysiaErrors
	) => {
		const errorContext = Object.assign(context, { error, code: error.code })
		errorContext.set = context.set

		for (let i = 0; i < app.event.error.length; i++) {
			const hook = app.event.error[i]
			let response = hook.fn(errorContext as any)
			if (response instanceof Promise) response = await response
			if (response !== undefined && response !== null)
				return (context.response = mapResponse(response, context.set))
		}

		return new Response(
			typeof error.cause === 'string' ? error.cause : error.message,
			{
				headers: context.set.headers,
				status: error.status ?? 500
			}
		)
	}
