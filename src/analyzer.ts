/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-constant-condition */
import type { Handler, LifeCycleStore, TraceHandler } from './types'

namespace Sucrose {
	export interface Reference {
		queries: string[]
		query: boolean
		headers: boolean
		body: boolean
		cookie: boolean
		set: boolean
	}

	export interface LifeCycle extends LifeCycleStore {
		handler: Handler
	}

	export interface TraceInference {
		request: boolean
		parse: boolean
		transform: boolean
		handle: boolean
		beforeHandle: boolean
		afterHandle: boolean
		error: boolean
		context: boolean
		store: boolean
		set: boolean
	}
}

/**
 * Separate stringified function body and paramter
 *
 * @example
 * ```typescript
 * separateFunction('async ({ hello }) => { return hello }') // => ['({ hello })', '{ return hello }']
 * ```
 */
export const separateFunction = (code: string): [string, string] => {
	if (code.startsWith('async')) code = code.slice(6)

	let index = -1

	// Starts with '(', is an arrow function
	if (code.charCodeAt(0) === 40) {
		// ? arrow function
		index = code.indexOf(') => {\n')
		if (index !== -1) return [code.slice(1, index), code.slice(index + 5)]

		// ? Sudden return
		index = code.indexOf(') => ')
		if (index !== -1) return [code.slice(1, index), code.slice(index + 5)]
	}

	// Using function keyword
	if (code.startsWith('function')) {
		index = code.indexOf('(')
		const end = code.indexOf(')')

		return [code.slice(index + 1, end), code.slice(end + 2)]
	}

	// Probably Declare as method
	const start = code.indexOf("(")

	if (start !== -1) {
		const [parameter, body] = code.split("\n", 2)
		const end = parameter.lastIndexOf(")") + 1

		return [parameter.slice(start, end), "{" + body]
	}

	// Unknown case
	return code.split('\n', 2) as [string, string]
}

/**
 * Get range between bracket pair
 *
 * @example
 * ```typescript
 * bracketPairRange('hello: { world: { a } }, elysia') // [6, 20]
 * ```
 */
const bracketPairRange = (parameter: string): [number, number] => {
	const start = parameter.indexOf('{')
	if (start === -1) return [-1, 0]

	let end = start + 1
	let deep = 1

	for (; end < parameter.length; end++) {
		const char = parameter.charCodeAt(end)

		// Open bracket
		if (char === 123) deep++
		// Close bracket
		else if (char === 125) deep--

		if (deep === 0) break
	}

	return [start, end + 1]
}

/**
 * Similar to `bracketPairRange` but in reverse order
 * Get range between bracket pair from end to beginning
 *
 * @example
 * ```typescript
 * bracketPairRange('hello: { world: { a } }, elysia') // [6, 20]
 * ```
 */

const bracketPairRangeReverse = (parameter: string): [number, number] => {
	const end = parameter.lastIndexOf('}')
	if (end === -1) return [-1, 0]

	let start = end - 1
	let deep = 1

	for (; start >= 0; start--) {
		const char = parameter.charCodeAt(start)

		// Open bracket
		if (char === 125) deep++
		// Close bracket
		else if (char === 123) deep--

		if (deep === 0) break
	}

	return [start, end + 1]
}

/**
 * Retrieve only root paramters of a function
 *
 * @example
 * ```typescript
 * retrieveRootParameters('({ hello: { world: { a } }, elysia })') // => ['hello', 'elysia']
 * ```
 */
export const retrieveRootParamters = (parameter: string) => {
	// Remove () and {}
	if (parameter.charCodeAt(0) === 40) parameter = parameter.slice(1, -1)
	// Using 2 because of the space
	if (parameter.charCodeAt(0) === 123) parameter = parameter.slice(2, -2)

	while (true) {
		const [start, end] = bracketPairRange(parameter)
		if (start === -1) break

		parameter = parameter.slice(0, start - 2) + parameter.slice(end + 1)
	}

	return parameter
}

/**
 * Find reference from parameter
 *
 * @param parameter stringified parameter
 */
export const findParameterReference = (
	parameter: string,
	reference: Sucrose.Reference
) => {
	const root = retrieveRootParamters(parameter)

	if (!reference.query && root.includes('query')) reference.query = true
	if (!reference.headers && root.includes('headers')) reference.headers = true
	if (!reference.body && root.includes('body')) reference.body = true
	if (!reference.cookie && root.includes('cookie')) reference.cookie = true
	if (!reference.set && root.includes('set')) reference.set = true

	return root
}

/**
 * Find reference from parameter
 *
 * @param parameter stringified parameter
 */
export const findTraceParameterReference = (
	parameter: string,
	reference: Sucrose.TraceInference
) => {
	const root = retrieveRootParamters(parameter)

	if (!reference.request && root.includes('request')) reference.request = true
	if (!reference.parse && root.includes('parse')) reference.parse = true
	if (!reference.transform && root.includes('transform'))
		reference.transform = true
	if (!reference.handle && root.includes('handle')) reference.handle = true
	if (!reference.beforeHandle && root.includes('beforeHandle'))
		reference.beforeHandle = true
	if (!reference.afterHandle && root.includes('afterHandle'))
		reference.afterHandle = true
	if (!reference.error && root.includes('error')) reference.error = true
	if (!reference.context && root.includes('context')) reference.context = true
	if (!reference.store && root.includes('store')) reference.store = true
	if (!reference.set && root.includes('set')) reference.set = true

	return root
}

/**
 * Find alias of variable from function body
 *
 * @example
 * ```typescript
 * findAlias('body', '{ const a = body, b = body }') // => ['a', 'b']
 * ```
 */
export const findAlias = (type: string, body: string, depth = 0) => {
	if (depth > 5) return []

	const aliases: string[] = []

	let content = body

	while (true) {
		let index = content.indexOf(' = ' + type + '\n')
		if (index === -1) index = content.indexOf(' = ' + type + ',')
		if (index === -1) index = content.indexOf(' = ' + type + ' ')
		if (index === -1) index = content.indexOf(' = ' + type + ';')

		if (index === -1) break

		const part = content.slice(0, index)
		const variable = part.slice(part.lastIndexOf(' ') + 1)

		// Variable is using object destructuring, find the bracket pair
		if (variable === '}') {
			const [start, end] = bracketPairRangeReverse(part)
			aliases.push(content.slice(start, end))

			content = content.slice(index + 3 + type.length)
			continue
		}

		aliases.push(variable)
		content = content.slice(index + 3 + type.length)
	}

	for (const alias of aliases) {
		if (alias.charCodeAt(0) === 123) continue

		const deepAlias = findAlias(alias, body)
		if (deepAlias.length > 0) aliases.push(...deepAlias)
	}

	return aliases
}

export const extractMainParameter = (parameter: string) => {
	const hasComma = parameter.includes(',')
	if (!hasComma) {
		// This happens when spread operator is used as the only parameter
		if (parameter.includes('...'))
			return parameter.slice(parameter.indexOf('...') + 3)

		return parameter
	}

	const spreadIndex = parameter.indexOf('...')
	if (spreadIndex === -1) return

	// Spread parameter is always the last parameter, no need for further checking
	return parameter.slice(spreadIndex + 3).trimEnd()
}

const b = findAlias(
	'body',
	`{ const a = body, { hello } = a

return 'hi'
}`
)

/**
 * Analyze if context is mentioned in body
 */
export const inferBodyReference = (
	code: string,
	aliases: string[],
	reference: Sucrose.Reference
) => {
	const access = (type: string, alias: string) =>
		code.includes(alias + '.' + type) ||
		code.includes(alias + '["' + type + '"]') ||
		code.includes(alias + "['" + type + "']")

	for (let alias of aliases) {
		if (alias.charCodeAt(0) === 123) {
			alias = retrieveRootParamters(alias)

			if (!reference.query && alias.includes('query'))
				reference.query = true

			if (!reference.headers && alias.includes('headers'))
				reference.headers = true

			if (!reference.body && alias.includes('body')) reference.body = true

			if (!reference.cookie && alias.includes('cookie'))
				reference.cookie = true

			if (!reference.set && alias.includes('set')) reference.set = true

			continue
		}

		// ! Function is passed to another function, assume as all is accessed
		if (code.includes('(' + alias + ')')) {
			reference.query = true
			reference.headers = true
			reference.body = true
			reference.cookie = true
			reference.set = true

			break
		}

		if (!reference.query && access('query', alias)) reference.query = true

		if (!reference.headers && access('headers', alias))
			reference.headers = true

		if (!reference.body && access('body', alias)) reference.body = true

		if (!reference.cookie && access('cookie', alias))
			reference.cookie = true

		if (!reference.set && access('set', alias)) reference.set = true

		if (
			reference.query &&
			reference.headers &&
			reference.body &&
			reference.cookie &&
			reference.set
		)
			break
	}

	return aliases
}

export const removeDefaultParameter = (parameter: string) => {
	while (true) {
		const index = parameter.indexOf('=')
		if (index === -1) break

		const commaIndex = parameter.indexOf(',', index)
		const bracketIndex = parameter.indexOf('}', index)

		const end = commaIndex < bracketIndex ? commaIndex : bracketIndex

		parameter = parameter.slice(0, index - 1) + parameter.slice(end)
	}

	return parameter
}

/**
 * Analyze if context is mentioned in body
 */
export const inferTraceBodyReference = (
	code: string,
	aliases: string[],
	reference: Sucrose.TraceInference
) => {
	const access = (type: string, alias: string) =>
		code.includes(type + '.' + alias) ||
		code.includes(type + '["' + alias + '"]') ||
		code.includes(type + "['" + alias + "']")

	for (let alias of aliases) {
		if (alias.charCodeAt(0) === 123) {
			alias = retrieveRootParamters(alias)

			if (!reference.request && alias.includes('request'))
			reference.request = true

			if (!reference.parse && alias.includes('parse'))
				reference.parse = true

			if (!reference.transform && alias.includes('transform'))
				reference.transform = true

			if (!reference.handle && alias.includes('handle'))
				reference.handle = true

			if (!reference.beforeHandle && alias.includes('beforeHandle'))
				reference.beforeHandle = true

			if (!reference.afterHandle && alias.includes('afterHandle'))
				reference.afterHandle = true

			if (!reference.error && alias.includes('error'))
				reference.error = true

			if (!reference.context && alias.includes('context'))
				reference.context = true

			if (!reference.store && alias.includes('store'))
				reference.store = true

			if (!reference.set && alias.includes('set')) reference.set = true

			continue
		}

		// ! Function is passed to another function, assume as all is accessed
		if (code.includes('(' + alias + ')')) {
			reference.request = true
			reference.parse = true
			reference.transform = true
			reference.handle = true
			reference.beforeHandle = true
			reference.afterHandle = true
			reference.error = true
			reference.context = true
			reference.store = true
			reference.set = true

			break
		}

		if (!reference.request && access('request', alias)) reference.request = true

		if (!reference.parse && access('parse', alias)) reference.parse = true

		if (!reference.transform && access('transform', alias))
			reference.transform = true

		if (!reference.handle && access('handle', alias))
			reference.handle = true

		if (!reference.beforeHandle && access('beforeHandle', alias))
			reference.beforeHandle = true

		if (!reference.afterHandle && access('afterHandle', alias))
			reference.afterHandle = true

		if (!reference.error && access('error', alias)) reference.error = true

		if (!reference.context && access('context', alias))
			reference.context = true

		if (!reference.store && access('store', alias)) reference.store = true

		if (!reference.set && access('set', alias)) reference.set = true

		if (
			reference.request &&
			reference.parse &&
			reference.transform &&
			reference.handle &&
			reference.beforeHandle &&
			reference.afterHandle &&
			reference.error &&
			reference.context &&
			reference.store &&
			reference.set
		)
			break
	}

	return aliases
}

export const sucrose = (
	lifeCycle: Sucrose.LifeCycle,
	reference: Sucrose.Reference = {
		queries: [],
		query: false,
		headers: false,
		body: false,
		cookie: false,
		set: false
	}
): Sucrose.Reference => {
	const events = [
		lifeCycle.beforeHandle,
		lifeCycle.parse,
		lifeCycle.error,
		lifeCycle.transform,
		lifeCycle.afterHandle,
		lifeCycle.mapResponse,
		lifeCycle.request,
		lifeCycle.onResponse
	]

	if (typeof lifeCycle.handler === 'function')
		events.splice(0, -1, [lifeCycle.handler as any])

	analyze: for (const lifecycle of events) {
		for (const handler of lifecycle) {
			const [parameter, body] = separateFunction(handler.toString())

			const rootParameters = findParameterReference(parameter, reference)
			const mainParameter = extractMainParameter(rootParameters)

			if (mainParameter) {
				const aliases = findAlias(mainParameter, body)
				aliases.splice(0, -1, mainParameter)

				inferBodyReference(body, aliases, reference)
			}

			if (reference.query) {
				const queryIndex = parameter.indexOf('query: {')

				if (queryIndex !== -1) {
					const part = parameter.slice(queryIndex + 7)
					const [start, end] = bracketPairRange(part)

					const queryBracket = removeDefaultParameter(
						part.slice(start, end)
					)

					for(const query of queryBracket.slice(1, -1).split(','))
						reference.queries.push(query.trim())
				}
			}

			if (
				reference.query &&
				reference.headers &&
				reference.body &&
				reference.cookie &&
				reference.set
			)
				break analyze
		}
	}

	return reference
}

/**
 * Analyze if context is mentioned in body in a trace
 */
export const sucroseTrace = (traces: TraceHandler[]) => {
	const reference: Sucrose.TraceInference = {
		request: false,
		parse: false,
		transform: false,
		handle: false,
		beforeHandle: false,
		afterHandle: false,
		error: false,
		context: false,
		store: false,
		set: false
	}

	for (const handler of traces) {
		const [parameter, body] = separateFunction(handler.toString())

		const rootParameters = findTraceParameterReference(parameter, reference)
		const mainParameter = extractMainParameter(rootParameters)

		if (mainParameter) {
			const aliases = findAlias(mainParameter, body)
			aliases.splice(0, -1, mainParameter)

			inferTraceBodyReference(body, aliases, reference)

			continue
		}

		if (
			reference.request &&
			reference.parse &&
			reference.transform &&
			reference.handle &&
			reference.beforeHandle &&
			reference.afterHandle &&
			reference.error &&
			reference.context &&
			reference.store &&
			reference.set
		)
			break
	}

	return reference
}

// const a = sucrose({
// 	handler: function ({ query: { a = 'a', h } }) {},
// 	afterHandle: [],
// 	beforeHandle: [],
// 	error: [
// 		function a({ headers: { hello }, ...rest }) {
// 			// const { cookie } = rest
// 		}
// 	],
// 	mapResponse: [],
// 	onResponse: [],
// 	parse: [],
// 	request: [],
// 	start: [],
// 	stop: [],
// 	trace: [],
// 	transform: []
// })

// console.log(a)
