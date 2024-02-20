/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-constant-condition */
import type { Handler, LifeCycleStore, TraceHandler } from './types'

export namespace Sucrose {
	export interface Inference {
		queries: string[]
		query: boolean
		headers: boolean
		body: boolean
		cookie: boolean
		set: boolean
	}

	export interface LifeCycle extends Partial<LifeCycleStore> {
		handler?: Handler
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
	const start = code.indexOf('(')

	if (start !== -1) {
		const [parameter, body] = code.split('\n', 2)
		const end = parameter.lastIndexOf(')') + 1

		return [parameter.slice(start, end), '{' + body]
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
export const bracketPairRange = (parameter: string): [number, number] => {
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

	if (deep !== 0) return [0, parameter.length]

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
export const bracketPairRangeReverse = (
	parameter: string
): [number, number] => {
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

	if (deep !== 0) return [-1, 0]

	return [start, end + 1]
}

/**
 * Retrieve only root paramters of a function
 *
 * @example
 * ```typescript
 * retrieveRootParameters('({ hello: { world: { a } }, elysia })') // => 'hello elysia'
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

	return parameter.replace(/:/g, '').trim()
}

/**
 * Find inference from parameter
 *
 * @param parameter stringified parameter
 */
export const findParameterReference = (
	parameter: string,
	inference: Sucrose.Inference
) => {
	const root = retrieveRootParamters(parameter)

	if (!inference.query && root.includes('query')) inference.query = true
	if (!inference.headers && root.includes('headers')) inference.headers = true
	if (!inference.body && root.includes('body')) inference.body = true
	if (!inference.cookie && root.includes('cookie')) inference.cookie = true
	if (!inference.set && root.includes('set')) inference.set = true

	return root
}

/**
 * Find inference from parameter
 *
 * @param parameter stringified parameter
 */
export const findTraceParameterReference = (
	parameter: string,
	inference: Sucrose.TraceInference
) => {
	const root = retrieveRootParamters(parameter)

	if (!inference.request && root.includes('request')) inference.request = true
	if (!inference.parse && root.includes('parse')) inference.parse = true
	if (!inference.transform && root.includes('transform'))
		inference.transform = true
	if (!inference.handle && root.includes('handle')) inference.handle = true
	if (!inference.beforeHandle && root.includes('beforeHandle'))
		inference.beforeHandle = true
	if (!inference.afterHandle && root.includes('afterHandle'))
		inference.afterHandle = true
	if (!inference.error && root.includes('error')) inference.error = true
	if (!inference.context && root.includes('context')) inference.context = true
	if (!inference.store && root.includes('store')) inference.store = true
	if (!inference.set && root.includes('set')) inference.set = true

	return root
}

const findEndIndex = (
	type: string,
	content: string,
	index?: number | undefined
) => {
	const newLineIndex = content.indexOf(type + '\n', index)
	const newTabIndex = content.indexOf(type + '\t', index)
	const commaIndex = content.indexOf(type + ',', index)
	const semicolonIndex = content.indexOf(type + ';', index)
	const emptyIndex = content.indexOf(type + ' ', index)

	// Pick the smallest index that is not -1 or 0
	return (
		[newLineIndex, newTabIndex, commaIndex, semicolonIndex, emptyIndex]
			.filter((i) => i > 0)
			.sort((a, b) => a - b)[0] || -1
	)
}

const findEndQueryBracketIndex = (
	type: string,
	content: string,
	index?: number | undefined
) => {
	const bracketEndIndex = content.indexOf(type + ']', index)
	const singleQuoteIndex = content.indexOf(type + "'", index)
	const doubleQuoteIndex = content.indexOf(type + '"', index)

	// Pick the smallest index that is not -1 or 0
	return (
		[bracketEndIndex, singleQuoteIndex, doubleQuoteIndex]
			.filter((i) => i > 0)
			.sort((a, b) => a - b)[0] || -1
	)
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
		let index = findEndIndex(' = ' + type, content)

		if (index === -1) {
			/**
			 * Check if pattern is at the end of the string
			 *
			 * @example
			 * ```typescript
			 * 'const a = body' // true
			 * ```
			 **/
			const lastIndex = content.indexOf(' = ' + type)

			if (lastIndex + 3 + type.length !== content.length) break

			index = lastIndex
		}

		const part = content.slice(0, index)
		/**
		 * aliased variable last character
		 *
		 * @example
		 * ```typescript
		 * const { hello } = body // } is the last character
		 * ```
		 **/
		let variable = part.slice(part.lastIndexOf(' ') + 1)

		// Variable is using object destructuring, find the bracket pair
		if (variable === '}') {
			const [start, end] = bracketPairRangeReverse(part)

			aliases.push(content.slice(start, end))

			content = content.slice(index + 3 + type.length)

			continue
		}

		// Remove comma
		while (variable.charCodeAt(0) === 44) variable = variable.slice(1)
		while (variable.charCodeAt(0) === 9) variable = variable.slice(1)

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
	if (!parameter) return

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

/**
 * Analyze if context is mentioned in body
 */
export const inferBodyReference = (
	code: string,
	aliases: string[],
	inference: Sucrose.Inference
) => {
	const access = (type: string, alias: string) =>
		code.includes(alias + '.' + type) ||
		code.includes(alias + '["' + type + '"]') ||
		code.includes(alias + "['" + type + "']")

	for (let alias of aliases) {
		if (alias.charCodeAt(0) === 123) {
			alias = retrieveRootParamters(alias)

			if (!inference.query && alias.includes('query'))
				inference.query = true

			if (!inference.headers && alias.includes('headers'))
				inference.headers = true

			if (!inference.body && alias.includes('body')) inference.body = true

			if (!inference.cookie && alias.includes('cookie'))
				inference.cookie = true

			if (!inference.set && alias.includes('set')) inference.set = true

			continue
		}

		// ! Function is passed to another function, assume as all is accessed
		if (code.includes('(' + alias + ')')) {
			inference.query = true
			inference.headers = true
			inference.body = true
			inference.cookie = true
			inference.set = true

			break
		}

		if (!inference.query && access('query', alias)) inference.query = true

		if (inference.query)
			while (true) {
				let keyword = alias + '.'
				if (code.includes(keyword + 'query')) keyword = alias + '.query'

				let isBracket = false

				let start = code.indexOf(keyword)
				if (start === -1) {
					isBracket = true
					start = code.indexOf(alias + '["')
				}

				if (start === -1) {
					isBracket = true
					start = code.indexOf(alias + "['")
				}

				if (start === -1 && code.indexOf(alias + '[') !== -1) {
					// ! Query is accessed using dynamic key, skip static parsing
					inference.queries = []

					break
				}

				if (start !== -1) {
					let end: number | undefined = isBracket
						? findEndQueryBracketIndex(
								'',
								code,
								start + keyword.length + 1
						  )
						: findEndIndex('', code, start + keyword.length + 1)

					if (end === -1) end = undefined

					const index = start + alias.length + 1
					code = code.slice(start + alias.length + 1)
					let query = code.slice(0, end ? end - index : end).trimEnd()

					// Remove nested dot
					while (start !== -1) {
						start = query.indexOf('.')

						if (start !== -1) query = query.slice(start + 1)
					}

					// Remove semi-colon
					if (query.charCodeAt(query.length - 1) === 59)
						query = query.slice(0, -1)

					// Remove comma
					if (query.charCodeAt(query.length - 1) === 44)
						query = query.slice(0, -1)

					// Remove closing square bracket
					if (query.charCodeAt(query.length - 1) === 93)
						query = query.slice(0, -1)

					// Remove closing bracket
					if (query.charCodeAt(query.length - 1) === 41)
						query = query.slice(0, -1)

					if (isBracket) query = query.replaceAll(/("|')/g, '')

					if (query && !inference.queries.includes(query)) {
						inference.queries.push(query)
						continue
					}
				}

				break
			}

		if (!inference.headers && access('headers', alias))
			inference.headers = true

		if (!inference.body && access('body', alias)) inference.body = true

		if (!inference.cookie && access('cookie', alias))
			inference.cookie = true

		if (!inference.set && access('set', alias)) inference.set = true

		if (
			inference.query &&
			inference.headers &&
			inference.body &&
			inference.cookie &&
			inference.set
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

		const end =
			[commaIndex, bracketIndex]
				.filter((i) => i > 0)
				.sort((a, b) => a - b)[0] || -1

		if (end === -1) {
			parameter = parameter.slice(0, index)

			break
		}

		parameter = parameter.slice(0, index) + parameter.slice(end)
	}

	return parameter
		.split(',')
		.map((i) => i.trim())
		.join(', ')
}

export const validateInferencedQueries = (queries: string[]) => {
	for (const query of queries) {
		if (query.charCodeAt(0) === 123) return false
		if (query.indexOf("'") !== -1) return false
		if (query.indexOf('"') !== -1) return false
		if (query.indexOf('\n') !== -1) return false
		if (query.indexOf('\t') !== -1) return false
	}

	return true
}

/**
 * Analyze if context is mentioned in body
 */
export const inferTraceBodyReference = (
	code: string,
	aliases: string[],
	inference: Sucrose.TraceInference
) => {
	const access = (type: string, alias: string) =>
		code.includes(type + '.' + alias) ||
		code.includes(type + '["' + alias + '"]') ||
		code.includes(type + "['" + alias + "']")

	for (let alias of aliases) {
		if (alias.charCodeAt(0) === 123) {
			alias = retrieveRootParamters(alias)

			if (!inference.request && alias.includes('request'))
				inference.request = true

			if (!inference.parse && alias.includes('parse'))
				inference.parse = true

			if (!inference.transform && alias.includes('transform'))
				inference.transform = true

			if (!inference.handle && alias.includes('handle'))
				inference.handle = true

			if (!inference.beforeHandle && alias.includes('beforeHandle'))
				inference.beforeHandle = true

			if (!inference.afterHandle && alias.includes('afterHandle'))
				inference.afterHandle = true

			if (!inference.error && alias.includes('error'))
				inference.error = true

			if (!inference.context && alias.includes('context'))
				inference.context = true

			if (!inference.store && alias.includes('store'))
				inference.store = true

			if (!inference.set && alias.includes('set')) inference.set = true

			continue
		}

		// ! Function is passed to another function, assume as all is accessed
		if (code.includes('(' + alias + ')')) {
			inference.request = true
			inference.parse = true
			inference.transform = true
			inference.handle = true
			inference.beforeHandle = true
			inference.afterHandle = true
			inference.error = true
			inference.context = true
			inference.store = true
			inference.set = true

			break
		}

		if (!inference.request && access('request', alias))
			inference.request = true

		if (!inference.parse && access('parse', alias)) inference.parse = true

		if (!inference.transform && access('transform', alias))
			inference.transform = true

		if (!inference.handle && access('handle', alias))
			inference.handle = true

		if (!inference.beforeHandle && access('beforeHandle', alias))
			inference.beforeHandle = true

		if (!inference.afterHandle && access('afterHandle', alias))
			inference.afterHandle = true

		if (!inference.error && access('error', alias)) inference.error = true

		if (!inference.context && access('context', alias))
			inference.context = true

		if (!inference.store && access('store', alias)) inference.store = true

		if (!inference.set && access('set', alias)) inference.set = true

		if (
			inference.request &&
			inference.parse &&
			inference.transform &&
			inference.handle &&
			inference.beforeHandle &&
			inference.afterHandle &&
			inference.error &&
			inference.context &&
			inference.store &&
			inference.set
		)
			break
	}

	return aliases
}

export const sucrose = (
	lifeCycle: Sucrose.LifeCycle,
	inference: Sucrose.Inference = {
		queries: [],
		query: false,
		headers: false,
		body: false,
		cookie: false,
		set: false
	}
): Sucrose.Inference => {
	const events = []

	if (lifeCycle.handler && typeof lifeCycle.handler === 'function')
		events.push(lifeCycle.handler)

	if (lifeCycle.beforeHandle?.length) events.push(...lifeCycle.beforeHandle)
	if (lifeCycle.parse?.length) events.push(...lifeCycle.parse)
	if (lifeCycle.error?.length) events.push(...lifeCycle.error)
	if (lifeCycle.transform?.length) events.push(...lifeCycle.transform)
	if (lifeCycle.afterHandle?.length) events.push(...lifeCycle.afterHandle)
	if (lifeCycle.mapResponse?.length) events.push(...lifeCycle.mapResponse)
	if (lifeCycle.request?.length) events.push(...lifeCycle.request)
	if (lifeCycle.onResponse?.length) events.push(...lifeCycle.onResponse)

	for (const event of events) {
		const [parameter, body] = separateFunction(event.toString())

		const rootParameters = findParameterReference(parameter, inference)
		const mainParameter = extractMainParameter(rootParameters)

		if (mainParameter) {
			const aliases = findAlias(mainParameter, body)
			aliases.splice(0, -1, mainParameter)

			inferBodyReference(body, aliases, inference)
		}

		if (inference.query) {
			inferBodyReference(body, ['query'], inference)

			const queryIndex = parameter.indexOf('query: {')

			if (queryIndex !== -1) {
				const part = parameter.slice(queryIndex + 7)
				const [start, end] = bracketPairRange(part)

				const queryBracket = removeDefaultParameter(
					part.slice(start, end)
				)

				for (let query of queryBracket.slice(1, -1).split(',')) {
					const index = query.indexOf(':')

					// Remove variable name casting: { a: b } should be b
					if (index !== -1) query = query.slice(0, index)

					query = query.trim()

					if (query && !inference.queries.includes(query))
						inference.queries.push(query.trim())
				}
			}
		}

		if (
			inference.query &&
			inference.headers &&
			inference.body &&
			inference.cookie &&
			inference.set
		)
			break
	}

	if (!validateInferencedQueries(inference.queries)) inference.queries = []

	return inference
}

/**
 * Analyze if context is mentioned in body in a trace
 */
export const sucroseTrace = (
	traces: TraceHandler[],
	inference: Sucrose.TraceInference = {
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
) => {
	for (const handler of traces) {
		const [parameter, body] = separateFunction(handler.toString())

		const rootParameters = findTraceParameterReference(parameter, inference)
		const mainParameter = extractMainParameter(rootParameters)

		if (mainParameter) {
			const aliases = findAlias(mainParameter, body)
			aliases.splice(0, -1, mainParameter)

			inferTraceBodyReference(body, aliases, inference)

			continue
		}

		if (
			inference.request &&
			inference.parse &&
			inference.transform &&
			inference.handle &&
			inference.beforeHandle &&
			inference.afterHandle &&
			inference.error &&
			inference.context &&
			inference.store &&
			inference.set
		)
			break
	}

	return inference
}
