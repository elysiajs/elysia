import type { Elysia } from '.'

import { parse as parseQuery } from 'fast-querystring'

import { mapEarlyResponse, mapResponse, mapCompactResponse } from './handler'
import {
	NotFoundError,
	ValidationError,
	InternalServerError,
	ERROR_CODE
} from './error'

import type {
	ElysiaConfig,
	ComposedHandler,
	HTTPMethod,
	LocalHandler,
	RegisteredHook,
	SchemaValidator,
	BeforeRequestHandler
} from './types'
import type { TAnySchema } from '@sinclair/typebox'
import { TypeCheck } from '@sinclair/typebox/compiler'

const _demoHeaders = new Headers()

const findAliases = new RegExp(` (\\w+) = context`, 'g')

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

const composeValidationFactory = (hasErrorHandler: boolean) => ({
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
	composeResponseValidation: (value = 'r') =>
		hasErrorHandler
			? `throw new ValidationError(
'response',
response[c.set.status],
${value}
)`
			: `return new ValidationError(
'response',
response[c.set.status],
${value}
).toResponse(c.set.headers)`
})

export const isFnUse = (keyword: string, fnLiteral: string) => {
	fnLiteral = fnLiteral.trimStart()
	fnLiteral = fnLiteral.replaceAll(/^async /g, '')

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

	// Using object destructuring
	if (argument.charCodeAt(0) === 123) {
		// Since Function already format the code, styling is enforced
		if (argument.includes(keyword)) return true

		return false
	}

	// Match dot notation and named access
	if (
		fnLiteral.match(
			new RegExp(`${argument}(.${keyword}|\\["${keyword}"\\])`)
		)
	) {
		return true
	}

	const aliases = [argument]
	for (const found of fnLiteral.matchAll(findAliases)) aliases.push(found[1])

	const destructuringRegex = new RegExp(`{.*?} = (${aliases.join('|')})`, 'g')

	for (const [params] of fnLiteral.matchAll(destructuringRegex)) {
		if (params.includes(`{ ${keyword}`) || params.includes(`, ${keyword}`))
			return true
	}

	return false
}

export const findElysiaMeta = (
	type: string,
	schema: TAnySchema,
	found: string[] = [],
	parent = ''
) => {
	if (schema.type === 'object') {
		const properties = schema.properties as Record<string, TAnySchema>
		for (const key in properties) {
			const property = properties[key]

			const accessor = !parent ? key : parent + '.' + key

			if (property.type === 'object') {
				findElysiaMeta(type, property, found, accessor)
				continue
			} else if (property.anyOf) {
				for (const prop of property.anyOf) {
					findElysiaMeta(type, prop, found, accessor)
				}

				continue
			}

			if (property.elysiaMeta === type) found.push(accessor)
		}

		if (found.length === 0) return null

		return found
	} else if (schema?.elysiaMeta === type) {
		if (parent) found.push(parent)

		return 'root'
	}

	return null
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
}

const matchFnReturn = /(?:return|=>) \S*\(/g

export const isAsync = (fn: Function) => {
	if (fn.constructor.name === 'AsyncFunction') return true

	const literal = fn.toString()

	if (literal.match(matchFnReturn)) return true

	return false
}

export const composeHandler = ({
	// path,
	method,
	hooks,
	validator,
	handler,
	handleError,
	meta,
	onRequest,
	config
}: {
	path: string
	method: HTTPMethod
	hooks: RegisteredHook<any>
	validator: SchemaValidator
	handler: LocalHandler<any, any>
	handleError: Elysia['handleError']
	meta?: Elysia['meta']
	onRequest: BeforeRequestHandler<any, any>[]
	config: ElysiaConfig<any>
}): ComposedHandler => {
	const hasErrorHandler =
		config.forceErrorEncapsulation ||
		hooks.error.length > 0 ||
		typeof Bun === 'undefined' ||
		hooks.onResponse.length > 0

	const { composeValidation, composeResponseValidation } =
		composeValidationFactory(hasErrorHandler)

	const handleResponse = hooks.onResponse.length
		? `\n;(async () => {${hooks.onResponse
				.map((_, i) => `await res${i}(c)`)
				.join(';')}})();\n`
		: ''

	let fnLiteral = hasErrorHandler ? 'try {\n' : ''

	const lifeCycleLiteral =
		validator || method !== 'GET'
			? [
					handler,
					...hooks.transform,
					...hooks.beforeHandle,
					...hooks.afterHandle
			  ].map((x) => x.toString())
			: []

	const hasBody =
		method !== 'GET' &&
		hooks.type !== 'none' &&
		(!!validator.body ||
			!!hooks.type ||
			lifeCycleLiteral.some((fn) => isFnUse('body', fn)))

	const hasHeaders =
		validator.headers ||
		lifeCycleLiteral.some((fn) => isFnUse('headers', fn))

	if (hasHeaders) {
		// This function is Bun specific
		// @ts-ignore
		fnLiteral += _demoHeaders.toJSON
			? `c.headers = c.request.headers.toJSON()\n`
			: `c.headers = {}
                for (const [key, value] of c.request.headers.entries())
					c.headers[key] = value
				`
	}

	const hasQuery =
		validator.query || lifeCycleLiteral.some((fn) => isFnUse('query', fn))

	if (hasQuery) {
		fnLiteral += `const url = c.request.url

		if(c.qi !== -1) {
			c.query ??= parseQuery(url.substring(c.qi + 1))
		} else {
			c.query ??= {}
		}
		`
	}

	const hasSet =
		lifeCycleLiteral.some((fn) => isFnUse('set', fn)) ||
		onRequest.some((fn) => isFnUse('set', fn.toString()))

	const maybeAsync =
		hasBody ||
		isAsync(handler) ||
		hooks.parse.length > 0 ||
		hooks.afterHandle.some(isAsync) ||
		hooks.beforeHandle.some(isAsync) ||
		hooks.transform.some(isAsync)

	if (hasBody) {
		const type = getUnionedType(validator?.body)

		if (hooks.type || type) {
			if (hooks.type) {
				switch (hooks.type) {
					case 'application/json':
						fnLiteral += `c.body = await c.request.json();`
						break

					case 'text/plain':
						fnLiteral += `c.body = await c.request.text();`
						break

					case 'application/x-www-form-urlencoded':
						fnLiteral += `c.body = parseQuery(await c.request.text());`
						break

					case 'application/octet-stream':
						fnLiteral += `c.body = await c.request.arrayBuffer();`
						break

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
					}`
						break
				}
			} else if (type) {
				// @ts-ignore
				const schema = validator?.body?.schema

				switch (type) {
					case 'object':
						if (schema.elysiaMeta === 'URLEncoded') {
							fnLiteral += `c.body = parseQuery(await c.request.text())`
						} // Accept file which means it's formdata
						else if (
							validator.body!.Code().includes("custom('File")
						)
							fnLiteral += `c.body = {}

							const form = await c.request.formData()
							for (const key of form.keys()) {
								if (c.body[key])
									continue
		
								const value = form.getAll(key)
								if (value.length === 1)
									c.body[key] = value[0]
								else c.body[key] = value
							}`
						else {
							// Since it's an object an not accepting file
							// we can infer that it's JSON
							fnLiteral += `c.body = JSON.parse(await c.request.text())`
						}
						break

					default:
						fnLiteral += 'c.body = await c.request.text()'
						break
				}
			}

			if (hooks.parse.length) fnLiteral += '}}'
		} else {
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

				for (let i = 0; i < hooks.parse.length; i++) {
					const name = `bo${i}`

					if (i !== 0) fnLiteral += `if(!used) {\n`

					fnLiteral += `let ${name} = parse[${i}](c, contentType);`
					fnLiteral += `if(${name} instanceof Promise) ${name} = await ${name};`

					fnLiteral += `
						if(${name} !== undefined) { c.body = ${name}; used = true }\n`

					if (i !== 0) fnLiteral += `}`
				}

				fnLiteral += `if (!used)`
			}

			fnLiteral += `switch (contentType) {
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
			}
		}\n`
		}

		fnLiteral += '\n'
	}

	if (validator.params) {
		// @ts-ignore
		const properties = findElysiaMeta('Numeric', validator.params.schema)

		if (properties) {
			switch (typeof properties) {
				case 'object':
					for (const property of properties)
						fnLiteral += `if(c.params.${property}) c.params.${property} = +c.params.${property};`
					break
			}

			fnLiteral += '\n'
		}
	}

	if (validator.query) {
		// @ts-ignore
		const properties = findElysiaMeta('Numeric', validator.query.schema)

		if (properties) {
			switch (typeof properties) {
				case 'object':
					for (const property of properties)
						fnLiteral += `if(c.query.${property}) c.query.${property} = +c.query.${property};`
					break
			}

			fnLiteral += '\n'
		}
	}

	if (validator.headers) {
		// @ts-ignore
		const properties = findElysiaMeta('Numeric', validator.headers.schema)

		if (properties) {
			switch (typeof properties) {
				case 'object':
					for (const property of properties)
						fnLiteral += `c.headers.${property} = +c.headers.${property};`
					break
			}

			fnLiteral += '\n'
		}
	}

	if (validator.body) {
		// @ts-ignore
		const numericProperties = findElysiaMeta(
			'Numeric',
			validator.body.schema
		)

		if (numericProperties) {
			switch (typeof numericProperties) {
				case 'string':
					fnLiteral += `c.body = +c.body;`
					break

				case 'object':
					for (const property of numericProperties)
						fnLiteral += `c.body.${property} = +c.body.${property};`
					break
			}

			fnLiteral += '\n'
		}

		// @ts-ignore
		const filesProperties = findElysiaMeta('Files', validator.body.schema)
		if (filesProperties) {
			switch (typeof filesProperties) {
				case 'object':
					for (const property of filesProperties)
						fnLiteral += `if(!Array.isArray(c.body.${property})) c.body.${property} = [c.body.${property}];`
					break
			}

			fnLiteral += '\n'
		}
	}

	if (hooks?.transform)
		for (let i = 0; i < hooks.transform.length; i++) {
			const transform = hooks.transform[i]

			// @ts-ignore
			if (transform.$elysia === 'derive')
				fnLiteral += isAsync(hooks.transform[i])
					? `Object.assign(c, await transform[${i}](c));`
					: `Object.assign(c, transform[${i}](c));`
			else
				fnLiteral += isAsync(hooks.transform[i])
					? `await transform[${i}](c);`
					: `transform[${i}](c);`
		}

	if (validator) {
		if (validator.headers)
			fnLiteral += `
                if (headers.Check(c.headers) === false) {
                    ${composeValidation('headers')}
				}
        `

		if (validator.params)
			fnLiteral += `if(params.Check(c.params) === false) { ${composeValidation(
				'params'
			)} }`

		if (validator.query)
			fnLiteral += `if(query.Check(c.query) === false) { ${composeValidation(
				'query'
			)} }`

		if (validator.body)
			fnLiteral += `if(body.Check(c.body) === false) { ${composeValidation(
				'body'
			)} }`
	}

	if (hooks?.beforeHandle)
		for (let i = 0; i < hooks.beforeHandle.length; i++) {
			const name = `be${i}`

			const returning = hasReturn(hooks.beforeHandle[i].toString())

			if (!returning) {
				fnLiteral += isAsync(hooks.beforeHandle[i])
					? `await beforeHandle[${i}](c);\n`
					: `beforeHandle[${i}](c);\n`
			} else {
				fnLiteral += isAsync(hooks.beforeHandle[i])
					? `let ${name} = await beforeHandle[${i}](c);\n`
					: `let ${name} = beforeHandle[${i}](c);\n`

				fnLiteral += `if(${name} !== undefined) {\n`
				if (hooks?.afterHandle) {
					const beName = name
					for (let i = 0; i < hooks.afterHandle.length; i++) {
						const returning = hasReturn(
							hooks.afterHandle[i].toString()
						)

						if (!returning) {
							fnLiteral += isAsync(hooks.afterHandle[i])
								? `await afterHandle[${i}](c, ${beName});\n`
								: `afterHandle[${i}](c, ${beName});\n`
						} else {
							const name = `af${i}`

							fnLiteral += isAsync(hooks.afterHandle[i])
								? `const ${name} = await afterHandle[${i}](c, ${beName});\n`
								: `const ${name} = afterHandle[${i}](c, ${beName});\n`

							fnLiteral += `if(${name} !== undefined) { ${beName} = ${name} }\n`
						}
					}
				}

				if (validator.response)
					fnLiteral += `if(response[c.set.status]?.Check(${name}) === false) { 
						if(!(response instanceof Error))
							${composeResponseValidation(name)}
					}\n`

				fnLiteral += `return mapEarlyResponse(${name}, c.set)}\n`
			}
		}

	if (hooks?.afterHandle.length) {
		fnLiteral += isAsync(handler)
			? `let r = await handler(c);\n`
			: `let r = handler(c);\n`

		for (let i = 0; i < hooks.afterHandle.length; i++) {
			const name = `af${i}`

			const returning = hasReturn(hooks.afterHandle[i].toString())

			if (!returning) {
				fnLiteral += isAsync(hooks.afterHandle[i])
					? `await afterHandle[${i}](c, r)\n`
					: `afterHandle[${i}](c, r)\n`
			} else {
				fnLiteral += isAsync(hooks.afterHandle[i])
					? `let ${name} = await afterHandle[${i}](c, r)\n`
					: `let ${name} = afterHandle[${i}](c, r)\n`

				if (validator.response) {
					fnLiteral += `if(${name} !== undefined) {`
					fnLiteral += `if(response[c.set.status]?.Check(${name}) === false) { 
						if(!(response instanceof Error))
						${composeResponseValidation(name)}
					}\n`
				}

				fnLiteral += `${name} = mapEarlyResponse(${name}, c.set);\n`
				fnLiteral += `if(${name}) return ${name};\n`

				if (validator.response) {
					fnLiteral += '}'
				}
			}
		}

		if (validator.response)
			fnLiteral += `if(response[c.set.status]?.Check(r) === false) { 
				if(!(response instanceof Error))
					${composeResponseValidation()}
			}\n`

		if (hasSet) fnLiteral += `return mapResponse(r, c.set)\n`
		else fnLiteral += `return mapCompactResponse(r)\n`
	} else {
		if (validator.response) {
			fnLiteral += isAsync(handler)
				? `const r = await handler(c);\n`
				: `const r = handler(c);\n`

			fnLiteral += `if(response[c.set.status]?.Check(r) === false) { 
				if(!(response instanceof Error))
					${composeResponseValidation()}
			}\n`

			if (hasSet) fnLiteral += `return mapResponse(r, c.set)\n`
			else fnLiteral += `return mapCompactResponse(r)\n`
		} else {
			const handled = isAsync(handler)
				? 'await handler(c) '
				: 'handler(c)'

			if (hasSet) fnLiteral += `return mapResponse(${handled}, c.set)\n`
			else fnLiteral += `return mapCompactResponse(${handled})\n`
		}
	}

	if (hasErrorHandler) {
		fnLiteral += `
} catch(error) {
	${
		''
		// hasStrictContentType ||
		// // @ts-ignore
		// validator?.body?.schema
		// 	? `if(!c.body) error = parseError`
		// 	: ''
	}

	${maybeAsync ? '' : 'return (async () => {'}
		const set = c.set

		if (!set.status || set.status < 300) set.status = 500

		${
			hooks.error.length
				? `for (let i = 0; i < handleErrors.length; i++) {
				let handled = handleErrors[i]({
					request: c.request,
					error: error,
					set,
					code: error.code ?? error[ERROR_CODE] ?? "UNKNOWN"
				})
				if (handled instanceof Promise) handled = await handled

				const response = mapEarlyResponse(handled, set)
				if (response) return response
			}`
				: ''
		}

		return handleError(c.request, error, set)
	${maybeAsync ? '' : '})()'}
} finally {
	${handleResponse}
}`
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
			response
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
		meta,
		ERROR_CODE
	} = hooks

	${
		hooks.onResponse.length
			? `const ${hooks.onResponse
					.map((x, i) => `res${i} = onResponse[${i}]`)
					.join(',')}`
			: ''
	}

	return ${maybeAsync ? 'async' : ''} function(c) {
		${meta ? 'c["schema"] = meta["schema"]; c["defs"] = meta["defs"];' : ''}
		${fnLiteral}
	}`

	// console.log(fnLiteral)

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
		meta,
		ERROR_CODE
	})
}

export const composeGeneralHandler = (app: Elysia<any, any>) => {
	let decoratorsLiteral = ''

	// @ts-ignore
	for (const key of Object.keys(app.decorators))
		decoratorsLiteral += `,${key}: app.decorators.${key}`

	// @ts-ignore
	const { router, staticRouter } = app

	const findDynamicRoute = `
	const route = find(request.method, path) ${
		router.root.ALL ? '?? find("ALL", path)' : ''
	}
	if (route === null)
		return ${
			app.event.error.length
				? `handleError(
			request,
			notFound,
			ctx.set
		)`
				: `new Response(error404, {
					status: 404
				})`
		}

	ctx.params = route.params

	return route.store(ctx)`

	let switchMap = ``
	for (const [path, { code, all }] of Object.entries(staticRouter.map))
		switchMap += `case '${path}':\nswitch(request.method) {\n${code}\n${
			all ?? `default: ${findDynamicRoute}`
		}}\n\n`

	let fnLiteral = `const {
		app,
		app: { store, router, staticRouter },
		mapEarlyResponse,
		NotFoundError
	} = data

	const notFound = new NotFoundError()

	${app.event.request.length ? `const onRequest = app.event.request` : ''}

	${staticRouter.variables}

	const find = router.find.bind(router)
	const handleError = app.handleError.bind(this)

	${app.event.error.length ? '' : `const error404 = notFound.message.toString()`}

	return function(request) {
	`

	if (app.event.request.length) {
		fnLiteral += `
			const ctx = {
				request,
				store,
				set: {
					headers: {},
					status: 200
				}
				${decoratorsLiteral}
			}

			try {\n`

		for (let i = 0; i < app.event.request.length; i++) {
			const withReturn = hasReturn(app.event.request[i].toString())

			fnLiteral += !withReturn
				? `mapEarlyResponse(onRequest[${i}](ctx), ctx.set);`
				: `const response = mapEarlyResponse(
					onRequest[${i}](ctx),
					ctx.set
				)
				if (response) return response\n`
		}

		fnLiteral += `} catch (error) {
			return handleError(request, error, ctx.set)
		}
		
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

		const ctx = {
			request,
			store,
			qi,
			path,
			set: {
				headers: {},
				status: 200
			}
			${decoratorsLiteral}
		}`
	}

	fnLiteral += `
		switch(path) {
			${switchMap}

			default:
				${findDynamicRoute}
		}
	}`

	// @ts-ignore
	app.handleError = composeErrorHandler(app) as any

	return Function(
		'data',
		fnLiteral
	)({
		app,
		mapEarlyResponse,
		NotFoundError
	})
}

export const composeErrorHandler = (app: Elysia<any, any>) => {
	let fnLiteral = `const {
		app: { event: { error: onError, onResponse: res } },
		mapResponse,
		ERROR_CODE
	} = inject

	return ${
		app.event.error.find(isAsync) ? 'async' : ''
	} function(request, error, set) {`

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
