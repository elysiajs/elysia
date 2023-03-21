import { parse as parseQuery } from 'fast-querystring'
import { deserialize as superjsonDeserialize } from 'superjson'

import { createValidationError } from './utils'
import { mapEarlyResponse, mapResponse } from './handler'

import { Elysia } from '.'
import type {
	HTTPMethod,
	LocalHandler,
	RegisteredHook,
	SchemaValidator
} from './types'
import { mapErrorCode } from './error'
import { TypeCheck } from '@sinclair/typebox/compiler'

const ASYNC_FN = 'AsyncFunction'
const isAsync = (x: Function) => x.constructor.name === ASYNC_FN

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
				const index = contentType.indexOf(';');
                if (index !== -1) contentType = contentType.slice(0, index);
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
				c.body = parseQuery(await c.request.text())
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

			case 'elysia/fn':
				c.body = superjsonDeserialize(
					await c.request.json()
				)
				break
		`.replace(/\t/g, '')

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

                if (headersCheck(_header) === false) {
                    throw createValidationError(
                        'header',
                        headers,
                        _header
                    )
				}
        `.replace(/\t/g, '')

		if (validator.params)
			fnLiteral += `if(paramsCheck(c.params) === false) { throw createValidationError('params', params, c.params) }`

		if (validator.query)
			fnLiteral += `if(queryCheck(c.query) === false) { throw createValidationError('params', query, c.query) }`

		if (validator.body)
			fnLiteral += `if(bodyCheck(c.body) === false) { throw createValidationError('body', body, c.body) }`
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
		validatorAot: {
			bodyCheck,
			headersCheck,
			paramsCheck,
			queryCheck,
			responseCheck,
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

	return ${maybeAsync ? 'async' : ''} function(c) {${fnLiteral}}`.replace(
		/\t/g,
		''
	)

	const createHandler = Function('hooks', fnLiteral)

	return createHandler({
		handler,
		hooks,
		validator,
		validatorAot: {
			bodyCheck: createTypeboxAot(validator.body),
			headersCheck: createTypeboxAot(validator.headers),
			paramsCheck: createTypeboxAot(validator.params),
			queryCheck: createTypeboxAot(validator.query),
			responseCheck: createTypeboxAot(validator.response)
		},
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

const createTypeboxAot = (a: TypeCheck<any> | undefined) => {
	if (!a) return

	const fnLiteral = a.Code()

	if (fnLiteral.includes('custom(')) return (param: any) => a.Check(param)
	return new Function(a.Code())()
}
