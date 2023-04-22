import { Elysia } from '.'

import { parse as parseQuery } from 'fast-querystring'

import { mapEarlyResponse, mapResponse } from './handler'
import { createValidationError, mapPathnameAndQueryRegEx } from './utils'
import { mapErrorCode } from './error'

import type {
	HTTPMethod,
	LocalHandler,
	RegisteredHook,
	SchemaValidator
} from './types'

const ASYNC_FN = 'AsyncFunction'
const isAsync = (x: Function) => x.constructor.name === ASYNC_FN

const transpiler = Bun?.Transpiler
	? new Bun.Transpiler({
			minifyWhitespace: true,
			inline: true,
			platform: 'bun',
			allowBunRuntime: true
	  })
	: null

export const composeHandler = ({
	method,
	hooks,
	validator,
	handler,
	handleError
}: {
	method: HTTPMethod
	hooks: RegisteredHook<any>
	validator: SchemaValidator
	handler: LocalHandler<any, any>
	handleError: Elysia['handleError']
}) => {
	let fnLiteral = 'try {\n'

	const maybeAsync =
		method !== 'GET' ||
		handler.constructor.name === ASYNC_FN ||
		hooks.parse.length ||
		hooks.afterHandle.find(isAsync) ||
		hooks.beforeHandle.find(isAsync) ||
		hooks.transform.find(isAsync)

	if (maybeAsync) {
		fnLiteral += `
			let contentType = c.request.headers.get('content-type');

            if (contentType) {
				if(contentType.indexOf(';')) {
					const index = contentType.indexOf(';');
					if (index !== -1) contentType = contentType.slice(0, index);
				}
`

		if (hooks.parse.length) {
			fnLiteral += `used = false\n`

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
				c.body = await c.request.json()
				break

			case 'text/plain':
				c.body = await c.request.text()
				break

			case 'application/x-www-form-urlencoded':
				c.body = await c.request.text().then(parseQuery)
				break

			case 'multipart/form-data':
				c.body = {}

				await c.request.formData().then((form) => {
					for (const key of form.keys()) {
						if (c.body[key])
							continue

						const value = form.getAll(key)
						if (value.length === 1)
							c.body[key] = value[0]
						else c.body[key] = value
					}
				})

				break
		`

		fnLiteral += `}}\n`
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
                const _header = {}
                for (const key of c.request.headers.keys())
                    _header[key] = c.request.headers.get(key)

                if (headers.Check(_header) === false) {
                    throw createValidationError(
                        'header',
                        headers,
                        _header
                    )
				}
        `

		if (validator.params)
			fnLiteral += `if(params.Check(c.params) === false) { throw createValidationError('params', params, c.params) }`

		if (validator.query)
			fnLiteral += `if(query.Check(c.query) === false) { throw createValidationError('params', query, c.query) }`

		if (validator.body)
			fnLiteral += `if(body.Check(c.body) === false) { throw createValidationError('body', body, c.body) }`
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
				fnLiteral += `if(response[c.set.status]?.Check(${name}) === false) { throw createValidationError('response', response[c.set.status], ${name}) }\n`

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
				fnLiteral += `if(response[c.set.status]?.Check(${name}) === false) { throw createValidationError('response', response[c.set.status], ${name}) }\n`

				fnLiteral += `${name} = mapEarlyResponse(${name}, c.set)\n`

				fnLiteral += `if(${name}) return ${name};\n`
			} else fnLiteral += `if(${name}) return ${name};\n`
		}

		if (validator.response)
			fnLiteral += `if(response[c.set.status]?.Check(r) === false) { throw createValidationError('response', response[c.set.status], r) }\n`

		fnLiteral += `return mapResponse(r, c.set);\n`
	} else {
		if (validator.response) {
			fnLiteral +=
				handler.constructor.name === ASYNC_FN
					? `const r = await handler(c);\n`
					: `const r = handler(c);\n`

			fnLiteral += `if(response[c.set.status]?.Check(r) === false) { throw createValidationError('response', response[c.set.status], r) }\n`
			fnLiteral += `return mapResponse(r, c.set);`
		} else
			fnLiteral +=
				handler.constructor.name === ASYNC_FN
					? `return mapResponse(await handler(c), c.set);`
					: `return mapResponse(handler(c), c.set);`
	}

	fnLiteral += `
} catch(error) {
	${maybeAsync ? '' : 'return (async () => {'}
		const set = c.set

		if (!set.status || set.status < 300) set.status = 500

		if (handleErrors) {
			const code = mapErrorCode(error.message)

			for (let i = 0; i < handleErrors.length; i++) {
				let handled = handleErrors[i]({
					request: c.request,
					error,
					set,
					code
				})
				if (handled instanceof Promise) handled = await handled

				const response = mapEarlyResponse(handled, set)
				if (response) return response
			}
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
			createValidationError,
			mapResponse,
			mapEarlyResponse,
			mapErrorCode,
			parseQuery
		}
	} = hooks

	return ${maybeAsync ? 'async' : ''} function(c) {${fnLiteral}}`

	if (transpiler) fnLiteral = transpiler.transformSync(fnLiteral)

	const createHandler = Function('hooks', fnLiteral)

	return createHandler({
		handler,
		hooks,
		validator,
		handleError,
		utils: {
			createValidationError,
			mapResponse,
			mapEarlyResponse,
			mapErrorCode,
			parseQuery
		}
	})
}

export const composeGeneralHandler = (app: Elysia<any>) => {
	// @ts-ignore
	const totalDecorators = Object.keys(app.decorators).length
	const hasDecorators = totalDecorators > 0

	let fnLiteral = `const { 
		app,
		parseQuery,
		mapPathnameAndQueryRegEx: map,
		mapEarlyResponse
	} = data

	// staticRouter
	const _static = app._s

	// Raikiri
	const router = app.router

	const ctx = {
		...app.decorators,
		set: {
			headers: {},
			status: 200
		},
		params: {},
		query: {}
	}

	return function(request) {
		${
			hasDecorators
				? `
		ctx.set = {
			headers: {},
			status: 200
		}
		
		ctx.request = request
		`
				: `
		const ctx = {
			set: {
				headers: {},
				status: 200
			},
				params: {},
				query: {}
			},
			request
		}`
		}

		${
			app.event.request.length
				? `			
				try {
					for (let i = 0; i < app.event.request.length; i++) {
						const response = mapEarlyResponse(
							app.event.request[i](ctx),
							ctx.set
						)
						if (response) return response
					}
				} catch (error) {
					return app.handleError(request, error, ctx.set)
				}`
				: ''
		}

		const fracture = map.exec(request.url)
		if (fracture[2]) ctx.query = parseQuery(fracture[2])
		${hasDecorators ? `else ctx.query = {}` : ''}

		const handle = _static.get(request.method + fracture[1])
		if (handle) {
			${hasDecorators ? `ctx.params = {}` : ''}

			return handle(ctx)
		} else {
			const route = router._m(request.method, fracture[1]) ?? router._m('ALL', fracture[1])

			if (!route)
				return app.handleError(
					request,
					new Error('NOT_FOUND'),
					ctx.set
				)

			ctx.params = route.params

			return route.store(ctx)
		}
	}`

	if (transpiler) fnLiteral = transpiler.transformSync(fnLiteral)

	return Function(
		'data',
		fnLiteral
	)({
		app,
		parseQuery,
		mapPathnameAndQueryRegEx,
		mapEarlyResponse
	})
}
