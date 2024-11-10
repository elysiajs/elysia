import { type Elysia } from '.'

import { Value } from '@sinclair/typebox/value'
import { TypeBoxError, type TAnySchema, type TSchema } from '@sinclair/typebox'

import { parseQuery, parseQueryFromURL } from './fast-querystring'

// @ts-ignore
import decodeURIComponent from 'fast-decode-uri-component'

import {
	ELYSIA_REQUEST_ID,
	getCookieValidator,
	lifeCycleToFn,
	randomId,
	redirect,
	signCookie
} from './utils'
import { ParseError, error } from './error'

import {
	mapEarlyResponse,
	mapResponse,
	mapCompactResponse,
	isNotEmpty
} from './handler'
import {
	NotFoundError,
	ValidationError,
	InternalServerError,
	ERROR_CODE,
	ElysiaCustomStatusResponse
} from './error'
import { ELYSIA_TRACE, type TraceHandler } from './trace'

import { Sucrose, hasReturn, sucrose } from './sucrose'
import { parseCookie, type CookieOptions } from './cookies'

import type { TraceEvent } from './trace'
import type {
	ComposedHandler,
	Handler,
	HookContainer,
	LifeCycleStore,
	SchemaValidator
} from './types'
import type { TypeCheck } from './type-system'

const headersHasToJSON = (new Headers() as Headers).toJSON

const TypeBoxSymbol = {
	optional: Symbol.for('TypeBox.Optional'),
	kind: Symbol.for('TypeBox.Kind')
} as const

const isOptional = (validator?: TypeCheck<any>) => {
	if (!validator) return false

	// @ts-expect-error
	const schema = validator?.schema

	return !!schema && TypeBoxSymbol.optional in schema
}

export const hasAdditionalProperties = (
	_schema: TAnySchema | TypeCheck<any>
) => {
	if (!_schema) return false

	// @ts-expect-error private property
	const schema: TAnySchema = (_schema as TypeCheck<any>)?.schema ?? _schema

	if (schema.anyOf) return schema.anyOf.some(hasAdditionalProperties)
	if (schema.someOf) return schema.someOf.some(hasAdditionalProperties)
	if (schema.allOf) return schema.allOf.some(hasAdditionalProperties)
	if (schema.not) return schema.not.some(hasAdditionalProperties)

	if (schema.type === 'object') {
		const properties = schema.properties as Record<string, TAnySchema>

		if ('additionalProperties' in schema) return schema.additionalProperties
		if ('patternProperties' in schema) return false

		for (const key of Object.keys(properties)) {
			const property = properties[key]

			if (property.type === 'object') {
				if (hasAdditionalProperties(property)) return true
			} else if (property.anyOf) {
				for (let i = 0; i < property.anyOf.length; i++)
					if (hasAdditionalProperties(property.anyOf[i])) return true
			}

			return property.additionalProperties
		}

		return false
	}

	return false
}

const createReport = ({
	context = 'c',
	trace,
	addFn
}: {
	context?: string
	trace: (TraceHandler | HookContainer<TraceHandler>)[]
	addFn(string: string): void
}) => {
	if (!trace.length)
		return () => {
			return {
				resolveChild() {
					return () => {}
				},
				resolve() {}
			}
		}

	for (let i = 0; i < trace.length; i++)
		addFn(
			`let report${i}, reportChild${i}, reportErr${i}, reportErrChild${i}; let trace${i} = ${context}[ELYSIA_TRACE]?.[${i}] ?? trace[${i}](${context});\n`
		)

	return (
		event: TraceEvent,
		{
			name,
			total = 0
		}: {
			name?: string
			attribute?: string
			total?: number
		} = {}
	) => {
		// ? For debug specific event
		// if (event !== 'mapResponse')
		// 	return {
		// 		resolveChild() {
		// 			return () => {}
		// 		},
		// 		resolve() {}
		// 	}

		if (!name) name = 'anonymous'

		const reporter = event === 'error' ? 'reportErr' : 'report'

		for (let i = 0; i < trace.length; i++)
			addFn(
				`\n${reporter}${i} = trace${i}.${event}({` +
					`id,` +
					`event: '${event}',` +
					`name: '${name}',` +
					`begin: performance.now(),` +
					`total: ${total}` +
					`})\n`
			)

		return {
			resolve() {
				for (let i = 0; i < trace.length; i++)
					addFn(`\n${reporter}${i}.resolve()\n`)
			},
			resolveChild(name: string) {
				for (let i = 0; i < trace.length; i++)
					addFn(
						`${reporter}Child${i} = ${reporter}${i}.resolveChild?.shift()?.({` +
							`id,` +
							`event: '${event}',` +
							`name: '${name}',` +
							`begin: performance.now()` +
							`})\n`
					)

				return (binding?: string) => {
					for (let i = 0; i < trace.length; i++) {
						if (binding)
							// Don't report error because HTTP response is expected and not an actual error to look for
							// if (${binding} instanceof ElysiaCustomStatusResponse) {
							//     ${reporter}Child${i}?.(${binding}.error)
							//     ${reporter}Child${i}?.()\n
							// } else
							addFn(`
                             	if (${binding} instanceof Error)
                    				${reporter}Child${i}?.(${binding})
                           		else
                             		${reporter}Child${i}?.()\n`)
						else addFn(`${reporter}Child${i}?.()\n`)
					}
				}
			}
		}
	}
}

const composeValidationFactory = ({
	injectResponse = '',
	normalize = false,
	validator
}: {
	injectResponse?: string
	normalize?: boolean
	validator: SchemaValidator
}) => ({
	composeValidation: (type: string, value = `c.${type}`) =>
		`c.set.status = 422; throw new ValidationError('${type}', validator.${type}, ${value})`,
	composeResponseValidation: (name = 'r') => {
		let code = '\n' + injectResponse + '\n'

		code += `if(${name} instanceof ElysiaCustomStatusResponse) {
			c.set.status = ${name}.code
			${name} = ${name}.response
		}

		const isResponse = ${name} instanceof Response\n\n`

		code += `switch(c.set.status) {\n`

		for (const [status, value] of Object.entries(
			validator.response as Record<string, TypeCheck<any>>
		)) {
			code += `\tcase ${status}:
				if (!isResponse) {\n`

			if (
				normalize &&
				'Clean' in value &&
				!hasAdditionalProperties(value as any)
			)
				code += `${name} = validator.response['${status}'].Clean(${name})\n`

			code += `if(validator.response['${status}'].Check(${name}) === false) {
					c.set.status = 422

					throw new ValidationError('response', validator.response['${status}'], ${name})
				}

				c.set.status = ${status}
			}

			break\n\n`
		}

		code += '\n}\n'

		return code
	}
})

const KindSymbol = Symbol.for('TypeBox.Kind')

export const hasType = (type: string, schema: TAnySchema) => {
	if (!schema) return

	if (KindSymbol in schema && schema[KindSymbol] === type) return true

	if (schema.type === 'object') {
		const properties = schema.properties as Record<string, TAnySchema>
		for (const key of Object.keys(properties)) {
			const property = properties[key]

			if (property.type === 'object') {
				if (hasType(type, property)) return true
			} else if (property.anyOf) {
				for (let i = 0; i < property.anyOf.length; i++)
					if (hasType(type, property.anyOf[i])) return true
			}

			if (KindSymbol in property && property[KindSymbol] === type)
				return true
		}

		return false
	}

	return (
		schema.properties &&
		KindSymbol in schema.properties &&
		schema.properties[KindSymbol] === type
	)
}

export const hasProperty = (expectedProperty: string, schema: TAnySchema) => {
	if (!schema) return

	if (schema.type === 'object') {
		const properties = schema.properties as Record<string, TAnySchema>

		if (!properties) return false

		for (const key of Object.keys(properties)) {
			const property = properties[key]

			if (expectedProperty in property) return true

			if (property.type === 'object') {
				if (hasProperty(expectedProperty, property)) return true
			} else if (property.anyOf) {
				for (let i = 0; i < property.anyOf.length; i++) {
					if (hasProperty(expectedProperty, property.anyOf[i]))
						return true
				}
			}
		}

		return false
	}

	return expectedProperty in schema
}

const TransformSymbol = Symbol.for('TypeBox.Transform')

export const hasTransform = (schema: TAnySchema) => {
	if (!schema) return

	if (schema.type === 'object' && schema.properties) {
		const properties = schema.properties as Record<string, TAnySchema>
		for (const key of Object.keys(properties)) {
			const property = properties[key]

			if (property.type === 'object') {
				if (hasTransform(property)) return true
			} else if (property.anyOf) {
				for (let i = 0; i < property.anyOf.length; i++)
					if (hasTransform(property.anyOf[i])) return true
			}

			const hasTransformSymbol = TransformSymbol in property
			if (hasTransformSymbol) return true
		}

		return false
	}

	return (
		TransformSymbol in schema ||
		(schema.properties && TransformSymbol in schema.properties)
	)
}

/**
 * This function will return the type of unioned if all unioned type is the same.
 * It's intent to use for content-type mapping only
 *
 * ```ts
 * t.Union([
 *   t.Object({
 *     password: t.String()
 *   }),
 *   t.Object({
 *     token: t.String()
 *   })
 * ])
 * ```
 */
// const getUnionedType = (validator: TypeCheck<any> | undefined) => {
// 	if (!validator) return

// 	// @ts-ignore
// 	const schema = validator?.schema

// 	if (schema && 'anyOf' in schema) {
// 		let foundDifference = false
// 		const type: string = schema.anyOf[0].type

// 		for (const validator of schema.anyOf as { type: string }[]) {
// 			if (validator.type !== type) {
// 				foundDifference = true
// 				break
// 			}
// 		}

// 		if (!foundDifference) return type
// 	}

// 	// @ts-ignore
// 	return validator.schema?.type
// }

const matchFnReturn = /(?:return|=>) \S+\(/g

export const isAsyncName = (v: Function | HookContainer) => {
	// @ts-ignore
	const fn = v?.fn ?? v

	return fn.constructor.name === 'AsyncFunction'
}

export const isAsync = (v: Function | HookContainer) => {
	// @ts-ignore
	const fn = v?.fn ?? v

	if (fn.constructor.name === 'AsyncFunction') return true

	const literal = fn.toString()
	if (literal.includes('=> response.clone(')) return false
	if (literal.includes('await')) return true
	if (literal.includes('async')) return true

	return !!literal.match(matchFnReturn)
}

export const isGenerator = (v: Function | HookContainer) => {
	// @ts-ignore
	const fn = v?.fn ?? v

	return (
		fn.constructor.name === 'AsyncGeneratorFunction' ||
		fn.constructor.name === 'GeneratorFunction'
	)
}

export const composeHandler = ({
	app,
	path,
	method,
	localHook,
	hooks,
	validator,
	handler,
	allowMeta = false,
	inference
}: {
	app: Elysia<any, any, any, any, any, any, any, any>
	path: string
	method: string
	hooks: LifeCycleStore
	localHook: LifeCycleStore
	validator: SchemaValidator
	handler: unknown | Handler<any, any>
	allowMeta?: boolean
	inference: Sucrose.Inference
}): ComposedHandler => {
	const isHandleFn = typeof handler === 'function'

	if (!isHandleFn) {
		handler = mapResponse(handler, {
			// @ts-expect-error private property
			headers: app.setHeaders ?? {}
		})

		if (
			hooks.parse.length === 0 &&
			hooks.transform.length === 0 &&
			hooks.beforeHandle.length === 0 &&
			hooks.afterHandle.length === 0
		)
			return Function(
				'a',
				`return function () { return a.clone() }`
			)(handler)
	}

	const handle = isHandleFn ? `handler(c)` : `handler`
	const hasAfterResponse = hooks.afterResponse.length > 0

	const hasTrace = hooks.trace.length > 0
	let fnLiteral = ''

	inference = sucrose(
		Object.assign(localHook, {
			handler: handler as any
		}),
		inference
	)

	if (inference.server)
		fnLiteral += `\nObject.defineProperty(c, 'server', {
			get: function() { return getServer() }
		})\n`

	if (inference.body) fnLiteral += `let isParsing = false\n`

	validator.createBody?.()
	validator.createQuery?.()
	validator.createHeaders?.()
	validator.createParams?.()
	validator.createCookie?.()
	validator.createResponse?.()

	const hasQuery = inference.query || !!validator.query

	const hasBody =
		method !== '$INTERNALWS' &&
		method !== 'GET' &&
		method !== 'HEAD' &&
		(inference.body || !!validator.body || hooks.parse.length)

	// @ts-expect-error private
	const defaultHeaders = app.setHeaders
	const hasDefaultHeaders =
		defaultHeaders && !!Object.keys(defaultHeaders).length

	// ? defaultHeaders doesn't imply that user will use headers in handler
	const hasHeaders = inference.headers || validator.headers
	const hasCookie = inference.cookie || !!validator.cookie

	const cookieValidator = hasCookie
		? getCookieValidator({
				validator: validator.cookie as any,
				defaultConfig: app.config.cookie,
				dynamic: !!app.config.aot,
				// @ts-expect-error
				config: validator.cookie?.config ?? {},
				// @ts-expect-error
				models: app.definitions.type
			})
		: undefined

	// @ts-ignore private property
	const cookieMeta = cookieValidator?.config as {
		secrets?: string | string[]
		sign: string[] | true
		properties: { [x: string]: Object }
	}

	let encodeCookie = ''

	if (cookieMeta?.sign) {
		if (!cookieMeta.secrets)
			throw new Error(
				`t.Cookie required secret which is not set in (${method}) ${path}.`
			)

		const secret = !cookieMeta.secrets
			? undefined
			: typeof cookieMeta.secrets === 'string'
				? cookieMeta.secrets
				: cookieMeta.secrets[0]

		encodeCookie += `const _setCookie = c.set.cookie
		if(_setCookie) {`

		if (cookieMeta.sign === true) {
			encodeCookie += `for(const [key, cookie] of Object.entries(_setCookie)) {
				c.set.cookie[key].value = await signCookie(cookie.value, '${secret}')
			}`
		} else
			for (const name of cookieMeta.sign) {
				encodeCookie += `if(_setCookie['${name}']?.value) { c.set.cookie['${name}'].value = await signCookie(_setCookie['${name}'].value, '${secret}') }\n`
			}

		encodeCookie += '}\n'
	}

	const normalize = app.config.normalize

	const { composeValidation, composeResponseValidation } =
		composeValidationFactory({
			normalize,
			validator
		})

	if (hasHeaders) {
		// This function is Bun specific
		// @ts-ignore
		fnLiteral += headersHasToJSON
			? `c.headers = c.request.headers.toJSON()\n`
			: `c.headers = {}
                for (const [key, value] of c.request.headers.entries())
					c.headers[key] = value
				`
	}

	if (hasCookie) {
		const get = (name: keyof CookieOptions, defaultValue?: unknown) => {
			// @ts-ignore
			const value = cookieMeta?.[name] ?? defaultValue
			if (!value)
				return typeof defaultValue === 'string'
					? `${name}: "${defaultValue}",`
					: `${name}: ${defaultValue},`

			if (typeof value === 'string') return `${name}: '${value}',`
			if (value instanceof Date)
				return `${name}: new Date(${value.getTime()}),`

			return `${name}: ${value},`
		}

		const options = cookieMeta
			? `{
			secrets: ${
				cookieMeta.secrets !== undefined
					? typeof cookieMeta.secrets === 'string'
						? `'${cookieMeta.secrets}'`
						: '[' +
							cookieMeta.secrets.reduce(
								(a, b) => a + `'${b}',`,
								''
							) +
							']'
					: 'undefined'
			},
			sign: ${
				cookieMeta.sign === true
					? true
					: cookieMeta.sign !== undefined
						? '[' +
							cookieMeta.sign.reduce(
								(a, b) => a + `'${b}',`,
								''
							) +
							']'
						: 'undefined'
			},
			${get('domain')}
			${get('expires')}
			${get('httpOnly')}
			${get('maxAge')}
			${get('path', '/')}
			${get('priority')}
			${get('sameSite')}
			${get('secure')}
		}`
			: 'undefined'

		if (hasHeaders)
			fnLiteral += `\nc.cookie = await parseCookie(c.set, c.headers.cookie, ${options})\n`
		else
			fnLiteral += `\nc.cookie = await parseCookie(c.set, c.request.headers.get('cookie'), ${options})\n`
	}

	if (hasQuery) {
		const destructured = <
			{
				key: string
				isArray: boolean
				isNestedObjectArray: boolean
				isObject: boolean
				anyOf: boolean
			}[]
		>[]

		// @ts-ignore
		if (validator.query && validator.query.schema.type === 'object') {
			// @ts-expect-error private property
			const properties = validator.query.schema.properties

			if (!hasAdditionalProperties(validator.query as any))
				// eslint-disable-next-line prefer-const
				for (let [key, _value] of Object.entries(properties)) {
					let value = _value as TAnySchema

					// @ts-ignore
					if (
						value &&
						TypeBoxSymbol.optional in value &&
						value.type === 'array' &&
						value.items
					)
						value = value.items

					// @ts-ignore unknown
					const { type, anyOf } = value
					const isArray =
						type === 'array' ||
						anyOf?.some(
							(v: TSchema) =>
								v.type === 'string' &&
								v.format === 'ArrayString'
						)

					destructured.push({
						key,
						isArray,
						isNestedObjectArray:
							(isArray && value.items?.type === 'object') ||
							!!value.items?.anyOf?.some(
								// @ts-expect-error
								(x) => x.type === 'object' || x.type === 'array'
							),
						isObject:
							type === 'object' ||
							anyOf?.some(
								(v: TSchema) =>
									v.type === 'string' &&
									v.format === 'ArrayString'
							),
						anyOf: !!anyOf
					})
				}
		}

		if (!destructured.length) {
			fnLiteral += `if(c.qi === -1) {
				c.query = {}
			} else {
				c.query = parseQueryFromURL(c.url.slice(c.qi + 1))
			}`
		} else {
			fnLiteral += `if(c.qi !== -1) {
				let url = '&' + c.url.slice(c.qi + 1)

				${destructured
					.map(
						(
							{
								key,
								isArray,
								isObject,
								isNestedObjectArray,
								anyOf
							},
							index
						) => {
							const init = `${
								index === 0 ? 'let' : ''
							} memory = url.indexOf('&${key}=')
							let a${index}\n`

							if (isArray)
								return (
									init +
									(isNestedObjectArray
										? `while (memory !== -1) {
											const start = memory + ${key.length + 2}
											memory = url.indexOf('&', start)

											if(a${index} === undefined)
												a${index} = ''
											else
												a${index} += ','

											let temp

											if(memory === -1) temp = decodeURIComponent(url.slice(start).replace(/\\+/g, ' '))
											else temp = decodeURIComponent(url.slice(start, memory).replace(/\\+/g, ' '))

											const charCode = temp.charCodeAt(0)
											if(charCode !== 91 && charCode !== 123)
												temp = '"' + temp + '"'

											a${index} += temp

											if(memory === -1) break

											memory = url.indexOf('&${key}=', memory)
											if(memory === -1) break
										}

										try {
										    if(a${index}.charCodeAt(0) === 91)
												a${index} = JSON.parse(a${index})
											else
												a${index} = JSON.parse('[' + a${index} + ']')
										} catch {}\n`
										: `while (memory !== -1) {
											const start = memory + ${key.length + 2}
											memory = url.indexOf('&', start)

											if(a${index} === undefined)
												a${index} = []

											if(memory === -1) {
												a${index}.push(decodeURIComponent(url.slice(start)).replace(/\\+/g, ' '))
												break
											}
											else a${index}.push(decodeURIComponent(url.slice(start, memory)).replace(/\\+/g, ' '))

											memory = url.indexOf('&${key}=', memory)
											if(memory === -1) break
										}\n`)
								)

							if (isObject)
								return (
									init +
									`if (memory !== -1) {
										const start = memory + ${key.length + 2}
										memory = url.indexOf('&', start)

										if(memory === -1) a${index} = decodeURIComponent(url.slice(start).replace(/\\+/g, ' '))
										else a${index} = decodeURIComponent(url.slice(start, memory).replace(/\\+/g, ' '))

										if (a${index} !== undefined) {
											try {
												a${index} = JSON.parse(a${index})
											} catch {}
										}
									}`
								)

							// Might be union primitive and array
							return (
								init +
								`if (memory !== -1) {
										const start = memory + ${key.length + 2}
										memory = url.indexOf('&', start)

										if(memory === -1) a${index} = decodeURIComponent(url.slice(start).replace(/\\+/g, ' '))
										else {
											a${index} = decodeURIComponent(url.slice(start, memory).replace(/\\+/g, ' '))

											${
												anyOf
													? `
											let deepMemory = url.indexOf('&${key}=', memory)

											if(deepMemory !== -1) {
												a${index} = [a${index}]
												let first = true

												while(true) {
													const start = deepMemory + ${key.length + 2}
													if(first)
														first = false
													else
														deepMemory = url.indexOf('&', start)

													let value
													if(deepMemory === -1) value = decodeURIComponent(url.slice(start).replace(/\\+/g, ' '))
													else value = decodeURIComponent(url.slice(start, deepMemory).replace(/\\+/g, ' '))

													const vStart = value.charCodeAt(0)
													const vEnd = value.charCodeAt(value.length - 1)

													if((vStart === 91 && vEnd === 93) || (vStart === 123 && vEnd === 125))
														try {
															a${index}.push(JSON.parse(value))
														} catch {
														 	a${index}.push(value)
														}

													if(deepMemory === -1) break
												}
											}
												`
													: ''
											}
										}
									}`
							)
						}
					)
					.join('\n')}

				c.query = {
					${destructured.map(({ key }, index) => `'${key}': a${index}`).join(', ')}
				}
			} else {
				c.query = {}
			}`
		}
	}

	if (hasTrace) fnLiteral += '\nconst id = c[ELYSIA_REQUEST_ID]\n'

	const report = createReport({
		trace: hooks.trace,
		addFn: (word) => {
			fnLiteral += word
		}
	})

	fnLiteral += '\ntry {\n'
	const isAsyncHandler = typeof handler === 'function' && isAsync(handler)

	const saveResponse =
		hasTrace || hooks.afterResponse.length > 0 ? 'c.response = ' : ''

	const maybeAsync =
		hasCookie ||
		hasBody ||
		isAsyncHandler ||
		hooks.parse.length > 0 ||
		hooks.afterHandle.some(isAsync) ||
		hooks.beforeHandle.some(isAsync) ||
		hooks.transform.some(isAsync) ||
		hooks.mapResponse.some(isAsync)

	const maybeStream =
		(typeof handler === 'function' ? isGenerator(handler as any) : false) ||
		hooks.beforeHandle.some(isGenerator) ||
		hooks.afterHandle.some(isGenerator) ||
		hooks.transform.some(isGenerator)

	const hasSet =
		inference.cookie ||
		inference.set ||
		hasHeaders ||
		hasTrace ||
		validator.response ||
		(isHandleFn && hasDefaultHeaders) ||
		maybeStream

	const requestMapper = `, c.request`

	fnLiteral += `c.route = \`${path}\`\n`

	const parseReporter = report('parse', {
		total: hooks.parse.length
	})

	if (hasBody) {
		const hasBodyInference =
			hooks.parse.length || inference.body || validator.body

		fnLiteral += 'isParsing = true\n'
		if (hooks.type && !hooks.parse.length) {
			switch (hooks.type) {
				case 'json':
				case 'application/json':
					if (isOptional(validator.body))
						fnLiteral += `try { c.body = await c.request.json() } catch {}`
					else fnLiteral += `c.body = await c.request.json()`

					break

				case 'text':
				case 'text/plain':
					fnLiteral += `c.body = await c.request.text()\n`
					break

				case 'urlencoded':
				case 'application/x-www-form-urlencoded':
					fnLiteral += `c.body = parseQuery(await c.request.text())\n`
					break

				case 'arrayBuffer':
				case 'application/octet-stream':
					fnLiteral += `c.body = await c.request.arrayBuffer()\n`
					break

				case 'formdata':
				case 'multipart/form-data':
					fnLiteral += `c.body = {}\n`

					// ? If formdata body is empty, mimetype is not set, might cause an error
					if (isOptional(validator.body))
						fnLiteral += `let form; try { form = await c.request.formData() } catch {}`
					else fnLiteral += `const form = await c.request.formData()`

					fnLiteral += `\nif(form)
						for (const key of form.keys()) {
							if (c.body[key])
								continue

							const value = form.getAll(key)
							if (value.length === 1)
								c.body[key] = value[0]
							else c.body[key] = value
						} else form = {}\n`
					break
			}
		} else if (hasBodyInference) {
			fnLiteral += '\n'
			fnLiteral += hasHeaders
				? `let contentType = c.headers['content-type']`
				: `let contentType = c.request.headers.get('content-type')`

			fnLiteral += `
				if (contentType) {
					const index = contentType.indexOf(';')
					if (index !== -1) contentType = contentType.substring(0, index)\n
					c.contentType = contentType\n`

			if (hooks.parse.length) {
				fnLiteral += `let used = false\n`

				const reporter = report('parse', {
					total: hooks.parse.length
				})

				for (let i = 0; i < hooks.parse.length; i++) {
					const endUnit = reporter.resolveChild(
						hooks.parse[i].fn.name
					)

					const name = `bo${i}`

					if (i !== 0) fnLiteral += `if(!used) {\n`

					fnLiteral += `let ${name} = parse[${i}](c, contentType)\n`
					fnLiteral += `if(${name} instanceof Promise) ${name} = await ${name}\n`
					fnLiteral += `if(${name} !== undefined) { c.body = ${name}; used = true }\n`

					endUnit()

					if (i !== 0) fnLiteral += `}`
				}

				reporter.resolve()
			}

			fnLiteral += '\ndelete c.contentType\n'

			if (hooks.parse.length) fnLiteral += `if (!used) {`

			if (hooks.type && !Array.isArray(hooks.type)) {
				switch (hooks.type) {
					case 'json':
					case 'application/json':
						if (isOptional(validator.body))
							fnLiteral += `try { c.body = await c.request.json() } catch {}`
						else fnLiteral += `c.body = await c.request.json()`
						break

					case 'text':
					case 'text/plain':
						fnLiteral += `c.body = await c.request.text()\n`
						break

					case 'urlencoded':
					case 'application/x-www-form-urlencoded':
						fnLiteral += `c.body = parseQuery(await c.request.text())\n`
						break

					case 'arrayBuffer':
					case 'application/octet-stream':
						fnLiteral += `c.body = await c.request.arrayBuffer()\n`
						break

					case 'formdata':
					case 'multipart/form-data':
						fnLiteral += `c.body = {}

							const form = await c.request.formData()
							for (const key of form.keys()) {
								if (c.body[key])
									continue

								const value = form.getAll(key)
								if (value.length === 1)
									c.body[key] = value[0]
								else c.body[key] = value
							}\n`
						break
				}
			} else {
				fnLiteral += `
					switch (contentType) {
						case 'application/json':
							${isOptional(validator.body) ? 'try { c.body = await c.request.json() } catch {}' : 'c.body = await c.request.json()'}
							break

						case 'text/plain':
							c.body = await c.request.text()
							break

						case 'application/x-www-form-urlencoded':
							c.body = parseQuery(await c.request.text())
							break

						case 'application/octet-stream':
							c.body = await c.request.arrayBuffer();
							break

						case 'multipart/form-data':
							c.body = {}

							const form = await c.request.formData()
							for (const key of form.keys()) {
								if (c.body[key])
									continue

								const value = form.getAll(key)
								if (value.length === 1)
									c.body[key] = value[0]
								else c.body[key] = value
							}

							break
					}`
			}

			if (hooks.parse.length) fnLiteral += `}`

			fnLiteral += '}\n'
		}

		fnLiteral += '\nisParsing = false\n'
	}

	parseReporter.resolve()

	if (hooks?.transform) {
		const reporter = report('transform', {
			total: hooks.transform.length
		})

		if (hooks.transform.length) fnLiteral += '\nlet transformed\n'

		for (let i = 0; i < hooks.transform.length; i++) {
			const transform = hooks.transform[i]

			const endUnit = reporter.resolveChild(transform.fn.name)

			fnLiteral += isAsync(transform)
				? `transformed = await transform[${i}](c)\n`
				: `transformed = transform[${i}](c)\n`

			if (transform.subType === 'mapDerive')
				fnLiteral += `if(transformed instanceof ElysiaCustomStatusResponse)
					throw transformed
				else {
					transformed.request = c.request
					transformed.store = c.store
					transformed.qi = c.qi
					transformed.path = c.path
					transformed.url = c.url
					transformed.redirect = c.redirect
					transformed.set = c.set
					transformed.error = c.error

					c = transformed
			}`
			else
				fnLiteral += `if(transformed instanceof ElysiaCustomStatusResponse)
					throw transformed
				else
					Object.assign(c, transformed)\n`

			endUnit()
		}

		reporter.resolve()
	}

	if (validator) {
		fnLiteral += '\n'

		if (validator.headers) {
			if (
				normalize &&
				'Clean' in validator.headers &&
				!hasAdditionalProperties(validator.headers as any)
			)
				fnLiteral += 'c.headers = validator.headers.Clean(c.headers);\n'

			// @ts-ignore
			if (hasProperty('default', validator.headers.schema))
				for (const [key, value] of Object.entries(
					Value.Default(
						// @ts-ignore
						validator.headers.schema,
						{}
					) as Object
				)) {
					const parsed =
						typeof value === 'object'
							? JSON.stringify(value)
							: typeof value === 'string'
								? `'${value}'`
								: value

					if (parsed !== undefined)
						fnLiteral += `c.headers['${key}'] ??= ${parsed}\n`
				}

			if (isOptional(validator.headers))
				fnLiteral += `if(isNotEmpty(c.headers)) {`

			fnLiteral += `if(validator.headers.Check(c.headers) === false) {
				${composeValidation('headers')}
			}`

			// @ts-expect-error private property
			if (hasTransform(validator.headers.schema))
				fnLiteral += `c.headers = validator.headers.Decode(c.headers)\n`

			if (isOptional(validator.headers)) fnLiteral += '}'
		}

		if (validator.params) {
			// @ts-ignore
			if (hasProperty('default', validator.params.schema))
				for (const [key, value] of Object.entries(
					Value.Default(
						// @ts-ignore
						validator.params.schema,
						{}
					) as Object
				)) {
					const parsed =
						typeof value === 'object'
							? JSON.stringify(value)
							: typeof value === 'string'
								? `'${value}'`
								: value

					if (parsed !== undefined)
						fnLiteral += `c.params['${key}'] ??= ${parsed}\n`
				}

			fnLiteral += `if(validator.params.Check(c.params) === false) {
				${composeValidation('params')}
			}`

			// @ts-expect-error private property
			if (hasTransform(validator.params.schema))
				fnLiteral += `\nc.params = validator.params.Decode(c.params)\n`
		}

		if (validator.query) {
			if (
				normalize &&
				'Clean' in validator.query &&
				!hasAdditionalProperties(validator.query as any)
			)
				fnLiteral += 'c.query = validator.query.Clean(c.query);\n'

			// @ts-ignore
			if (hasProperty('default', validator.query.schema))
				for (const [key, value] of Object.entries(
					Value.Default(
						// @ts-ignore
						validator.query.schema,
						{}
					) as Object
				)) {
					const parsed =
						typeof value === 'object'
							? JSON.stringify(value)
							: typeof value === 'string'
								? `'${value}'`
								: value

					if (parsed !== undefined)
						fnLiteral += `if(c.query['${key}'] === undefined) c.query['${key}'] = ${parsed}\n`
				}

			if (isOptional(validator.query))
				fnLiteral += `if(isNotEmpty(c.query)) {`

			fnLiteral += `if(validator.query.Check(c.query) === false) {
          		${composeValidation('query')}
			}`

			// @ts-expect-error private property
			if (hasTransform(validator.query.schema))
				fnLiteral += `\nc.query = validator.query.Decode(Object.assign({}, c.query))\n`

			if (isOptional(validator.query)) fnLiteral += `}`
		}

		if (validator.body) {
			if (
				normalize &&
				'Clean' in validator.body &&
				!hasAdditionalProperties(validator.body as any)
			)
				fnLiteral += 'c.body = validator.body.Clean(c.body);\n'

			// @ts-expect-error private property
			const doesHaveTransform = hasTransform(validator.body.schema)

			if (doesHaveTransform || isOptional(validator.body))
				fnLiteral += `\nconst isNotEmptyObject = c.body && (typeof c.body === "object" && isNotEmpty(c.body))\n`

			// @ts-ignore
			if (hasProperty('default', validator.body.schema)) {
				const value = Value.Default(
					// @ts-expect-error private property
					validator.body.schema,
					// @ts-expect-error private property
					validator.body.schema.type === 'object' ? {} : undefined
				)

				const parsed =
					typeof value === 'object'
						? JSON.stringify(value)
						: typeof value === 'string'
							? `'${value}'`
							: value

				fnLiteral += `if(validator.body.Check(c.body) === false) {
					if (typeof c.body === 'object') {
						c.body = Object.assign(${parsed}, c.body)
					} else { c.body = ${parsed} }`

				if (isOptional(validator.body))
					fnLiteral += `
					    if(isNotEmptyObject && validator.body.Check(c.body) === false) {
            				${composeValidation('body')}
             			}
                    }`
				else
					fnLiteral += `
    				if(validator.body.Check(c.body) === false) {
        				${composeValidation('body')}
         			}
                }`
			} else {
				if (isOptional(validator.body))
					fnLiteral += `if(isNotEmptyObject && validator.body.Check(c.body) === false) {
         			${composeValidation('body')}
          		}`
				else
					fnLiteral += `if(validator.body.Check(c.body) === false) {
         			${composeValidation('body')}
          		}`
			}

			if (doesHaveTransform)
				fnLiteral += `\nif(isNotEmptyObject) c.body = validator.body.Decode(c.body)\n`
		}

		if (
			isNotEmpty(
				// @ts-ignore
				cookieValidator?.schema?.properties ??
					// @ts-ignore
					cookieValidator?.schema?.schema ??
					{}
			)
		) {
			fnLiteral += `const cookieValue = {}
    			for(const [key, value] of Object.entries(c.cookie))
    				cookieValue[key] = value.value\n`

			// @ts-ignore
			if (hasProperty('default', cookieValidator.schema))
				for (const [key, value] of Object.entries(
					Value.Default(
						// @ts-ignore
						cookieValidator.schema,
						{}
					) as Object
				)) {
					fnLiteral += `cookieValue['${key}'] = ${
						typeof value === 'object'
							? JSON.stringify(value)
							: value
					}\n`
				}

			if (isOptional(validator.cookie))
				fnLiteral += `if(isNotEmpty(c.cookie)) {`

			fnLiteral += `if(validator.cookie.Check(cookieValue) === false) {
				${composeValidation('cookie', 'cookieValue')}
			}`

			// @ts-expect-error private property
			if (hasTransform(validator.cookie.schema))
				fnLiteral += `\nfor(const [key, value] of Object.entries(validator.cookie.Decode(cookieValue)))
					c.cookie[key].value = value\n`

			if (isOptional(validator.cookie)) fnLiteral += `}`
		}
	}

	if (hooks?.beforeHandle) {
		const reporter = report('beforeHandle', {
			total: hooks.beforeHandle.length
		})

		let hasResolve = false

		for (let i = 0; i < hooks.beforeHandle.length; i++) {
			const beforeHandle = hooks.beforeHandle[i]

			const endUnit = reporter.resolveChild(beforeHandle.fn.name)

			const returning = hasReturn(beforeHandle)
			const isResolver =
				beforeHandle.subType === 'resolve' ||
				beforeHandle.subType === 'mapResolve'

			if (isResolver) {
				if (!hasResolve) {
					hasResolve = true
					fnLiteral += '\nlet resolved\n'
				}

				fnLiteral += isAsync(beforeHandle)
					? `resolved = await beforeHandle[${i}](c);\n`
					: `resolved = beforeHandle[${i}](c);\n`

				if (beforeHandle.subType === 'mapResolve')
					fnLiteral += `if(resolved instanceof ElysiaCustomStatusResponse)
						throw resolved
					else {
						resolved.request = c.request
						resolved.store = c.store
						resolved.qi = c.qi
						resolved.path = c.path
						resolved.url = c.url
						resolved.redirect = c.redirect
						resolved.set = c.set
						resolved.error = c.error

						c = resolved
					}`
				else
					fnLiteral += `if(resolved instanceof ElysiaCustomStatusResponse)
						throw resolved
					else
						Object.assign(c, resolved)\n`
			} else if (!returning) {
				fnLiteral += isAsync(beforeHandle)
					? `await beforeHandle[${i}](c);\n`
					: `beforeHandle[${i}](c);\n`

				endUnit()
			} else {
				fnLiteral += isAsync(beforeHandle)
					? `be = await beforeHandle[${i}](c);\n`
					: `be = beforeHandle[${i}](c);\n`

				endUnit('be')

				fnLiteral += `if(be !== undefined) {\n`
				reporter.resolve()

				if (hooks.afterHandle?.length) {
					report('handle', {
						name: isHandleFn
							? (handler as Function).name
							: undefined
					}).resolve()

					const reporter = report('afterHandle', {
						total: hooks.afterHandle.length
					})

					for (let i = 0; i < hooks.afterHandle.length; i++) {
						const hook = hooks.afterHandle[i]
						const returning = hasReturn(hook)
						const endUnit = reporter.resolveChild(hook.fn.name)

						fnLiteral += `c.response = be\n`

						if (!returning) {
							fnLiteral += isAsync(hook.fn)
								? `await afterHandle[${i}](c, be)\n`
								: `afterHandle[${i}](c, be)\n`
						} else {
							fnLiteral += isAsync(hook.fn)
								? `af = await afterHandle[${i}](c)\n`
								: `af = afterHandle[${i}](c)\n`

							fnLiteral += `if(af !== undefined) { c.response = be = af }\n`
						}

						endUnit('af')
					}
					reporter.resolve()
				}

				if (validator.response)
					fnLiteral += composeResponseValidation('be')

				const mapResponseReporter = report('mapResponse', {
					total: hooks.mapResponse.length
				})

				if (hooks.mapResponse.length) {
					fnLiteral += `\nc.response = be\n`

					for (let i = 0; i < hooks.mapResponse.length; i++) {
						const mapResponse = hooks.mapResponse[i]

						const endUnit = mapResponseReporter.resolveChild(
							mapResponse.fn.name
						)

						fnLiteral += `\nif(mr === undefined) {
							mr = ${isAsyncName(mapResponse) ? 'await' : ''} onMapResponse[${i}](c)
							if(mr !== undefined) be = c.response = mr
						}\n`

						endUnit()
					}
				}

				mapResponseReporter.resolve()

				fnLiteral += encodeCookie
				fnLiteral += `return mapEarlyResponse(${saveResponse} be, c.set ${requestMapper})}\n`
			}
		}

		reporter.resolve()
	}

	if (hooks?.afterHandle.length) {
		const handleReporter = report('handle', {
			name: isHandleFn ? (handler as Function).name : undefined
		})

		if (hooks.afterHandle.length)
			fnLiteral += isAsyncHandler
				? `let r = c.response = await ${handle};\n`
				: `let r = c.response = ${handle};\n`
		else
			fnLiteral += isAsyncHandler
				? `let r = await ${handle};\n`
				: `let r = ${handle};\n`

		handleReporter.resolve()

		const reporter = report('afterHandle', {
			total: hooks.afterHandle.length
		})

		for (let i = 0; i < hooks.afterHandle.length; i++) {
			const hook = hooks.afterHandle[i]
			const returning = hasReturn(hook)
			const endUnit = reporter.resolveChild(hook.fn.name)

			if (!returning) {
				fnLiteral += isAsync(hook.fn)
					? `await afterHandle[${i}](c)\n`
					: `afterHandle[${i}](c)\n`

				endUnit()
			} else {
				fnLiteral += isAsync(hook.fn)
					? `af = await afterHandle[${i}](c)\n`
					: `af = afterHandle[${i}](c)\n`

				endUnit('af')

				if (validator.response) {
					fnLiteral += `if(af !== undefined) {`
					reporter.resolve()

					fnLiteral += composeResponseValidation('af')

					fnLiteral += `c.response = af }`
				} else {
					fnLiteral += `if(af !== undefined) {`
					reporter.resolve()

					fnLiteral += `c.response = af}\n`
				}
			}
		}

		reporter.resolve()

		fnLiteral += `r = c.response\n`

		if (validator.response) fnLiteral += composeResponseValidation()

		fnLiteral += encodeCookie

		const mapResponseReporter = report('mapResponse', {
			total: hooks.mapResponse.length
		})
		if (hooks.mapResponse.length) {
			for (let i = 0; i < hooks.mapResponse.length; i++) {
				const mapResponse = hooks.mapResponse[i]

				const endUnit = mapResponseReporter.resolveChild(
					mapResponse.fn.name
				)

				fnLiteral += `\nmr = ${
					isAsyncName(mapResponse) ? 'await' : ''
				} onMapResponse[${i}](c)
				if(mr !== undefined) r = c.response = mr\n`

				endUnit()
			}
		}
		mapResponseReporter.resolve()

		if (hasSet)
			fnLiteral += `return mapResponse(${saveResponse} r, c.set ${requestMapper})\n`
		else
			fnLiteral += `return mapCompactResponse(${saveResponse} r ${requestMapper})\n`
	} else {
		const handleReporter = report('handle', {
			name: isHandleFn ? (handler as Function).name : undefined
		})

		if (validator.response || hooks.mapResponse.length) {
			fnLiteral += isAsyncHandler
				? `let r = await ${handle};\n`
				: `let r = ${handle};\n`

			handleReporter.resolve()

			if (validator.response) fnLiteral += composeResponseValidation()

			report('afterHandle').resolve()

			const mapResponseReporter = report('mapResponse', {
				total: hooks.mapResponse.length
			})

			if (hooks.mapResponse.length) {
				fnLiteral += '\nc.response = r\n'

				for (let i = 0; i < hooks.mapResponse.length; i++) {
					const mapResponse = hooks.mapResponse[i]

					const endUnit = mapResponseReporter.resolveChild(
						mapResponse.fn.name
					)

					fnLiteral += `\nif(mr === undefined) {
						mr = ${isAsyncName(mapResponse) ? 'await' : ''} onMapResponse[${i}](c)
    					if(mr !== undefined) r = c.response = mr
					}\n`

					endUnit()
				}
			}
			mapResponseReporter.resolve()

			fnLiteral += encodeCookie

			if (handler instanceof Response) {
				fnLiteral += inference.set
					? `if(
					isNotEmpty(c.set.headers) ||
					c.set.status !== 200 ||
					c.set.redirect ||
					c.set.cookie
				)
					return mapResponse(${saveResponse} ${handle}.clone(), c.set ${requestMapper})
				else
					return ${handle}.clone()`
					: `return ${handle}.clone()`

				fnLiteral += '\n'
			} else if (hasSet)
				fnLiteral += `return mapResponse(${saveResponse} r, c.set ${requestMapper})\n`
			else
				fnLiteral += `return mapCompactResponse(${saveResponse} r ${requestMapper})\n`
		} else if (hasCookie || hasTrace) {
			fnLiteral += isAsyncHandler
				? `let r = await ${handle};\n`
				: `let r = ${handle};\n`

			handleReporter.resolve()

			report('afterHandle').resolve()

			const mapResponseReporter = report('mapResponse', {
				total: hooks.mapResponse.length
			})
			if (hooks.mapResponse.length) {
				fnLiteral += '\nc.response = r\n'

				for (let i = 0; i < hooks.mapResponse.length; i++) {
					const mapResponse = hooks.mapResponse[i]

					const endUnit = mapResponseReporter.resolveChild(
						mapResponse.fn.name
					)

					fnLiteral += `\nif(mr === undefined) {
							mr = ${isAsyncName(mapResponse) ? 'await' : ''} onMapResponse[${i}](c)
    						if(mr !== undefined) r = c.response = mr
						}\n`

					endUnit()
				}
			}
			mapResponseReporter.resolve()

			fnLiteral += encodeCookie

			if (hasSet)
				fnLiteral += `return mapResponse(${saveResponse} r, c.set ${requestMapper})\n`
			else
				fnLiteral += `return mapCompactResponse(${saveResponse} r ${requestMapper})\n`
		} else {
			handleReporter.resolve()

			const handled = isAsyncHandler ? `await ${handle}` : handle

			report('afterHandle').resolve()

			if (handler instanceof Response) {
				fnLiteral += inference.set
					? `if(
					isNotEmpty(c.set.headers) ||
					c.set.status !== 200 ||
					c.set.redirect ||
					c.set.cookie
				)
					return mapResponse(${saveResponse} ${handle}.clone(), c.set ${requestMapper})
				else
					return ${handle}.clone()`
					: `return ${handle}.clone()`

				fnLiteral += '\n'
			} else if (hasSet)
				fnLiteral += `return mapResponse(${saveResponse} ${handled}, c.set ${requestMapper})\n`
			else
				fnLiteral += `return mapCompactResponse(${saveResponse} ${handled} ${requestMapper})\n`
		}
	}

	fnLiteral += `\n} catch(error) {`

	if (hasBody) fnLiteral += `\nif(isParsing) error = new ParseError()\n`

	if (!maybeAsync) fnLiteral += `\nreturn (async () => {\n`
	fnLiteral += `\nconst set = c.set\nif (!set.status || set.status < 300) set.status = error?.status || 500\n`

	if (hasTrace)
		for (let i = 0; i < hooks.trace.length; i++)
			// There's a case where the error is thrown before any trace is called
			fnLiteral += `report${i}?.resolve(error);reportChild${i}?.(error);\n`

	const errorReporter = report('error', {
		total: hooks.error.length
	})

	if (hooks.error.length) {
		fnLiteral += `
				c.error = error
				if(error instanceof TypeBoxError) {
					c.code = "VALIDATION"
					c.set.status = 422
				} else
					c.code = error.code ?? error[ERROR_CODE] ?? "UNKNOWN"
				let er
			`

		for (let i = 0; i < hooks.error.length; i++) {
			const endUnit = errorReporter.resolveChild(hooks.error[i].fn.name)

			if (isAsync(hooks.error[i]))
				fnLiteral += `\ner = await handleErrors[${i}](c)\n`
			else
				fnLiteral +=
					`\ner = handleErrors[${i}](c)\n` +
					`if (er instanceof Promise) er = await er\n`

			endUnit()

			const mapResponseReporter = report('mapResponse', {
				total: hooks.mapResponse.length
			})

			if (hooks.mapResponse.length) {
				for (let i = 0; i < hooks.mapResponse.length; i++) {
					const mapResponse = hooks.mapResponse[i]

					const endUnit = mapResponseReporter.resolveChild(
						mapResponse.fn.name
					)

					fnLiteral += `\nc.response = er\n
							er = ${isAsyncName(mapResponse) ? 'await' : ''} onMapResponse[${i}](c)
							if(er instanceof Promise) er = await er\n`

					endUnit()
				}
			}

			mapResponseReporter.resolve()

			fnLiteral += `er = mapEarlyResponse(er, set ${requestMapper})\n`
			fnLiteral += `if (er) {`

			if (hasTrace) {
				for (let i = 0; i < hooks.trace.length; i++)
					fnLiteral += `\nreport${i}.resolve()\n`

				errorReporter.resolve()
			}

			fnLiteral += `return er\n}\n`
		}
	}

	errorReporter.resolve()

	fnLiteral += `return handleError(c, error, true)\n`
	if (!maybeAsync) fnLiteral += '})()'
	fnLiteral += '}'

	if (hasAfterResponse || hasTrace) {
		fnLiteral += ` finally { `

		if (!maybeAsync) fnLiteral += ';(async () => {'

		const reporter = report('afterResponse', {
			total: hooks.afterResponse.length
		})

		if (hasAfterResponse) {
			for (let i = 0; i < hooks.afterResponse.length; i++) {
				const endUnit = reporter.resolveChild(
					hooks.afterResponse[i].fn.name
				)
				fnLiteral += `\nawait afterResponse[${i}](c);\n`
				endUnit()
			}
		}

		reporter.resolve()

		if (!maybeAsync) fnLiteral += '})();'

		fnLiteral += `}`
	}

	fnLiteral = `const {
		handler,
		handleError,
		hooks: {
			transform,
			resolve,
			beforeHandle,
			afterHandle,
			mapResponse: onMapResponse,
			parse,
			error: handleErrors,
			afterResponse,
			trace: _trace
		},
		validator,
		utils: {
			mapResponse,
			mapCompactResponse,
			mapEarlyResponse,
			parseQuery,
			parseQueryFromURL,
			isNotEmpty
		},
		error: {
			NotFoundError,
			ValidationError,
			InternalServerError,
			ParseError
		},
		schema,
		definitions,
		ERROR_CODE,
		parseCookie,
		signCookie,
		decodeURIComponent,
		ElysiaCustomStatusResponse,
		ELYSIA_TRACE,
		ELYSIA_REQUEST_ID,
		getServer,
		TypeBoxError
	} = hooks

	const trace = _trace.map(x => typeof x === 'function' ? x : x.fn)

	return ${maybeAsync ? 'async' : ''} function handle(c) {
		${hooks.beforeHandle.length ? 'let be' : ''}
		${hooks.afterHandle.length ? 'let af' : ''}
		${hooks.mapResponse.length ? 'let mr' : ''}

		${allowMeta ? 'c.schema = schema; c.defs = definitions' : ''}
		${fnLiteral}
	}`

	try {
		return Function(
			'hooks',
			fnLiteral
		)({
			handler,
			hooks: lifeCycleToFn(hooks),
			validator,
			// @ts-expect-error
			handleError: app.handleError,
			utils: {
				mapResponse,
				mapCompactResponse,
				mapEarlyResponse,
				parseQuery,
				parseQueryFromURL,
				isNotEmpty
			},
			error: {
				NotFoundError,
				ValidationError,
				InternalServerError,
				ParseError
			},
			schema: app.router.history,
			// @ts-expect-error
			definitions: app.definitions.type,
			ERROR_CODE,
			parseCookie,
			signCookie,
			decodeURIComponent,
			ElysiaCustomStatusResponse,
			ELYSIA_TRACE,
			ELYSIA_REQUEST_ID,
			// @ts-expect-error private property
			getServer: () => app.getServer(),
			TypeBoxError
		})
	} catch {
		const debugHooks = lifeCycleToFn(hooks)

		console.log('[Composer] failed to generate optimized handler')
		console.log(
			'Please report the following to SaltyAom privately as it may include sensitive information about your codebase:'
		)
		console.log('---')
		console.log({
			handler:
				typeof handler === 'function' ? handler.toString() : handler,
			hooks: {
				...debugHooks,
				// @ts-expect-error
				transform: debugHooks?.transform?.map?.((x) => x.toString()),
				// @ts-expect-error
				resolve: debugHooks?.resolve?.map?.((x) => x.toString()),
				// @ts-expect-error
				beforeHandle: debugHooks?.beforeHandle?.map?.((x) =>
					x.toString()
				),
				// @ts-expect-error
				afterHandle: debugHooks?.afterHandle?.map?.((x) =>
					x.toString()
				),
				// @ts-expect-error
				mapResponse: debugHooks?.mapResponse?.map?.((x) =>
					x.toString()
				),
				// @ts-expect-error
				parse: debugHooks?.parse?.map?.((x) => x.toString()),
				// @ts-expect-error
				error: debugHooks?.error?.map?.((x) => x.toString()),
				// @ts-expect-error
				afterResponse: debugHooks?.afterResponse?.map?.((x) =>
					x.toString()
				),
				// @ts-expect-error
				stop: debugHooks?.stop?.map?.((x) => x.toString())
			},
			validator,
			// @ts-expect-error
			definitions: app.definitions.type
		})
		console.log('---')

		process.exit(1)
	}
}

export interface ComposerGeneralHandlerOptions {
	/**
	 * optimization for standard internet hostname
	 * this will assume hostname is always use a standard internet hostname
	 * assuming hostname is at minimum of 11 length of string (http://a.bc)
	 *
	 * setting this to true will skip the first 11 character of the hostname
	 *
	 * @default true
	 */
	standardHostname?: boolean
}

export const composeGeneralHandler = (
	app: Elysia<any, any, any, any, any, any, any, any>
) => {
	const standardHostname = app.config.handler?.standardHostname ?? true

	let decoratorsLiteral = ''
	let fnLiteral = ''

	// @ts-expect-error private
	const defaultHeaders = app.setHeaders

	// @ts-ignore
	for (const key of Object.keys(app.singleton.decorator))
		decoratorsLiteral += `,${key}: app.singleton.decorator.${key}`

	const router = app.router
	const hasTrace = app.event.trace.length > 0

	let findDynamicRoute = `
	const route = router.find(request.method, path) ${
		router.http.root.ALL ? '?? router.find("ALL", path)' : ''
	}

	if (route === null)
		return ${
			app.event.error.length
				? `app.handleError(ctx, notFound)`
				: app.event.request.length
					? `new Response(error404Message, {
					status: ctx.set.status === 200 ? 404 : ctx.set.status,
					headers: ctx.set.headers
				})`
					: `error404.clone()`
		}

	ctx.params = route.params\n`

	findDynamicRoute += `if(route.store.handler) return route.store.handler(ctx)
	return (route.store.handler = route.store.compile())(ctx)\n`

	let switchMap = ``
	for (const [path, { code, all, static: staticFn }] of Object.entries(
		router.static.http.map
	)) {
		if (staticFn)
			switchMap += `case '${path}':\nswitch(request.method) {\n${code}\n${
				all ?? `default: break map`
			}}\n\n`

		switchMap += `case '${path}':\nswitch(request.method) {\n${code}\n${
			all ?? `default: break map`
		}}\n\n`
	}

	const maybeAsync = app.event.request.some(isAsync)

	fnLiteral += `const {
		app,
		mapEarlyResponse,
		NotFoundError,
		randomId,
		handleError,
		error,
		redirect,
		ELYSIA_TRACE,
		ELYSIA_REQUEST_ID,
		getServer
	} = data

	const store = app.singleton.store
	const staticRouter = app.router.static.http
	const st = staticRouter.handlers
	const wsRouter = app.router.ws
	const router = app.router.http
	const trace = app.event.trace.map(x => typeof x === 'function' ? x : x.fn)

	const notFound = new NotFoundError()
	const hoc = app.extender.higherOrderFunctions.map(x => x.fn)

	${
		app.event.request.length
			? `const onRequest = app.event.request.map(x => x.fn)`
			: ''
	}
	${
		app.event.error.length
			? ''
			: `\nconst error404Message = notFound.message.toString()
	const error404 = new Response(error404Message, { status: 404 });\n`
	}

	${
		app.event.trace.length
			? `const ${app.event.trace
					.map((_, i) => `tr${i} = app.event.trace[${i}].fn`)
					.join(',')}`
			: ''
	}

	${maybeAsync ? 'async' : ''} function map(request) {\n`

	if (app.event.request.length) fnLiteral += `let re`

	fnLiteral += `\nconst url = request.url
		const s = url.indexOf('/', ${standardHostname ? 11 : 7})
		const qi = url.indexOf('?', s + 1)
		let path
		if(qi === -1)
			path = url.substring(s)
		else
			path = url.substring(s, qi)\n`

	fnLiteral += `${hasTrace ? 'const id = randomId()' : ''}
		const ctx = {
			request,
			store,
			qi,
			path,
			url,
			redirect,
			set: {
				headers: ${
					Object.keys(defaultHeaders ?? {}).length
						? 'Object.assign({}, app.setHeaders)'
						: '{}'
				},
				status: 200
			},
			error
			${
				// @ts-expect-error private property
				app.inference.server
					? `, get server() {
							return getServer()
						}`
					: ''
			}
			${hasTrace ? ',[ELYSIA_REQUEST_ID]: id' : ''}
			${decoratorsLiteral}
		}\n`

	if (app.event.trace.length)
		fnLiteral += `\nctx[ELYSIA_TRACE] = [${app.event.trace
			.map((_, i) => `tr${i}(ctx)`)
			.join(',')}]\n`

	const report = createReport({
		context: 'ctx',
		trace: app.event.trace,
		addFn(word) {
			fnLiteral += word
		}
	})

	const reporter = report('request', {
		attribute: 'ctx',
		total: app.event.request.length
	})

	if (app.event.request.length) {
		fnLiteral += `\n try {\n`

		for (let i = 0; i < app.event.request.length; i++) {
			const hook = app.event.request[i]
			const withReturn = hasReturn(hook)
			const maybeAsync = isAsync(hook)

			const endUnit = reporter.resolveChild(app.event.request[i].fn.name)

			if (withReturn) {
				fnLiteral += `re = mapEarlyResponse(
					${maybeAsync ? 'await' : ''} onRequest[${i}](ctx),
					ctx.set,
					request
				)\n`

				endUnit('re')
				fnLiteral += `if(re !== undefined) return re\n`
			} else {
				fnLiteral += `${
					maybeAsync ? 'await' : ''
				} onRequest[${i}](ctx)\n`
				endUnit()
			}
		}

		fnLiteral += `} catch (error) {
			return app.handleError(ctx, error)
		}`
	}

	reporter.resolve()

	const wsPaths = app.router.static.ws
	const wsRouter = app.router.ws

	if (Object.keys(wsPaths).length || wsRouter.history.length) {
		fnLiteral += `
			if(request.method === 'GET') {
				switch(path) {`

		for (const [path, index] of Object.entries(wsPaths)) {
			fnLiteral += `
					case '${path}':
						if(request.headers.get('upgrade') === 'websocket')
							return st[${index}](ctx)

						break`
		}

		fnLiteral += `
				default:
					if(request.headers.get('upgrade') === 'websocket') {
						const route = wsRouter.find('ws', path)

						if(route) {
							ctx.params = route.params

							if(route.store.handler)
							    return route.store.handler(ctx)

							return (route.store.handler = route.store.compile())(ctx)
						}
					}

					break
			}
		}\n`
	}

	fnLiteral += `
		map: switch(path) {
			${switchMap}

			default:
				break
		}

		${findDynamicRoute}
	}\n`

	// @ts-expect-error private property
	if (app.extender.higherOrderFunctions.length) {
		let handler = 'map'
		// @ts-expect-error private property
		for (let i = 0; i < app.extender.higherOrderFunctions.length; i++)
			handler = `hoc[${i}](${handler}, request)`

		fnLiteral += `return function hocMap(request) { return ${handler}(request) }`
	} else fnLiteral += `return map`

	// console.log(fnLiteral)

	const handleError = composeErrorHandler(app) as any

	// @ts-expect-error
	app.handleError = handleError

	return Function(
		'data',
		fnLiteral
	)({
		app,
		mapEarlyResponse,
		NotFoundError,
		randomId,
		handleError,
		error,
		redirect,
		ELYSIA_TRACE,
		ELYSIA_REQUEST_ID,
		// @ts-expect-error private property
		getServer: () => app.getServer()
	})
}

export const composeErrorHandler = (
	app: Elysia<any, any, any, any, any, any, any, any>
) => {
	const hooks = app.event
	let fnLiteral = ''

	fnLiteral += `const {
		app: { event: { error: onErrorContainer, afterResponse: resContainer, mapResponse: _onMapResponse, trace: _trace } },
		mapResponse,
		ERROR_CODE,
		ElysiaCustomStatusResponse,
		ELYSIA_TRACE,
		ELYSIA_REQUEST_ID
	} = inject

	const trace = _trace.map(x => typeof x === 'function' ? x : x.fn)
	const onMapResponse = []

	for(let i = 0; i < _onMapResponse.length; i++)
		onMapResponse.push(_onMapResponse[i].fn ?? _onMapResponse[i])

	delete _onMapResponse

	const onError = onErrorContainer.map(x => x.fn)
	const res = resContainer.map(x => x.fn)

	return ${
		app.event.error.find(isAsync) || app.event.mapResponse.find(isAsync)
			? 'async'
			: ''
	} function(context, error, skipGlobal) {`

	const hasTrace = app.event.trace.length > 0

	if (hasTrace) fnLiteral += '\nconst id = context[ELYSIA_REQUEST_ID]\n'

	const report = createReport({
		context: 'context',
		trace: hooks.trace,
		addFn: (word) => {
			fnLiteral += word
		}
	})

	fnLiteral += `
		const set = context.set
		let r

		if(!context.code)
			context.code = error.code ?? error[ERROR_CODE]

		if(!(context.error instanceof Error))
			context.error = error

		if(error instanceof ElysiaCustomStatusResponse) {
			error.status = error.code
			error.message = error.response
		}\n`

	const saveResponse =
		hasTrace ||
		hooks.afterResponse.length > 0 ||
		hooks.afterResponse.length > 0
			? 'context.response = '
			: ''

	for (let i = 0; i < app.event.error.length; i++) {
		const handler = app.event.error[i]

		const response = `${
			isAsync(handler) ? 'await ' : ''
		}onError[${i}](context)`

		fnLiteral += '\nif(skipGlobal !== true) {\n'

		if (hasReturn(handler)) {
			fnLiteral += `r = ${response}; if(r !== undefined) {
				if(r instanceof Response) return r

				if(r instanceof ElysiaCustomStatusResponse) {
					error.status = error.code
					error.message = error.response
				}

				if(set.status === 200) set.status = error.status\n`

			const mapResponseReporter = report('mapResponse', {
				total: hooks.mapResponse.length,
				name: 'context'
			})

			if (hooks.mapResponse.length) {
				for (let i = 0; i < hooks.mapResponse.length; i++) {
					const mapResponse = hooks.mapResponse[i]

					const endUnit = mapResponseReporter.resolveChild(
						mapResponse.fn.name
					)

					fnLiteral += `\ncontext.response = r
						r = ${isAsyncName(mapResponse) ? 'await' : ''} onMapResponse[${i}](context)\n`

					endUnit()
				}
			}

			mapResponseReporter.resolve()

			fnLiteral += `return mapResponse(${saveResponse} r, set, context.request)}\n`
		} else fnLiteral += response + '\n'

		fnLiteral += '\n}\n'
	}

	fnLiteral += `if(error.constructor.name === "ValidationError" || error.constructor.name === "TransformDecodeError") {
	    const reportedError = error.error ?? error
		set.status = reportedError.status ?? 422
		return new Response(
			reportedError.message,
			{
				headers: Object.assign(
					{ 'content-type': 'application/json'},
					set.headers
				),
				status: set.status
			}
		)
	} else {
		if(error.code && typeof error.status === "number")
			return new Response(
				error.message,
				{ headers: set.headers, status: error.status }
			)\n`

	const mapResponseReporter = report('mapResponse', {
		total: hooks.mapResponse.length,
		name: 'context'
	})

	if (hooks.mapResponse.length) {
		for (let i = 0; i < hooks.mapResponse.length; i++) {
			const mapResponse = hooks.mapResponse[i]

			const endUnit = mapResponseReporter.resolveChild(
				mapResponse.fn.name
			)

			fnLiteral += `\ncontext.response = error
			error = ${
				isAsyncName(mapResponse) ? 'await' : ''
			} onMapResponse[${i}](context)\n`

			endUnit()
		}
	}

	mapResponseReporter.resolve()

	fnLiteral += `\nreturn mapResponse(${saveResponse} error, set, context.request)\n}\n}`

	return Function(
		'inject',
		fnLiteral
	)({
		app,
		mapResponse,
		ERROR_CODE,
		ElysiaCustomStatusResponse,
		ELYSIA_TRACE,
		ELYSIA_REQUEST_ID
	})
}
