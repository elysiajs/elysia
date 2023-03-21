import { parse as parseQuery } from 'fast-querystring'
import { deserialize as superjsonDeserialize } from 'superjson'

import { createValidationError } from './utils'
import { mapEarlyResponse, mapResponse } from './handler'

import type { Elysia } from '.'
import type {
	HTTPMethod,
	LocalHandler,
	RegisteredHook,
	SchemaValidator
} from './types'
import { mapErrorCode } from './error'

const ASYNC_FN = 'AsyncFunction'
const isAsync = (x: Function) => x.constructor.name === ASYNC_FN

const handleErrorLiteral = (maybeAsync = false) => `
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
`

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
	let fnLiteral = ''

	const maybeAsync = !!(
		handler.constructor.name === ASYNC_FN ||
		hooks.parse.length ||
		hooks.afterHandle.find(isAsync) ||
		hooks.beforeHandle.find(isAsync) ||
		hooks.transform.find(isAsync)
	)

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
        `.replace(/\t/g, '')

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
					? `const ${name} = mapEarlyResponse(await afterHandle[${i}](c, r), c.set);\n`
					: `const ${name} = mapEarlyResponse(afterHandle[${i}](c, r), c.set);\n`

			fnLiteral += `if(${name}) return ${name};\n`
		}

		fnLiteral += `return mapResponse(r, c.set);\n`
	} else {
		fnLiteral +=
			handler.constructor.name === ASYNC_FN
				? `return mapResponse(await handler(c), c.set);`
				: `return mapResponse(handler(c), c.set);`
	}

	if (method !== 'GET') {
		let bodyLiteral = `let contentType = c.request.headers.get('content-type');

		if (contentType) {
			const index = contentType.indexOf(';');
			if (index !== -1) contentType = contentType.slice(0, index);
`

		if (hooks.parse.length) {
			bodyLiteral += `used = false\n`

			for (let i = 0; i < hooks.parse.length; i++) {
				const name = `bo${i}`

				bodyLiteral += `if(!c.request.bodyUsed) { 
					let ${name} = parse[${i}](c, contentType);
					if(${name} instanceof Promise) ${name} = await ${name}
					if(${name} !== undefined) { c.body = ${name}; used = true }
				}`
			}

			bodyLiteral += `if (!used)`
		}

		const prefix = maybeAsync ? 'async ' : ''

		bodyLiteral += `switch (contentType) {
			case 'application/json':
				return c.request.json().then(${prefix} (_body) => {
					c.body = _body

					${fnLiteral}
				}).catch(${prefix} (error) => {
					${handleErrorLiteral()}
				})

			case 'text/plain':
				return c.request.text().then(${prefix} (_body) => {
					c.body = _body

					${fnLiteral}
				}).catch(${prefix} (error) => {
					${handleErrorLiteral()}
				})

			case 'application/x-www-form-urlencoded':
				return c.request.text().then(${prefix} (_body) => {
					c.body = parseQuery(_body)

					${fnLiteral}
				}).catch(${prefix} (error) => {
					${handleErrorLiteral()}
				})

			case 'multipart/form-data':
				return c.request.formData().then(${prefix} (_form) => {
					c.body = {}

					for (const key of _form.keys()) {
						if (c.body[key])
							continue

						const value = _form.getAll(key)
						if (value.length === 1)
							c.body[key] = value[0]
						else c.body[key] = value
					}

					${fnLiteral}
				})
				.catch(${prefix} (error) => {
					${handleErrorLiteral()}
				})

			case 'elysia/fn':
				return c.request.json().then(${prefix} (_body) => {
					c.body = superjsonDeserialize(_body)

					${fnLiteral}
				}).catch(${prefix} (error) => {
					${handleErrorLiteral()}
				})
			}
		}

		${fnLiteral}
		`.replace(/\t/g, '')

		fnLiteral = bodyLiteral
	}

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
			superjsonDeserialize,
			mapResponse,
			mapEarlyResponse,
			mapErrorCode,
			parseQuery
		}
	} = hooks

	return ${maybeAsync ? 'async' : ''} function(c) {
		try {
			${fnLiteral}
		} catch(error) {
			${handleErrorLiteral(maybeAsync)}
		}
	}`.replace(/\t/g, '')

	const createHandler = Function('hooks', fnLiteral)

	return createHandler({
		handler,
		hooks,
		validator,
		handleError,
		utils: {
			createValidationError,
			superjsonDeserialize,
			mapResponse,
			mapEarlyResponse,
			mapErrorCode,
			parseQuery
		}
	})
}
