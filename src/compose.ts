import type { Elysia } from '.'

import { parse as parseQuery } from 'fast-querystring'

import { mapEarlyResponse, mapResponse } from './handler'
import { SCHEMA, DEFS } from './utils'
import {
	ParseError,
	NotFoundError,
	ValidationError,
	InternalServerError
} from './error'

import type {
	ComposedHandler,
	HTTPMethod,
	LocalHandler,
	RegisteredHook,
	SchemaValidator
} from './types'

const ASYNC_FN = 'AsyncFunction'
const isAsync = (x: Function) => x.constructor.name === ASYNC_FN

const _demoHeaders = new Headers()

const findAliases = new RegExp(` (\\w+) = context`, 'g')

export const isFnUse = (keyword: string, fnLiteral: string) => {
	const argument = fnLiteral.slice(
		fnLiteral.indexOf('(') + 1,
		fnLiteral.indexOf(')')
	)

	if (argument === '') return false

	// Using object destructuring
	if (argument.charCodeAt(0) === 123) {
		// Since Function already format the code, styling is confirmed
		if (
			argument.includes(`{ ${keyword}`) ||
			argument.includes(`, ${keyword}`)
		)
			return true

		return false
	}

	// Match dot notation and named access
	if (fnLiteral.match(new RegExp(`${argument}(.${keyword}|\\["${keyword}"\\])`))) {
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

export const composeHandler = ({
	path,
	method,
	hooks,
	validator,
	handler,
	handleError,
	meta
}: {
	path: string
	method: HTTPMethod
	hooks: RegisteredHook<any>
	validator: SchemaValidator
	handler: LocalHandler<any, any>
	handleError: Elysia['handleError']
	meta?: Elysia['meta']
}): ComposedHandler => {
	let fnLiteral = 'try {\n'

	const hasStrictContentType = typeof hooks.type === 'string'

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
		(validator.body ||
			hasStrictContentType ||
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
                for (const key of c.request.headers.keys())
					h[key] = c.request.headers.get(key)

                if (headers.Check(h) === false) {
                    throw throw new ValidationError(
                        'header',
                        headers,
                        h
                    )
				}
			`
	}

	const hasQuery =
		validator.query || lifeCycleLiteral.some((fn) => isFnUse('query', fn))

	if (hasQuery) {
		fnLiteral += `const url = c.request.url

		if(url.charCodeAt(c.query) === 63 || (c.query = url.indexOf("?", ${
			11 + path.length
		})) !== -1) {
			c.query = parseQuery(url.substring(c.query + 1))
		} else {
			c.query = {}
		}
		`
	}

	const maybeAsync =
		hasBody ||
		handler.constructor.name === ASYNC_FN ||
		hooks.parse.length ||
		hooks.afterHandle.find(isAsync) ||
		hooks.beforeHandle.find(isAsync) ||
		hooks.transform.find(isAsync)

	if (hasBody) {
		// @ts-ignore
		let schema = validator?.body?.schema

		if (schema && 'anyOf' in schema) {
			let foundDifference = false
			const model = schema.anyOf[0].type

			for (const validator of schema.anyOf as { type: string }[]) {
				if (validator.type !== model) {
					foundDifference = true
					break
				}
			}

			if (foundDifference) {
				schema = undefined
			}
		}

		if (hasStrictContentType || schema) {
			if (schema) {
				switch (schema.type) {
					case 'object':
						if (schema.elysiaMeta === 'URLEncoded') {
							fnLiteral += `c.body = parseQuery(await c.request.text())`
						} // Accept file which means it's formdata
						else if (
							validator.body!.Code().includes("custom('File")
						)
							fnLiteral += `c.body = {}

				await c.request.formData().then((form) => {
					for (const key of form.keys()) {
						if (c.body[key])
							continue

						const value = form.getAll(key)
						if (value.length === 1)
							c.body[key] = value[0]
						else c.body[key] = value
					}
				})`
						else {
							// Since it's an object an not accepting file
							// we can infer that it's JSON
							fnLiteral += `c.body = JSON.parse(await c.request.text())`
						}
						break

					case 'string':
						fnLiteral += 'c.body = await c.request.text()'
						break
				}
			} else
				switch (hooks.type) {
					case 'application/json':
						fnLiteral += `c.body = JSON.parse(await c.request.text());`
						break

					case 'text/plain':
						fnLiteral += `c.body = await c.request.text();`
						break

					case 'application/x-www-form-urlencoded':
						fnLiteral += `c.body = parseQuery(await c.request.text());`
						break

					case 'multipart/form-data':
						fnLiteral += `c.body = {}

					for (const key of (await c.request.formData()).keys()) {
						if (c.body[key])
							continue

						const value = form.getAll(key)
						if (value.length === 1)
							c.body[key] = value[0]
						else c.body[key] = value
					}`
						break
				}
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

					fnLiteral += `if(!c.request.bodyUsed) { 
					let ${name} = parse[${i}](c, contentType);
					if(${name} instanceof Promise) ${name} = await ${name}
					if(${name} !== undefined) { c.body = ${name}; used = true }
				}`
				}

				fnLiteral += `if (!used)`
			}

			fnLiteral += `switch (contentType) {
			case 'application/json':
				c.body = JSON.parse(await c.request.text())
				break

			case 'text/plain':
				c.body = await c.request.text()
				break

			case 'application/x-www-form-urlencoded':
				c.body = parseQuery(await c.request.text())
				break

			case 'multipart/form-data':
				c.body = {}

				for (const key of (await c.request.formData()).keys()) {
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

	if (hooks?.transform)
		for (let i = 0; i < hooks.transform.length; i++) {
			fnLiteral +=
				hooks.transform[i].constructor.name === ASYNC_FN
					? `await transform[${i}](c);`
					: `transform[${i}](c);`
		}

	if (validator) {
		if (validator.headers)
			fnLiteral += `
                if (headers.Check(c.headers) === false) {
                    throw new ValidationError(
                        'header',
                        headers,
                        c.headers
                    )
				}
        `

		if (validator.params)
			fnLiteral += `if(params.Check(c.params) === false) { throw new ValidationError('params', params, c.params) }`

		if (validator.query)
			fnLiteral += `if(query.Check(c.query) === false) { throw new ValidationError('query', query, c.query) }`

		if (validator.body)
			fnLiteral += `if(body.Check(c.body) === false) { throw new ValidationError('body', body, c.body) }`
	}

	if (hooks?.beforeHandle)
		for (let i = 0; i < hooks.beforeHandle.length; i++) {
			const name = `be${i}`

			fnLiteral +=
				hooks.beforeHandle[i].constructor.name === ASYNC_FN
					? `let ${name} = await beforeHandle[${i}](c);\n`
					: `let ${name} = beforeHandle[${i}](c);\n`

			fnLiteral += `if(${name} !== undefined) {\n`
			if (hooks?.afterHandle) {
				const beName = name
				for (let i = 0; i < hooks.afterHandle.length; i++) {
					const name = `af${i}`

					fnLiteral +=
						hooks.afterHandle[i].constructor.name === ASYNC_FN
							? `const ${name} = await afterHandle[${i}](c, ${beName});\n`
							: `const ${name} = afterHandle[${i}](c, ${beName});\n`

					fnLiteral += `if(${name} !== undefined) { ${beName} = ${name} }\n`
				}
			}

			if (validator.response)
				fnLiteral += `if(response[c.set.status]?.Check(${name}) === false) { throw new ValidationError('response', response[c.set.status], ${name}) }\n`

			fnLiteral += `return mapEarlyResponse(${name}, c.set)}\n`
		}

	if (hooks?.afterHandle.length) {
		fnLiteral +=
			handler.constructor.name === ASYNC_FN
				? `let r = await handler(c);\n`
				: `let r = handler(c);\n`

		for (let i = 0; i < hooks.afterHandle.length; i++) {
			const name = `af${i}`

			fnLiteral +=
				hooks.afterHandle[i].constructor.name === ASYNC_FN
					? `let ${name} = await afterHandle[${i}](c, r)\n`
					: `let ${name} = afterHandle[${i}](c, r)\n`

			if (validator.response) {
				fnLiteral += `if(response[c.set.status]?.Check(${name}) === false) { throw new ValidationError('response', response[c.set.status], ${name}) }\n`

				fnLiteral += `${name} = mapEarlyResponse(${name}, c.set)\n`

				fnLiteral += `if(${name}) return ${name};\n`
			} else fnLiteral += `if(${name}) return ${name};\n`
		}

		if (validator.response)
			fnLiteral += `if(response[c.set.status]?.Check(r) === false) { throw new ValidationError('response', response[c.set.status], r) }\n`

		fnLiteral += `return mapResponse(r, c.set);\n`
	} else {
		if (validator.response) {
			fnLiteral +=
				handler.constructor.name === ASYNC_FN
					? `const r = await handler(c);\n`
					: `const r = handler(c);\n`

			fnLiteral += `if(response[c.set.status]?.Check(r) === false) { throw new ValidationError('response', response[c.set.status], r) }\n`
			fnLiteral += `return mapResponse(r, c.set);`
		} else
			fnLiteral +=
				handler.constructor.name === ASYNC_FN
					? `return mapResponse(await handler(c), c.set);`
					: `return mapResponse(handler(c), c.set);`
	}

	fnLiteral += `
} catch(error) {
	${
		hasStrictContentType ||
		// @ts-ignore
		validator?.body?.schema
			? `if(!c.body) error = parseError`
			: ''
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
					code: error.code ?? "UNKNOWN"
				})
				if (handled instanceof Promise) handled = await handled

				const response = mapEarlyResponse(handled, set)
				if (response) return response
			}`
				: ''
		}

		return handleError(c.request, error, set)
	${maybeAsync ? '' : '})()'}
}`

	fnLiteral = `const { 
		handler,
		handleError,
		hooks: {
			transform,
			beforeHandle,
			afterHandle,
			parse,
			error: handleErrors
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
			mapEarlyResponse,
			mapErrorCode,
			parseQuery
		},
		error: {
			ParseError,
			NotFoundError,
			ValidationError,
			InternalServerError
		},
		${
			meta
				? `
			meta,
			SCHEMA,
			DEFS,`
				: ''
		}
	} = hooks

	const parseError = new ParseError()

	return ${maybeAsync ? 'async' : ''} function(c) {
		${meta ? 'c[SCHEMA] = meta[SCHEMA]; c[DEFS] = meta[DEFS];' : ''}
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
			mapEarlyResponse,
			parseQuery
		},
		error: {
			ParseError,
			NotFoundError,
			ValidationError,
			InternalServerError
		},
		meta,
		SCHEMA: meta ? SCHEMA : undefined,
		DEFS: meta ? DEFS : undefined
	})
}

export const composeGeneralHandler = (app: Elysia<any>) => {
	let decoratorsLiteral = ''

	// @ts-ignore
	for (const key of Object.keys(app.decorators))
		decoratorsLiteral += `,${key}: app.decorators.${key}`

	// @ts-ignore
	const staticRouter = app.staticRouter

	let switchMap = ``
	for (const [path, code] of Object.entries(staticRouter.map))
		switchMap += `case '${path}':\nswitch(method) {\n${code}}\n\n`

	const fnLiteral = `const { 
		app,
		app: { store, router, staticRouter },
		${app.event.request.length ? 'mapEarlyResponse,' : ''}
		NotFoundError
	} = data

	const getPath = /\\/[^?#]+/g
	const notFound = new NotFoundError()

	${
		app.event.request.length
			? `const onRequest = app.event.request
			   const requestLength = app.event.request.length`
			: ''
	}

	${staticRouter.variables}

	return function(request) {
		const ctx = {
			request,
			store,
			set: {
				headers: {},
				status: 200
			}
			${decoratorsLiteral}
		}

		${
			app.event.request.length
				? `			
				try {
					for (let i = 0; i < requestLength; i++) {
						const response = mapEarlyResponse(
							onRequest[i](ctx),
							ctx.set
						)
						if (response) return response
					}
				} catch (error) {
					return app.handleError(request, error, ctx.set)
				}`
				: ''
		}

		getPath.lastIndex = 11
		const { url, method } = request,
			path = getPath.exec(url)?.[0] ?? '/'

		ctx.query = getPath.lastIndex

		switch(path) {
			${switchMap}
		}
	
		const route = router.find(method, path)
		if (route === null)
			return app.handleError(
				request,
				notFound,
				ctx.set
			)

		ctx.params = route.params

		return route.store(ctx)
	}`

	// console.log(fnLiteral)

	return Function(
		'data',
		fnLiteral
	)({
		app,
		mapEarlyResponse,
		NotFoundError
	})
}
