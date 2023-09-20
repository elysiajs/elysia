import { type Elysia } from '.'

import { TypeCheck } from '@sinclair/typebox/compiler'
import type { TAnySchema } from '@sinclair/typebox'

import { parse as parseQuery } from 'fast-querystring'

import { sign as signCookie } from 'cookie-signature'

import { mapEarlyResponse, mapResponse, mapCompactResponse } from './handler'
import {
	NotFoundError,
	ValidationError,
	InternalServerError,
	ERROR_CODE
} from './error'

import { parseCookie } from './cookie'

import type {
	ComposedHandler,
	ElysiaConfig,
	Handler,
	LifeCycleStore,
	PreHandler,
	SchemaValidator,
	TraceEvent,
	TraceReporter
} from './types'

const headersHasToJSON = new Headers().toJSON
const findAliases = new RegExp(` (\\w+) = context`, 'g')

const requestId = { value: 0 }

const createReport = ({
	hasTrace,
	hasTraceSet = false,
	hasTraceChildren = false,
	addFn,
	condition = {}
}: {
	hasTrace: boolean | number
	hasTraceChildren: boolean
	hasTraceSet?: boolean
	addFn(string: string): void
	condition: Partial<Record<TraceEvent, boolean>>
}) => {
	if (hasTrace) {
		const microtask = hasTraceChildren
			? '\nawait new Promise(r => {queueMicrotask(() => queueMicrotask(r))})\n'
			: '\nawait new Promise(r => {queueMicrotask(r)})\n'

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
					if (hasTraceSet && event === 'afterHandle') addFn(microtask)
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

				if (hasTraceSet && event === 'afterHandle') {
					addFn(microtask)
				}
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
			? `c.set.status = 400; throw new ValidationError(
'${type}',
${type},
${value}
)`
			: `c.set.status = 400; return new ValidationError(
	'${type}',
	${type},
	${value}
).toResponse(c.set.headers)`,
	composeResponseValidation: (name = 'r') => {
		const returnError = hasErrorHandler
			? `throw new ValidationError(
'response',
response[c.set.status],
${name}
)`
			: `return new ValidationError(
'response',
response[c.set.status],
${name}
).toResponse(c.set.headers)`

		return `\n${injectResponse}
		if(response[c.set.status]?.Check(${name}) === false) { 
	if(!(response instanceof Error))
		${returnError}
}\n`
	}
})

export const isFnUse = (keyword: string, fnLiteral: string) => {
	fnLiteral = fnLiteral.trimStart()
	fnLiteral = fnLiteral.replaceAll(/^async /g, '')

	if (/^(\w+)\(/g.test(fnLiteral))
		fnLiteral = fnLiteral.slice(fnLiteral.indexOf('('))

	const argument =
		// CharCode 40 is '('
		fnLiteral.charCodeAt(0) === 40 || fnLiteral.startsWith('function')
			? // Bun: (context) => {}
			  fnLiteral.slice(
					fnLiteral.indexOf('(') + 1,
					fnLiteral.indexOf(')')
			  )
			: // Node: context => {}
			  fnLiteral.slice(0, fnLiteral.indexOf('=') - 1)

	if (argument === '') return false

	const restIndex =
		argument.charCodeAt(0) === 123 ? argument.indexOf('...') : -1

	// Using object destructuring
	if (argument.charCodeAt(0) === 123) {
		// Since Function already format the code, styling is enforced
		if (argument.includes(keyword)) return true

		if (restIndex === -1) return false
	}

	// Match dot notation and named access
	if (
		fnLiteral.match(
			new RegExp(`${argument}(.${keyword}|\\["${keyword}"\\])`)
		)
	) {
		return true
	}

	const restAlias =
		restIndex !== -1
			? argument.slice(
					restIndex + 3,
					argument.indexOf(' ', restIndex + 3)
			  )
			: undefined

	if (
		fnLiteral.match(
			new RegExp(`${restAlias}(.${keyword}|\\["${keyword}"\\])`)
		)
	)
		return true

	const aliases = [argument]
	if (restAlias) aliases.push(restAlias)

	for (const found of fnLiteral.matchAll(findAliases)) aliases.push(found[1])

	const destructuringRegex = new RegExp(`{.*?} = (${aliases.join('|')})`, 'g')

	for (const [params] of fnLiteral.matchAll(destructuringRegex))
		if (params.includes(`{ ${keyword}`) || params.includes(`, ${keyword}`))
			return true

	return false
}

const isContextPassToFunction = (fnLiteral: string) => {
	fnLiteral = fnLiteral.trimStart()
	fnLiteral = fnLiteral.replaceAll(/^async /g, '')

	if (/^(\w+)\(/g.test(fnLiteral))
		fnLiteral = fnLiteral.slice(fnLiteral.indexOf('('))

	const argument =
		// CharCode 40 is '('
		fnLiteral.charCodeAt(0) === 40 || fnLiteral.startsWith('function')
			? // Bun: (context) => {}
			  fnLiteral.slice(
					fnLiteral.indexOf('(') + 1,
					fnLiteral.indexOf(')')
			  )
			: // Node: context => {}
			  fnLiteral.slice(0, fnLiteral.indexOf('=') - 1)

	// console.log(fnLiteral)

	if (argument === '') return false

	const restIndex =
		argument.charCodeAt(0) === 123 ? argument.indexOf('...') : -1

	const restAlias =
		restIndex !== -1
			? argument.slice(
					restIndex + 3,
					argument.indexOf(' ', restIndex + 3)
			  )
			: undefined

	const aliases = [argument]
	if (restAlias) aliases.push(restAlias)

	for (const found of fnLiteral.matchAll(findAliases)) aliases.push(found[1])

	for (const alias of aliases)
		if (new RegExp(`\\b\\w+\\([^)]*\\b${alias}\\b[^)]*\\)`).test(fnLiteral))
			return true

	const destructuringRegex = new RegExp(`{.*?} = (${aliases.join('|')})`, 'g')

	for (const [renamed] of fnLiteral.matchAll(destructuringRegex))
		if (
			new RegExp(`\\b\\w+\\([^)]*\\b${renamed}\\b[^)]*\\)`).test(
				fnLiteral
			)
		)
			return true

	return false
}

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

const TransformSymbol = Symbol.for('TypeBox.Transform')

export const hasTransform = (schema: TAnySchema) => {
	if (!schema) return

	if (schema.type === 'object') {
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

const matchFnReturn = /(?:return|=>) \S*\(/g

export const isAsync = (fn: Function) => {
	if (fn.constructor.name === 'AsyncFunction') return true

	return fn.toString().match(matchFnReturn)
}

export const composeHandler = ({
	path,
	method,
	hooks,
	validator,
	handler,
	handleError,
	definitions,
	schema,
	onRequest,
	config,
	reporter
}: {
	path: string
	method: string
	hooks: LifeCycleStore
	validator: SchemaValidator
	handler: Handler<any, any>
	handleError: Elysia['handleError']
	definitions?: Elysia['definitions']['type']
	schema?: Elysia['schema']
	onRequest: PreHandler<any, any>[]
	config: ElysiaConfig<any>
	reporter: TraceReporter
}): ComposedHandler => {
	const hasErrorHandler =
		config.forceErrorEncapsulation ||
		hooks.error.length > 0 ||
		typeof Bun === 'undefined' ||
		hooks.onResponse.length > 0 ||
		!!hooks.trace.length

	const handleResponse = hooks.onResponse.length
		? `\n;(async () => {${hooks.onResponse
				.map((_, i) => `await res${i}(c)`)
				.join(';')}})();\n`
		: ''

	const traceLiteral = hooks.trace.map((x) => x.toString())

	let hasUnknownContext = false

	if (isContextPassToFunction(handler.toString())) hasUnknownContext = true

	if (!hasUnknownContext)
		for (const [key, value] of Object.entries(hooks)) {
			if (
				!Array.isArray(value) ||
				!value.length ||
				![
					'parse',
					'transform',
					'beforeHandle',
					'afterHandle',
					'onResponse'
				].includes(key)
			)
				continue

			for (const handle of value) {
				if (typeof handle !== 'function') continue

				if (isContextPassToFunction(handle.toString())) {
					hasUnknownContext = true
					break
				}
			}

			if (hasUnknownContext) break
		}

	const traceConditions: Record<
		Exclude<TraceEvent, `${string}.unit` | 'request' | 'response'>,
		boolean
	> = {
		parse: traceLiteral.some((x) => isFnUse('parse', x)),
		transform: traceLiteral.some((x) => isFnUse('transform', x)),
		handle: traceLiteral.some((x) => isFnUse('handle', x)),
		beforeHandle: traceLiteral.some((x) => isFnUse('beforeHandle', x)),
		afterHandle: traceLiteral.some((x) => isFnUse('afterHandle', x)),
		error: hasErrorHandler || traceLiteral.some((x) => isFnUse('error', x))
	}

	const hasTrace = hooks.trace.length > 0
	let fnLiteral = ''

	if (hasTrace) fnLiteral += '\nconst id = c.$$requestId\n'

	fnLiteral += hasErrorHandler ? 'try {\n' : ''

	const lifeCycleLiteral =
		validator || (method !== 'GET' && method !== 'HEAD')
			? [
					handler,
					...hooks.transform,
					...hooks.beforeHandle,
					...hooks.afterHandle
			  ].map((x) => x.toString())
			: []

	const hasBody =
		hasUnknownContext ||
		(method !== 'GET' &&
			method !== 'HEAD' &&
			hooks.type !== 'none' &&
			(!!validator.body ||
				!!hooks.type ||
				lifeCycleLiteral.some((fn) => isFnUse('body', fn))))

	const hasHeaders =
		hasUnknownContext ||
		validator.headers ||
		lifeCycleLiteral.some((fn) => isFnUse('headers', fn))

	const hasCookie =
		hasUnknownContext ||
		validator.cookie ||
		lifeCycleLiteral.some((fn) => isFnUse('cookie', fn))

	// @ts-ignore
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
			// encodeCookie += `if(_setCookie['${name}']?.value) { c.set.cookie['${name}'].value = signCookie(_setCookie['${name}'].value, '${secret}') }\n`
			encodeCookie += `for(const [key, cookie] of Object.entries(_setCookie)) {
				c.set.cookie[key].value = signCookie(cookie.value, '${secret}')
			}`
		} else
			for (const name of cookieMeta.sign) {
				// if (!(name in cookieMeta.properties)) continue

				encodeCookie += `if(_setCookie['${name}']?.value) { c.set.cookie['${name}'].value = signCookie(_setCookie['${name}'].value, '${secret}') }\n`
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
			}
		}`
			: 'undefined'

		if (hasHeaders)
			fnLiteral += `\nc.cookie = parseCookie(c.set, c.headers.cookie, ${options})\n`
		else
			fnLiteral += `\nc.cookie = parseCookie(c.set, c.request.headers.get('cookie'), ${options})\n`
	}

	const hasQuery =
		hasUnknownContext ||
		validator.query ||
		lifeCycleLiteral.some((fn) => isFnUse('query', fn))

	if (hasQuery) {
		fnLiteral += `const url = c.request.url

		if(c.qi !== -1) {
			c.query ??= parseQuery(url.substring(c.qi + 1))
		} else {
			c.query ??= {}
		}
		`
	}

	const traceLiterals = hooks.trace.map((x) => x.toString())
	const hasTraceSet = traceLiterals.some(
		(fn) => isFnUse('set', fn) || isContextPassToFunction(fn)
	)
	const hasTraceChildren =
		hasTraceSet &&
		traceLiterals.some(
			(fn) => fn.includes('children') || isContextPassToFunction(fn)
		)

	hasUnknownContext || hooks.trace.some((fn) => isFnUse('set', fn.toString()))

	const hasSet =
		hasTraceSet ||
		hasCookie ||
		lifeCycleLiteral.some((fn) => isFnUse('set', fn)) ||
		onRequest.some((fn) => isFnUse('set', fn.toString()))

	const report = createReport({
		hasTrace,
		hasTraceSet,
		hasTraceChildren,
		condition: traceConditions,
		addFn: (word) => {
			fnLiteral += word
		}
	})

	const maybeAsync =
		hasBody ||
		hasTraceSet ||
		isAsync(handler) ||
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

					switch (type) {
						case 'object':
							if (
								hasType('File', schema) ||
								hasType('Files', schema)
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
							// else {
							// 	// Since it's an object an not accepting file
							// 	// we can infer that it's JSON
							// 	fnLiteral += `c.body = await c.request.json()\n`
							// }
							break

						default:
							// fnLiteral += defaultParser
							break
					}
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
				fnLiteral += isAsync(hooks.transform[i])
					? `Object.assign(c, await transform[${i}](c));`
					: `Object.assign(c, transform[${i}](c));`
			else
				fnLiteral += isAsync(hooks.transform[i])
					? `await transform[${i}](c);`
					: `transform[${i}](c);`

			endUnit()
		}

		endTransform()
	}

	if (validator) {
		fnLiteral += '\n'

		if (validator.headers) {
			fnLiteral += `if(headers.Check(c.headers) === false) {
				${composeValidation('headers')}
			}`

			// @ts-ignore
			if (hasTransform(validator.headers.schema))
				fnLiteral += `\nc.headers = headers.Decode(c.headers)\n`
		}

		if (validator.params) {
			fnLiteral += `if(params.Check(c.params) === false) {
				${composeValidation('params')}
			}`

			// @ts-ignore
			if (hasTransform(validator.params.schema))
				fnLiteral += `\nc.params = params.Decode(c.params)\n`
		}

		if (validator.query) {
			fnLiteral += `if(query.Check(c.query) === false) {
				${composeValidation('query')} 
			}`

			// @ts-ignore
			if (hasTransform(validator.query.schema))
				// Decode doesn't work with Object.create(null)
				fnLiteral += `\nc.query = query.Decode(Object.assign({}, c.query))\n`
		}

		if (validator.body) {
			fnLiteral += `if(body.Check(c.body) === false) { 
				${composeValidation('body')}
			}`

			// @ts-ignore
			if (hasTransform(validator.body.schema))
				fnLiteral += `\nc.body = body.Decode(c.body)\n`
		}

		if (validator.cookie) {
			fnLiteral += `const cookieValue = {}
			for(const [key, value] of Object.entries(c.cookie))
				cookieValue[key] = value.value

			if(cookie.Check(cookieValue) === false) {
				${composeValidation('cookie', 'cookieValue')}
			}`

			// @ts-ignore
			if (hasTransform(validator.cookie.schema))
				fnLiteral += `\nc.cookie = params.Decode(c.cookie)\n`
		}
	}

	if (hooks?.beforeHandle) {
		const endBeforeHandle = report('beforeHandle', {
			unit: hooks.beforeHandle.length
		})

		for (let i = 0; i < hooks.beforeHandle.length; i++) {
			const endUnit = report('beforeHandle.unit', {
				name: hooks.beforeHandle[i].name
			})

			const name = `be${i}`
			const returning = hasReturn(hooks.beforeHandle[i].toString())

			if (!returning) {
				fnLiteral += isAsync(hooks.beforeHandle[i])
					? `await beforeHandle[${i}](c);\n`
					: `beforeHandle[${i}](c);\n`

				endUnit()
			} else {
				fnLiteral += isAsync(hooks.beforeHandle[i])
					? `let ${name} = await beforeHandle[${i}](c);\n`
					: `let ${name} = beforeHandle[${i}](c);\n`

				endUnit()

				fnLiteral += `if(${name} !== undefined) {\n`
				const endAfterHandle = report('afterHandle', {
					unit: hooks.transform.length
				})
				if (hooks.afterHandle) {
					const beName = name
					for (let i = 0; i < hooks.afterHandle.length; i++) {
						const returning = hasReturn(
							hooks.afterHandle[i].toString()
						)

						const endUnit = report('afterHandle.unit', {
							name: hooks.afterHandle[i].name
						})

						fnLiteral += `c.response = ${beName}\n`

						if (!returning) {
							fnLiteral += isAsync(hooks.afterHandle[i])
								? `await afterHandle[${i}](c, ${beName});\n`
								: `afterHandle[${i}](c, ${beName});\n`
						} else {
							const name = `af${i}`

							fnLiteral += isAsync(hooks.afterHandle[i])
								? `const ${name} = await afterHandle[${i}](c);\n`
								: `const ${name} = afterHandle[${i}](c);\n`

							fnLiteral += `if(${name} !== undefined) { c.response = ${beName} = ${name} }\n`
						}

						endUnit()
					}
				}
				endAfterHandle()

				if (validator.response)
					fnLiteral += composeResponseValidation(name)

				fnLiteral += encodeCookie
				fnLiteral += `return mapEarlyResponse(${name}, c.set)}\n`
			}
		}

		endBeforeHandle()
	}

	if (hooks?.afterHandle.length) {
		const endHandle = report('handle', {
			name: handler.name
		})

		if (hooks.afterHandle.length)
			fnLiteral += isAsync(handler)
				? `let r = c.response = await handler(c);\n`
				: `let r = c.response = handler(c);\n`
		else
			fnLiteral += isAsync(handler)
				? `let r = await handler(c);\n`
				: `let r = handler(c);\n`

		endHandle()

		const endAfterHandle = report('afterHandle', {
			unit: hooks.afterHandle.length
		})

		for (let i = 0; i < hooks.afterHandle.length; i++) {
			const name = `af${i}`
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
				if (validator.response)
					fnLiteral += isAsync(hooks.afterHandle[i])
						? `let ${name} = await afterHandle[${i}](c)\n`
						: `let ${name} = afterHandle[${i}](c)\n`
				else
					fnLiteral += isAsync(hooks.afterHandle[i])
						? `let ${name} = mapEarlyResponse(await afterHandle[${i}](c), c.set)\n`
						: `let ${name} = mapEarlyResponse(afterHandle[${i}](c), c.set)\n`

				endUnit()

				if (validator.response) {
					fnLiteral += `if(${name} !== undefined) {`
					fnLiteral += composeResponseValidation(name)

					fnLiteral += `${name} = mapEarlyResponse(${name}, c.set)\n`

					fnLiteral += `if(${name}) {`
					endAfterHandle()
					fnLiteral += `return ${name} } }`
				} else {
					fnLiteral += `if(${name}) {`
					endAfterHandle()
					fnLiteral += `return ${name}}\n`
				}
			}
		}

		endAfterHandle()

		fnLiteral += `r = c.response\n`

		if (validator.response) fnLiteral += composeResponseValidation()

		fnLiteral += encodeCookie
		if (hasSet) fnLiteral += `return mapResponse(r, c.set)\n`
		else fnLiteral += `return mapCompactResponse(r)\n`
	} else {
		const endHandle = report('handle', {
			name: handler.name
		})

		if (validator.response) {
			fnLiteral += isAsync(handler)
				? `const r = await handler(c);\n`
				: `const r = handler(c);\n`

			endHandle()

			fnLiteral += composeResponseValidation()

			report('afterHandle')()

			fnLiteral += encodeCookie

			if (hasSet) fnLiteral += `return mapResponse(r, c.set)\n`
			else fnLiteral += `return mapCompactResponse(r)\n`
		} else {
			if (traceConditions.handle || hasCookie) {
				fnLiteral += isAsync(handler)
					? `let r = await handler(c);\n`
					: `let r = handler(c);\n`

				endHandle()

				report('afterHandle')()

				fnLiteral += encodeCookie

				if (hasSet) fnLiteral += `return mapResponse(r, c.set)\n`
				else fnLiteral += `return mapCompactResponse(r)\n`
			} else {
				endHandle()

				const handled = isAsync(handler)
					? 'await handler(c) '
					: 'handler(c)'

				report('afterHandle')()

				if (hasSet)
					fnLiteral += `return mapResponse(${handled}, c.set)\n`
				else fnLiteral += `return mapCompactResponse(${handled})\n`
			}
		}
	}

	if (hasErrorHandler || handleResponse) {
		fnLiteral += `
} catch(error) {`

		if (!maybeAsync) fnLiteral += `return (async () => {`

		fnLiteral += `const set = c.set

		if (!set.status || set.status < 300) set.status = 500
	`

		const endError = report('error', {
			unit: hooks.error.length
		})
		if (hooks.error.length) {
			for (let i = 0; i < hooks.error.length; i++) {
				const name = `er${i}`
				const endUnit = report('error.unit', {
					name: hooks.error[i].name
				})

				fnLiteral += `\nlet ${name} = handleErrors[${i}]({
					request: c.request,
					error: error,
					set,
					code: error.code ?? error[ERROR_CODE] ?? "UNKNOWN"
				})\n`

				if (isAsync(hooks.error[i]))
					fnLiteral += `if (${name} instanceof Promise) ${name} = await ${name}\n`

				endUnit()

				fnLiteral += `${name} = mapEarlyResponse(${name}, set)\n`
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

	// console.log(fnLiteral)

	fnLiteral = `const { 
		handler,
		handleError,
		hooks: {
			transform,
			beforeHandle,
			afterHandle,
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
		reporter,
		requestId,
		parseCookie,
		signCookie
	} = hooks

	${
		hooks.onResponse.length
			? `const ${hooks.onResponse
					.map((x, i) => `res${i} = onResponse[${i}]`)
					.join(',')}`
			: ''
	}

	return ${maybeAsync ? 'async' : ''} function(c) {
		${schema && definitions ? 'c.schema = schema; c.defs = definitions;' : ''}
		${fnLiteral}
	}`

	const createHandler = Function('hooks', fnLiteral)

	return createHandler({
		handler,
		hooks,
		validator,
		handleError,
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
		reporter,
		requestId,
		parseCookie,
		signCookie
	})
}

export const composeGeneralHandler = (app: Elysia<any, any, any, any, any>) => {
	let decoratorsLiteral = ''
	let fnLiteral = ''

	// @ts-ignore
	for (const key of Object.keys(app.decorators))
		decoratorsLiteral += `,${key}: app.decorators.${key}`

	// @ts-ignore
	const { router, staticRouter } = app

	const hasTrace = app.event.trace.length > 0

	const findDynamicRoute = `
	const route = find(request.method, path) ${
		router.root.ALL ? '?? find("ALL", path)' : ''
	}
	if (route === null)
		return ${
			app.event.error.length
				? `app.handleError(ctx, notFound)`
				: `new Response(error404, {
					status: 404
				})`
		}

	ctx.params = route.params

	return route.store(ctx)`

	let switchMap = ``
	for (const [path, { code, all }] of Object.entries(staticRouter.map))
		switchMap += `case '${path}':\nswitch(request.method) {\n${code}\n${
			all ?? `default: break map`
		}}\n\n`

	const maybeAsync = app.event.request.some(isAsync)

	fnLiteral += `const {
		app,
		app: { store, router, staticRouter },
		mapEarlyResponse,
		NotFoundError,
		requestId,
		reporter
	} = data

	const notFound = new NotFoundError()

	${app.event.request.length ? `const onRequest = app.event.request` : ''}

	${staticRouter.variables}

	const find = router.find.bind(router)
	const handleError = app.handleError.bind(this)

	${app.event.error.length ? '' : `const error404 = notFound.message.toString()`}

	return ${maybeAsync ? 'async' : ''} function map(request) {
	`

	const traceLiteral = app.event.trace.map((x) => x.toString())
	const report = createReport({
		hasTrace,
		hasTraceChildren:
			hasTrace &&
			traceLiteral.some(
				(x) => x.includes('children') || isContextPassToFunction(x)
			),
		condition: {
			request: traceLiteral.some(
				(x) => isFnUse('request', x) || isContextPassToFunction(x)
			)
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
					cookie: {},
					headers: {},
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

		fnLiteral += `try {\n`

		for (let i = 0; i < app.event.request.length; i++) {
			const fn = app.event.request[i]
			const withReturn = hasReturn(fn.toString())
			const maybeAsync = isAsync(fn)

			const endUnit = report('request.unit', {
				name: app.event.request[i].name
			})

			if (withReturn) {
				fnLiteral += `const response = mapEarlyResponse(
					${maybeAsync ? 'await' : ''} onRequest[${i}](ctx),
					ctx.set
				)\n`

				endUnit()

				fnLiteral += `if(response) return response\n`
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
		const url = request.url,
		s = url.indexOf('/', 11),
		i = ctx.qi = url.indexOf('?', s + 1),
		path = ctx.path = i === -1 ? url.substring(s) : url.substring(s, i);`
	} else {
		fnLiteral += `
		const url = request.url,
			s = url.indexOf('/', 11),
			qi = url.indexOf('?', s + 1),
			path = qi === -1
				? url.substring(s)
				: url.substring(s, qi)

		${hasTrace ? 'const id = +requestId.value++' : ''}

		const ctx = {
			request,
			store,
			qi,
			path,
			set: {
				headers: {},
				status: 200
			}
			${hasTrace ? ',$$requestId: id' : ''}
			${decoratorsLiteral}
		}`

		report('request', {
			unit: app.event.request.length,
			attribute:
				traceLiteral.some((x) => isFnUse('context', x)) ||
				traceLiteral.some((x) => isFnUse('store', x)) ||
				traceLiteral.some((x) => isFnUse('set', x))
					? 'ctx'
					: ''
		})()
	}

	fnLiteral += `
		map: switch(path) {
			${switchMap}

			default:
				break
		}

		${findDynamicRoute}
	}`

	// @ts-ignore
	app.handleError = composeErrorHandler(app) as any

	return Function(
		'data',
		fnLiteral
	)({
		app,
		mapEarlyResponse,
		NotFoundError,
		// @ts-ignore
		reporter: app.reporter,
		requestId
	})
}

export const composeErrorHandler = (app: Elysia<any, any, any, any, any>) => {
	let fnLiteral = `const {
		app: { event: { error: onError, onResponse: res } },
		mapResponse,
		ERROR_CODE
	} = inject

	return ${
		app.event.error.find(isAsync) ? 'async' : ''
	} function(context, error) {
		const { request, set } = context
		`

	for (let i = 0; i < app.event.error.length; i++) {
		const handler = app.event.error[i]

		const response = `${isAsync(handler) ? 'await ' : ''}onError[${i}]({
			request,
			code: error.code ?? error[ERROR_CODE] ?? 'UNKNOWN',
			error,
			set
		})`

		if (hasReturn(handler.toString()))
			fnLiteral += `const r${i} = ${response}; if(r${i} !== undefined) return mapResponse(r${i}, set)\n`
		else fnLiteral += response + '\n'
	}

	fnLiteral += `if(error.constructor.name === "ValidationError") {
		set.status = error.status ?? 400
		return new Response(
			error.message, 
			{ headers: set.headers, status: set.status }
		)
	} else {
		return new Response(error.message, { headers: set.headers, status: error.status ?? 500 })
	}
}`

	return Function(
		'inject',
		fnLiteral
	)({
		app,
		mapResponse,
		ERROR_CODE
	})
}
