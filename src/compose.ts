import { type Elysia } from '.'

import { Value } from '@sinclair/typebox/value'
import { TypeCheck } from '@sinclair/typebox/compiler'
import type { TAnySchema } from '@sinclair/typebox'

import { parse as parseQuery } from 'fast-querystring'

// @ts-ignore
import decodeURIComponent from 'fast-decode-uri-component'

import { signCookie } from './utils'

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
	ELYSIA_RESPONSE
} from './error'

import { sucrose } from './sucrose'
import { parseCookie, type CookieOptions } from './cookies'

import type {
	ComposedHandler,
	Handler,
	LifeCycleStore,
	SchemaValidator,
	TraceEvent
} from './types'

const headersHasToJSON = (new Headers() as Headers).toJSON
const requestId = { value: 0 }

const createReport = ({
	hasTrace,
	hasTraceSet = false,
	addFn,
	condition = {}
}: {
	hasTrace: boolean | number
	hasTraceSet?: boolean
	addFn(string: string): void
	condition: Partial<Record<TraceEvent, boolean>>
}) => {
	if (hasTrace) {
		addFn(`\nconst reporter = getReporter()\n`)

		return (
			event: TraceEvent,
			{
				name,
				attribute = '',
				unit = 0
			}: {
				name?: string
				attribute?: string
				unit?: number
			} = {}
		) => {
			const dotIndex = event.indexOf('.')
			const isGroup = dotIndex === -1

			if (
				event !== 'request' &&
				event !== 'response' &&
				!condition[
					(isGroup
						? event
						: event.slice(0, dotIndex)) as keyof typeof condition
				]
			)
				return () => {
					if (hasTraceSet && event === 'afterHandle')
						addFn(`\nawait traceDone\n`)
				}

			if (isGroup) name ||= event
			else name ||= 'anonymous'

			addFn(
				'\n' +
					`reporter.emit('event', {
					id,
					event: '${event}',
					type: 'begin',
					name: '${name}',
					time: performance.now(),
					${isGroup ? `unit: ${unit},` : ''}
					${attribute}
				})`.replace(/(\t| |\n)/g, '') +
					'\n'
			)

			let handled = false

			return () => {
				if (handled) return

				handled = true
				addFn(
					'\n' +
						`reporter.emit('event', {
							id,
							event: '${event}',
							type: 'end',
							time: performance.now()
						})`.replace(/(\t| |\n)/g, '') +
						'\n'
				)

				if (hasTraceSet && event === 'afterHandle')
					addFn(`\nawait traceDone\n`)
			}
		}
	} else {
		return () => () => {}
	}
}

export const hasReturn = (fnLiteral: string) => {
	const parenthesisEnd = fnLiteral.indexOf(')')

	// Is direct arrow function return eg. () => 1
	if (
		fnLiteral.charCodeAt(parenthesisEnd + 2) === 61 &&
		fnLiteral.charCodeAt(parenthesisEnd + 5) !== 123
	) {
		return true
	}

	return fnLiteral.includes('return')
}

const composeValidationFactory = (
	hasErrorHandler: boolean,
	{
		injectResponse = ''
	}: {
		injectResponse?: string
	} = {}
) => ({
	composeValidation: (type: string, value = `c.${type}`) =>
		hasErrorHandler
			? `c.set.status = 400; throw new ValidationError('${type}', ${type}, ${value})`
			: `c.set.status = 400; return new ValidationError('${type}', ${type}, ${value}).toResponse(c.set.headers)`,
	composeResponseValidation: (name = 'r') => {
		const returnError = hasErrorHandler
			? `throw new ValidationError('response', response[c.set.status], ${name})`
			: `return new ValidationError('response', response[c.set.status], ${name}).toResponse(c.set.headers)`

		return `\n${injectResponse}

			if(typeof ${name} === "object" && ELYSIA_RESPONSE in ${name}) {
				if(!(${name} instanceof Response) && response[${name}[ELYSIA_RESPONSE]]?.Check(${name}.response) === false) {
					if(!(response instanceof Error)) {
						c.set.status = ${name}[ELYSIA_RESPONSE]

						${returnError}
					}
				}
			} else if(!(${name} instanceof Response) && response[c.set.status]?.Check(${name}) === false) {
				if(!(response instanceof Error))
					${returnError}
			}\n`
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
const getUnionedType = (validator: TypeCheck<any> | undefined) => {
	if (!validator) return

	// @ts-ignore
	const schema = validator?.schema

	if (schema && 'anyOf' in schema) {
		let foundDifference = false
		const type: string = schema.anyOf[0].type

		for (const validator of schema.anyOf as { type: string }[]) {
			if (validator.type !== type) {
				foundDifference = true
				break
			}
		}

		if (!foundDifference) return type
	}

	// @ts-ignore
	return validator.schema?.type
}

const matchFnReturn = /(?:return|=>) \S+\(/g

export const isAsync = (fn: Function) => {
	if (fn.constructor.name === 'AsyncFunction') return true

	const literal = fn.toString()
	if (literal.includes('=> response.clone(')) return false

	return !!literal.match(matchFnReturn)
}

export const composeHandler = ({
	app,
	path,
	method,
	localHook,
	hooks,
	validator,
	handler,
	allowMeta = false
}: {
	app: Elysia<any, any, any, any, any, any, any, any>
	path: string
	method: string
	hooks: LifeCycleStore
	localHook: LifeCycleStore
	validator: SchemaValidator
	handler: unknown | Handler<any, any>
	allowMeta?: boolean
}): ComposedHandler => {
	const hasErrorHandler =
		app.config.forceErrorEncapsulation ||
		hooks.error.length > 0 ||
		app.event.error.length > 0 ||
		typeof Bun === 'undefined' ||
		app.onResponse.length > 0 ||
		hooks.onResponse.length > 0 ||
		!!hooks.trace.length

	const isHandleFn = typeof handler === 'function'
	const handle = isHandleFn ? `handler(c)` : `handler`
	const handleResponse = hooks.onResponse.length
		? `\n;(async () => {${hooks.onResponse
				.map((_, i) => `await res${i}(c)`)
				.join(';')}})();\n`
		: ''

	const traceConditions: Record<
		Exclude<TraceEvent, `${string}.unit` | 'request' | 'response' | 'exit'>,
		boolean
	> = app.inference.trace

	const hasTrace = hooks.trace.length > 0
	let fnLiteral = ''

	const inference = sucrose(
		Object.assign(localHook, {
			handler: handler as any
		}),
		app.inference.event
	)

	const hasQuery = inference.query || !!validator.query

	const hasBody =
		method !== '$INTERNALWS' &&
		method !== 'GET' &&
		method !== 'HEAD' &&
		hooks.type !== 'none' &&
		(inference.body || !!validator.body)

	// @ts-ignore private
	const setHeaders = app.setHeaders

	const hasHeaders = inference.headers || validator.headers

	const hasCookie = inference.cookie || !!validator.cookie

	// @ts-ignore private property
	const cookieMeta = validator?.cookie?.schema as {
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

	const { composeValidation, composeResponseValidation } =
		composeValidationFactory(hasErrorHandler)

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
			secret: ${
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
					  cookieMeta.sign.reduce((a, b) => a + `'${b}',`, '') +
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

		if (hasHeaders || (setHeaders && !!Object.keys(setHeaders).length))
			fnLiteral += `\nc.cookie = await parseCookie(c.set, c.headers.cookie, ${options})\n`
		else
			fnLiteral += `\nc.cookie = await parseCookie(c.set, c.request.headers.get('cookie'), ${options})\n`
	}

	if (hasQuery) {
		let destructured = [] as string[]

		// @ts-ignore
		if (validator.query && validator.query.schema.type === 'object') {
			// @ts-ignore
			destructured = Object.keys(validator.query.schema.properties)
		} else
			for (const query of inference.queries)
				if (destructured.indexOf(query) === -1) destructured.push(query)

		if (destructured.length) {
			fnLiteral += `if(c.qi !== -1) {
				let url = decodeURIComponent(
					c.request.url.slice(c.qi + 1)
						.replace(/\\+/g, ' ')
					)

				let memory = 0

				${destructured
					.map(
						(name, index) => `
						memory = url.indexOf('${name}=')

						const a${index} = memory === -1 ? undefined : url.slice(memory = memory + ${
							name.length + 1
						}, (memory = url.indexOf('&', memory)) === -1 ? undefined : memory)`
					)
					.join('\n')}

				c.query = {
					${destructured.map((name, index) => `'${name}': a${index}`).join(', ')}
				}
			} else {
				c.query = {}
			}`
		} else {
			fnLiteral += `c.query = c.qi !== -1 ? parseQuery(decodeURIComponent(c.request.url.slice(c.qi + 1))) : {}`
		}
	}

	const hasTraceSet = app.inference.trace.set
	const hasSet =
		inference.cookie ||
		inference.set ||
		hasTraceSet ||
		hasHeaders ||
		(setHeaders && !!Object.keys(setHeaders).length)

	if (hasTrace) fnLiteral += '\nconst id = c.$$requestId\n'

	const report = createReport({
		hasTrace,
		hasTraceSet,
		condition: traceConditions,
		addFn: (word) => {
			fnLiteral += word
		}
	})

	fnLiteral += hasErrorHandler ? '\n try {\n' : ''

	if (hasTraceSet) {
		fnLiteral += `\nconst traceDone = Promise.all([`
		for (let i = 0; i < hooks.trace.length; i++) {
			fnLiteral += `new Promise(r => { reporter.once(\`res\${id}.${i}\`, r) }),`
		}
		fnLiteral += `])\n`
	}

	const isAsyncHandler = typeof handler === 'function' && isAsync(handler)

	const maybeAsync =
		hasCookie ||
		hasBody ||
		hasTraceSet ||
		isAsyncHandler ||
		!!hooks.mapResponse.length ||
		hooks.parse.length > 0 ||
		hooks.afterHandle.some(isAsync) ||
		hooks.beforeHandle.some(isAsync) ||
		hooks.transform.some(isAsync)

	const endParse = report('parse', {
		unit: hooks.parse.length
	})

	if (hasBody) {
		const type = getUnionedType(validator?.body)

		if (hooks.type && !Array.isArray(hooks.type)) {
			if (hooks.type) {
				switch (hooks.type) {
					case 'json':
					case 'application/json':
						fnLiteral += `c.body = await c.request.json()\n`
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
			}
			if (hooks.parse.length) fnLiteral += '}}'
		} else {
			const getAotParser = () => {
				if (hooks.parse.length && type && !Array.isArray(hooks.type)) {
					// @ts-ignore
					const schema = validator?.body?.schema

					if (
						typeof schema === 'object' &&
						(hasType('File', schema) || hasType('Files', schema))
					)
						return `c.body = {}

								const form = await c.request.formData()
								for (const key of form.keys()) {
									if (c.body[key])
										continue

									const value = form.getAll(key)
									if (value.length === 1)
										c.body[key] = value[0]
									else c.body[key] = value
								}`
				}
			}

			const aotParse = getAotParser()

			if (aotParse) fnLiteral += aotParse
			else {
				fnLiteral += '\n'
				fnLiteral += hasHeaders
					? `let contentType = c.headers['content-type']`
					: `let contentType = c.request.headers.get('content-type')`

				fnLiteral += `
				if (contentType) {
					const index = contentType.indexOf(';')
					if (index !== -1) contentType = contentType.substring(0, index)\n`

				if (hooks.parse.length) {
					fnLiteral += `let used = false\n`

					const endReport = report('parse', {
						unit: hooks.parse.length
					})

					for (let i = 0; i < hooks.parse.length; i++) {
						const endUnit = report('parse.unit', {
							name: hooks.parse[i].name
						})

						const name = `bo${i}`

						if (i !== 0) fnLiteral += `if(!used) {\n`

						fnLiteral += `let ${name} = parse[${i}](c, contentType)\n`
						fnLiteral += `if(${name} instanceof Promise) ${name} = await ${name}\n`
						fnLiteral += `if(${name} !== undefined) { c.body = ${name}; used = true }\n`

						endUnit()

						if (i !== 0) fnLiteral += `}`
					}

					endReport()
				}

				if (hooks.parse.length) fnLiteral += `if (!used)`

				fnLiteral += `
				switch (contentType) {
					case 'application/json':
						c.body = await c.request.json()
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
					}\n`

				fnLiteral += '}\n'
			}
		}

		fnLiteral += '\n'
	}

	endParse()

	if (hooks?.transform) {
		const endTransform = report('transform', {
			unit: hooks.transform.length
		})

		for (let i = 0; i < hooks.transform.length; i++) {
			const transform = hooks.transform[i]

			const endUnit = report('transform.unit', {
				name: transform.name
			})

			// @ts-ignore
			if (transform.$elysia === 'derive')
				fnLiteral += isAsync(transform)
					? `Object.assign(c, await transform[${i}](c));`
					: `Object.assign(c, transform[${i}](c));`
			else
				fnLiteral += isAsync(transform)
					? `await transform[${i}](c);`
					: `transform[${i}](c);`

			endUnit()
		}

		endTransform()
	}

	if (validator) {
		fnLiteral += '\n'

		if (validator.headers) {
			// @ts-ignore
			if (hasProperty('default', validator.headers.params))
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
							: `'${value}'`

					if (parsed)
						fnLiteral += `c.headers['${key}'] ??= ${parsed}\n`
				}

			fnLiteral += `if(headers.Check(c.headers) === false) {
				${composeValidation('headers')}
			}`

			// @ts-ignore
			if (hasTransform(validator.headers.schema))
				fnLiteral += `\nc.headers = headers.Decode(c.headers)\n`
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
							: `'${value}'`

					if (parsed)
						fnLiteral += `c.params['${key}'] ??= ${parsed}\n`
				}

			fnLiteral += `if(params.Check(c.params) === false) {
				${composeValidation('params')}
			}`

			// @ts-ignore
			if (hasTransform(validator.params.schema))
				fnLiteral += `\nc.params = params.Decode(c.params)\n`
		}

		if (validator.query) {
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
							: `'${value}'`

					if (parsed) fnLiteral += `c.query['${key}'] ??= ${parsed}\n`
				}

			fnLiteral += `if(query.Check(c.query) === false) {
				${composeValidation('query')}
			}`

			// @ts-ignore
			if (hasTransform(validator.query.schema))
				// Decode doesn't work with Object.create(null)
				fnLiteral += `\nc.query = query.Decode(Object.assign({}, c.query))\n`
		}

		if (validator.body) {
			// @ts-ignore
			if (hasProperty('default', validator.body.schema))
				fnLiteral += `if(body.Check(c.body) === false) {
    				c.body = Object.assign(${JSON.stringify(
						Value.Default(
							// @ts-ignore
							validator.body.schema,
							null
						) ?? {}
					)}, c.body)

    				if(body.Check(c.query) === false) {
        				${composeValidation('body')}
     			}
            }`
			else
				fnLiteral += `if(body.Check(c.body) === false) {
			${composeValidation('body')}
		}`

			// @ts-ignore
			if (hasTransform(validator.body.schema))
				fnLiteral += `\nc.body = body.Decode(c.body)\n`
		}

		// @ts-ignore
		if (isNotEmpty(validator.cookie?.schema.properties ?? {})) {
			fnLiteral += `const cookieValue = {}
    			for(const [key, value] of Object.entries(c.cookie))
    				cookieValue[key] = value.value\n`

			// @ts-ignore
			if (hasProperty('default', validator.cookie.schema))
				for (const [key, value] of Object.entries(
					Value.Default(
						// @ts-ignore
						validator.cookie.schema,
						{}
					) as Object
				)) {
					fnLiteral += `cookieValue['${key}'] = ${
						typeof value === 'object'
							? JSON.stringify(value)
							: value
					}\n`
				}

			fnLiteral += `if(cookie.Check(cookieValue) === false) {
				${composeValidation('cookie', 'cookieValue')}
			}`

			// // @ts-ignore
			// if (hasTransform(validator.cookie.schema))
			// 	fnLiteral += `\nc.cookie = params.Decode(c.cookie)\n`
		}
	}

	if (hooks?.beforeHandle) {
		const endBeforeHandle = report('beforeHandle', {
			unit: hooks.beforeHandle.length
		})

		for (let i = 0; i < hooks.beforeHandle.length; i++) {
			const beforeHandle = hooks.beforeHandle[i]

			const endUnit = report('beforeHandle.unit', {
				name: beforeHandle.name
			})

			const returning = hasReturn(beforeHandle.toString())

			// @ts-ignore
			if (beforeHandle.$elysia === 'resolve') {
				fnLiteral += isAsync(beforeHandle)
					? `Object.assign(c, await beforeHandle[${i}](c));`
					: `Object.assign(c, beforeHandle[${i}](c));`
			} else if (!returning) {
				fnLiteral += isAsync(beforeHandle)
					? `await beforeHandle[${i}](c);\n`
					: `beforeHandle[${i}](c);\n`

				endUnit()
			} else {
				fnLiteral += isAsync(beforeHandle)
					? `be = await beforeHandle[${i}](c);\n`
					: `be = beforeHandle[${i}](c);\n`

				endUnit()

				fnLiteral += `if(be !== undefined) {\n`
				const endAfterHandle = report('afterHandle', {
					unit: hooks.transform.length
				})
				if (hooks.afterHandle) {
					report('handle', {
						name: isHandleFn ? handler.name : undefined
					})()

					for (let i = 0; i < hooks.afterHandle.length; i++) {
						const returning = hasReturn(
							hooks.afterHandle[i].toString()
						)

						const endUnit = report('afterHandle.unit', {
							name: hooks.afterHandle[i].name
						})

						fnLiteral += `c.response = be\n`

						if (!returning) {
							fnLiteral += isAsync(hooks.afterHandle[i])
								? `await afterHandle[${i}](c, be)\n`
								: `afterHandle[${i}](c, be)\n`
						} else {
							fnLiteral += isAsync(hooks.afterHandle[i])
								? `af = await afterHandle[${i}](c)\n`
								: `af = afterHandle[${i}](c)\n`

							fnLiteral += `if(af !== undefined) { c.response = be = af }\n`
						}

						endUnit()
					}
				}

				endAfterHandle()

				if (validator.response)
					fnLiteral += composeResponseValidation('be')

				if (hooks.mapResponse.length) {
					fnLiteral += `c.response = be`

					for (let i = 0; i < hooks.mapResponse.length; i++) {
						fnLiteral += `\nif(mr === undefined) {
							mr = onMapResponse[${i}](c)
							if(mr instanceof Promise) mr = await mr
							if(mr !== undefined) c.response = mr
						}\n`
					}
				}

				fnLiteral += encodeCookie
				fnLiteral += `return mapEarlyResponse(be, c.set, c.request)}\n`
			}
		}

		endBeforeHandle()
	}

	if (hooks?.afterHandle.length) {
		const endHandle = report('handle', {
			name: isHandleFn ? handler.name : undefined
		})

		if (hooks.afterHandle.length)
			fnLiteral += isAsyncHandler
				? `let r = c.response = await ${handle};\n`
				: `let r = c.response = ${handle};\n`
		else
			fnLiteral += isAsyncHandler
				? `let r = await ${handle};\n`
				: `let r = ${handle};\n`

		endHandle()

		const endAfterHandle = report('afterHandle', {
			unit: hooks.afterHandle.length
		})

		for (let i = 0; i < hooks.afterHandle.length; i++) {
			const returning = hasReturn(hooks.afterHandle[i].toString())

			const endUnit = report('afterHandle.unit', {
				name: hooks.afterHandle[i].name
			})

			if (!returning) {
				fnLiteral += isAsync(hooks.afterHandle[i])
					? `await afterHandle[${i}](c)\n`
					: `afterHandle[${i}](c)\n`

				endUnit()
			} else {
				fnLiteral += isAsync(hooks.afterHandle[i])
					? `af = await afterHandle[${i}](c)\n`
					: `af = afterHandle[${i}](c)\n`

				endUnit()

				if (validator.response) {
					fnLiteral += `if(af !== undefined) {`
					endAfterHandle()

					fnLiteral += composeResponseValidation('af')

					fnLiteral += `c.response = af }`
				} else {
					fnLiteral += `if(af !== undefined) {`
					endAfterHandle()

					fnLiteral += `c.response = af}\n`
				}
			}
		}

		endAfterHandle()

		fnLiteral += `r = c.response\n`

		if (validator.response) fnLiteral += composeResponseValidation()

		fnLiteral += encodeCookie

		if (hooks.mapResponse.length) {
			for (let i = 0; i < hooks.mapResponse.length; i++) {
				fnLiteral += `\nmr = onMapResponse[${i}](c)
				if(mr instanceof Promise) mr = await mr
				if(mr !== undefined) c.response = mr\n`
			}
		}

		if (hasSet) fnLiteral += `return mapResponse(r, c.set, c.request)\n`
		else fnLiteral += `return mapCompactResponse(r, c.request)\n`
	} else {
		const endHandle = report('handle', {
			name: isHandleFn ? handler.name : undefined
		})

		if (validator.response || hooks.mapResponse.length) {
			fnLiteral += isAsyncHandler
				? `let r = await ${handle};\n`
				: `let r = ${handle};\n`

			endHandle()

			if (validator.response) fnLiteral += composeResponseValidation()

			report('afterHandle')()

			if (hooks.mapResponse.length) {
				fnLiteral += 'c.response = r'
				for (let i = 0; i < hooks.mapResponse.length; i++) {
					fnLiteral += `\nif(mr === undefined) { 
						mr = onMapResponse[${i}](c)
						if(mr instanceof Promise) mr = await mr
    					if(mr !== undefined) r = c.response = mr
					}\n`
				}
			}

			fnLiteral += encodeCookie

			if (handler instanceof Response)
				fnLiteral += `return ${handle}.clone()\n`
			else if (hasSet)
				fnLiteral += `return mapResponse(r, c.set, c.request)\n`
			else fnLiteral += `return mapCompactResponse(r, c.request)\n`
		} else if (traceConditions.handle || hasCookie) {
			fnLiteral += isAsyncHandler
				? `let r = await ${handle};\n`
				: `let r = ${handle};\n`

			endHandle()

			report('afterHandle')()

			if (hooks.mapResponse.length) {
				fnLiteral += 'c.response = r'
				for (let i = 0; i < hooks.mapResponse.length; i++) {
					fnLiteral += `\nif(mr === undefined) {
							mr = onMapResponse[${i}](c)
							if(mr instanceof Promise) mr = await mr
    						if(mr !== undefined) r = c.response = mr
						}\n`
				}
			}

			fnLiteral += encodeCookie

			if (hasSet) fnLiteral += `return mapResponse(r, c.set, c.request)\n`
			else fnLiteral += `return mapCompactResponse(r, c.request)\n`
		} else {
			endHandle()

			const handled = isAsyncHandler ? `await ${handle}` : handle

			report('afterHandle')()

			if (handler instanceof Response)
				fnLiteral += `return ${handle}.clone()\n`
			else if (hasSet)
				fnLiteral += `return mapResponse(${handled}, c.set, c.request)\n`
			else
				fnLiteral += `return mapCompactResponse(${handled}, c.request)\n`
		}
	}

	if (hasErrorHandler || handleResponse) {
		fnLiteral += `
} catch(error) {`

		if (!maybeAsync) fnLiteral += `return (async () => {`

		fnLiteral += `const set = c.set

		if (!set.status || set.status < 300) set.status = error?.status || 500
	`

		const endError = report('error', {
			unit: hooks.error.length
		})
		if (hooks.error.length) {
			fnLiteral += `
				c.error = error
				c.code = error.code ?? error[ERROR_CODE] ?? "UNKNOWN"
			`

			for (let i = 0; i < hooks.error.length; i++) {
				const name = `er${i}`
				const endUnit = report('error.unit', {
					name: hooks.error[i].name
				})

				fnLiteral += `\nlet ${name} = handleErrors[${i}](c)\n`

				if (isAsync(hooks.error[i]))
					fnLiteral += `if (${name} instanceof Promise) ${name} = await ${name}\n`

				endUnit()

				fnLiteral += `${name} = mapEarlyResponse(${name}, set, c.request)\n`
				fnLiteral += `if (${name}) {`
				fnLiteral += `return ${name} }\n`
			}
		}

		endError()

		fnLiteral += `return handleError(c, error)\n\n`

		if (!maybeAsync) fnLiteral += '})()'

		fnLiteral += '}'

		if (handleResponse || hasTrace) {
			fnLiteral += ` finally { `

			const endResponse = report('response', {
				unit: hooks.onResponse.length
			})

			fnLiteral += handleResponse

			endResponse()

			fnLiteral += `}`
		}
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
			onResponse
		},
		validator: {
			body,
			headers,
			params,
			query,
			response,
			cookie
		},
		utils: {
			mapResponse,
			mapCompactResponse,
			mapEarlyResponse,
			parseQuery
		},
		error: {
			NotFoundError,
			ValidationError,
			InternalServerError
		},
		schema,
		definitions,
		ERROR_CODE,
		getReporter,
		requestId,
		parseCookie,
		signCookie,
		decodeURIComponent,
		ELYSIA_RESPONSE
	} = hooks

	${
		hooks.onResponse.length
			? `const ${hooks.onResponse
					.map((x, i) => `res${i} = onResponse[${i}]`)
					.join(',')}`
			: ''
	}

	return ${maybeAsync ? 'async' : ''} function handle(c) {
		${hooks.beforeHandle.length ? 'let be' : ''}
		${hooks.afterHandle.length ? 'let af' : ''}
		${hooks.mapResponse.length ? 'let mr' : ''}

		${allowMeta ? 'c.schema = schema; c.defs = definitions' : ''}
		${fnLiteral}
	}`

	const createHandler = Function('hooks', fnLiteral)

	return createHandler({
		handler,
		hooks,
		validator,
		// @ts-ignore
		handleError: app.handleError,
		utils: {
			mapResponse,
			mapCompactResponse,
			mapEarlyResponse,
			parseQuery
		},
		error: {
			NotFoundError,
			ValidationError,
			InternalServerError
		},
		schema: app.router.history,
		// @ts-ignore
		definitions: app.definitions.type,
		ERROR_CODE,
		// @ts-ignore
		getReporter: () => app.reporter,
		requestId,
		parseCookie,
		signCookie,
		decodeURIComponent,
		ELYSIA_RESPONSE
	})
}

export const composeGeneralHandler = (
	app: Elysia<any, any, any, any, any, any, any, any>
) => {
	const inference = app.inference.trace

	let decoratorsLiteral = ''
	let fnLiteral = ''

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

	ctx.params = route.params
	`

	const shouldPrecompile =
		app.config.precompile === true ||
		(typeof app.config.precompile === 'object' &&
			app.config.precompile.compose === true)

	if (!shouldPrecompile)
		findDynamicRoute += `
			if(route.store.composed)
				return route.store.composed(ctx)

			if(route.store.compose)
				return (route.store.compose())(ctx)`
	else findDynamicRoute += `return route.store(ctx)`

	findDynamicRoute += '\n'

	let switchMap = ``
	for (const [path, { code, all }] of Object.entries(router.static.http.map))
		switchMap += `case '${path}':\nswitch(request.method) {\n${code}\n${
			all ?? `default: break map`
		}}\n\n`

	const maybeAsync = app.event.request.some(isAsync)

	fnLiteral += `const {
		app,
		mapEarlyResponse,
		NotFoundError,
		requestId,
		getReporter,
		handleError
	} = data

	const store = app.singleton.store
	const staticRouter = app.router.static.http
	const wsRouter = app.router.static.ws
	const router = app.router.http

	const notFound = new NotFoundError()

	${app.event.request.length ? `const onRequest = app.event.request` : ''}
	${router.static.http.variables}
	${
		app.event.error.length
			? ''
			: `
	const error404Message = notFound.message.toString()
	const error404 = new Response(error404Message, { status: 404 });
	`
	}

	return ${maybeAsync ? 'async' : ''} function map(request) {\n`

	if (app.event.request.length) fnLiteral += `let re`

	const report = createReport({
		hasTrace,
		hasTraceSet: inference.set,
		condition: {
			request: inference.request
		},
		addFn: (word) => {
			fnLiteral += word
		}
	})

	if (app.event.request.length) {
		fnLiteral += `
			${hasTrace ? 'const id = +requestId.value++' : ''}

			const ctx = {
				request,
				store,
				set: {
					headers: ${
						// @ts-ignore
						Object.keys(app.setHeaders ?? {}).length
							? 'Object.assign({}, app.setHeaders)'
							: '{}'
					},
					status: 200
				}
				${hasTrace ? ',$$requestId: +id' : ''}
				${decoratorsLiteral}
			}
		`

		const endReport = report('request', {
			attribute: 'ctx',
			unit: app.event.request.length
		})

		fnLiteral += `\n try {\n`

		for (let i = 0; i < app.event.request.length; i++) {
			const fn = app.event.request[i]
			const withReturn = hasReturn(fn.toString())
			const maybeAsync = isAsync(fn)

			const endUnit = report('request.unit', {
				name: app.event.request[i].name
			})

			if (withReturn) {
				fnLiteral += `re = mapEarlyResponse(
					${maybeAsync ? 'await' : ''} onRequest[${i}](ctx),
					ctx.set,
					request
				)\n`

				endUnit()

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

		endReport()

		fnLiteral += `
		const url = request.url
		const s = url.indexOf('/', 11)
		const qi = ctx.qi = url.indexOf('?', s + 1)
		const path = ctx.path = url.substring(s, qi === -1 ? undefined : qi)`
	} else {
		fnLiteral += `
		const url = request.url
		const s = url.indexOf('/', 11)
		const qi = url.indexOf('?', s + 1)
		const path = url.substring(s, qi === -1 ? undefined : qi)
		${hasTrace ? 'const id = +requestId.value++' : ''}
		const ctx = {
			request,
			store,
			qi,
			path,
			set: {
				headers: ${
					// @ts-ignore
					Object.keys(app.setHeaders ?? {}).length
						? 'Object.assign({}, app.setHeaders)'
						: '{}'
				},
				status: 200
			}
			${hasTrace ? ',$$requestId: id' : ''}
			${decoratorsLiteral}
		}`

		report('request', {
			unit: app.event.request.length,
			attribute:
				inference.context || inference.store || inference.set
					? 'ctx'
					: ''
		})()
	}

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
							return st${index}(ctx)

						break`
		}

		fnLiteral += `
				default:
					if(request.headers.get('upgrade') === 'websocket') {
						const route = wsRouter.find('ws', path)

						if(route) {
							ctx.params = route.params

							return route.store(ctx)
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
	}`

	const handleError = composeErrorHandler(app) as any

	// @ts-ignore
	app.handleError = handleError

	return Function(
		'data',
		fnLiteral
	)({
		app,
		mapEarlyResponse,
		NotFoundError,
		// @ts-ignore
		getReporter: () => app.reporter,
		requestId,
		handleError
	})
}

export const composeErrorHandler = (
	app: Elysia<any, any, any, any, any, any, any, any>
) => {
	let fnLiteral = `const {
		app: { event: { error: onError, onResponse: res } },
		mapResponse,
		ERROR_CODE,
		ELYSIA_RESPONSE
	} = inject

	return ${
		app.event.error.find(isAsync) ? 'async' : ''
	} function(context, error) {
		let r

		const { set } = context

		context.code = error.code
		context.error = error

		if(error[ELYSIA_RESPONSE]) {
			error.status = error[ELYSIA_RESPONSE]
			error.message = error.response
		}
`
	for (let i = 0; i < app.event.error.length; i++) {
		const handler = app.event.error[i]

		const response = `${
			isAsync(handler) ? 'await ' : ''
		}onError[${i}](context)`

		if (hasReturn(handler.toString()))
			fnLiteral += `r = ${response}; if(r !== undefined) {
				if(r instanceof Response) return r

				if(r[ELYSIA_RESPONSE]) {
					error.status = error[ELYSIA_RESPONSE]
					error.message = error.response
				}
		
				if(set.status === 200) set.status = error.status
				return mapResponse(r, set, context.request)
			}\n`
		else fnLiteral += response + '\n'
	}

	fnLiteral += `if(error.constructor.name === "ValidationError" || error.constructor.name === "TransformDecodeError") {
		set.status = error.status ?? 400
		return new Response(
			error.message,
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
			)

		return mapResponse(error, set, context.request)
	}
}`

	return Function(
		'inject',
		fnLiteral
	)({
		app,
		mapResponse,
		ERROR_CODE,
		ELYSIA_RESPONSE
	})
}
