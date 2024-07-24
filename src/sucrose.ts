/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-constant-condition */
import type { Handler, HookContainer, LifeCycleStore } from './types'

export namespace Sucrose {
	export interface Inference {
		query: boolean
		headers: boolean
		body: boolean
		cookie: boolean
		set: boolean
		server: boolean
	}

	export interface LifeCycle extends Partial<LifeCycleStore> {
		handler?: Handler
	}
}

export const hasReturn = (fn: string | HookContainer<any> | Function) => {
	const fnLiteral =
		typeof fn === 'object'
			? fn.fn.toString()
			: typeof fn === 'string'
				? fn.toString()
				: fn

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

/**
 * Separate stringified function body and paramter
 *
 * @example
 * ```typescript
 * separateFunction('async ({ hello }) => { return hello }') // => ['({ hello })', '{ return hello }']
 * ```
 */
export const separateFunction = (
	code: string
): [string, string, { isArrowReturn: boolean }] => {
	if (code.startsWith('async')) code = code.slice(6)

	let index = -1

	// Starts with '(', is an arrow function
	if (code.charCodeAt(0) === 40) {
		index = code.indexOf('=>', code.indexOf(')'))

		if (index !== -1) {
			let bracketEndIndex = index
			// Walk back to find bracket end
			while (bracketEndIndex > 0)
				if (code.charCodeAt(--bracketEndIndex) === 41) break

			let body = code.slice(index + 2)
			if (body.charCodeAt(0) === 32) body = body.trimLeft()

			return [
				code.slice(1, bracketEndIndex),
				body,
				{
					isArrowReturn: body.charCodeAt(0) !== 123
				}
			]
		}
	}

	// Using function keyword
	if (code.startsWith('function')) {
		index = code.indexOf('(')
		const end = code.indexOf(')')

		return [
			code.slice(index + 1, end),
			code.slice(end + 2),
			{
				isArrowReturn: false
			}
		]
	}

	// Probably Declare as method
	const start = code.indexOf('(')

	if (start !== -1) {
		const sep = code.indexOf('\n', 2)
		const parameter = code.slice(0, sep)
		const end = parameter.lastIndexOf(')') + 1

		const body = code.slice(sep + 1)

		return [
			parameter.slice(start, end),
			'{' + body,
			{
				isArrowReturn: false
			}
		]
	}

	// Unknown case
	const x = code.split('\n', 2)

	return [x[0], x[1], { isArrowReturn: false }]
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

export const removeColonAlias = (parameter: string) => {
	while (true) {
		const start = parameter.indexOf(':')
		if (start === -1) break

		let end = parameter.indexOf(',', start)
		if (end === -1) end = parameter.indexOf('}', start) - 1
		if (end === -2) end = parameter.length

		parameter = parameter.slice(0, start) + parameter.slice(end)
	}

	return parameter
}

/**
 * Retrieve only root paramters of a function
 *
 * @example
 * ```typescript
 * retrieveRootParameters('({ hello: { world: { a } }, elysia })') // => {
 *   parameters: ['hello', 'elysia'],
 *   hasParenthesis: true
 * }
 * ```
 */
export const retrieveRootParamters = (parameter: string) => {
	let hasParenthesis = false

	// Remove () from parameter
	if (parameter.charCodeAt(0) === 40) parameter = parameter.slice(1, -1)

	// Remove {} from parameter
	if (parameter.charCodeAt(0) === 123) {
		hasParenthesis = true
		parameter = parameter.slice(1, -1)
	}

	parameter = parameter.replace(/( |\t|\n)/g, '').trim()
	let parameters = <string[]>[]

	// Object destructuring
	while (true) {
		// eslint-disable-next-line prefer-const
		let [start, end] = bracketPairRange(parameter)
		if (start === -1) break

		// Remove colon from object structuring cast
		parameters.push(parameter.slice(0, start - 1))
		if (parameter.charCodeAt(end) === 44) end++
		parameter = parameter.slice(end)
	}

	parameter = removeColonAlias(parameter)
	if (parameter) parameters = parameters.concat(parameter.split(','))	

	const newParameters = []
	for (const p of parameters) {
		if (p.indexOf(',') === -1) {
			newParameters.push(p)
			continue
		}

		for (const q of p.split(','))
			newParameters.push(q.trim())
	}
	parameters = newParameters

	return {
		hasParenthesis,
		parameters
	}
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
	const { parameters, hasParenthesis } = retrieveRootParamters(parameter)

	// Check if root is an object destructuring
	if (!inference.query && parameters.includes('query')) inference.query = true
	if (!inference.headers && parameters.includes('headers'))
		inference.headers = true
	if (!inference.body && parameters.includes('body')) inference.body = true
	if (!inference.cookie && parameters.includes('cookie'))
		inference.cookie = true
	if (!inference.set && parameters.includes('set')) inference.set = true
	if (!inference.server && parameters.includes('server'))
		inference.server = true

	if (hasParenthesis) return `{ ${parameters.join(', ')} }`

	return parameters.join(', ')
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

			aliases.push(removeColonAlias(content.slice(start, end)))

			content = content.slice(index + 3 + type.length)

			continue
		}

		// Remove comma
		while (variable.charCodeAt(0) === 44) variable = variable.slice(1)
		while (variable.charCodeAt(0) === 9) variable = variable.slice(1)

		if (!variable.includes('(')) aliases.push(variable)

		content = content.slice(index + 3 + type.length)
	}

	for (const alias of aliases) {
		if (alias.charCodeAt(0) === 123) continue

		const deepAlias = findAlias(alias, body)
		if (deepAlias.length > 0) aliases.push(...deepAlias)
	}

	return aliases
}

// ? This is normalized to dot notation in Bun
// const accessor = <T extends string, P extends string>(parent: T, prop: P) =>
// 	[
// 		parent + '.' + prop,
// 		parent + '["' + prop + '"]',
// 		parent + "['" + prop + "']"
// 	] as const

export const extractMainParameter = (parameter: string) => {
	if (!parameter) return

	if (parameter.charCodeAt(0) !== 123) return parameter

	parameter = parameter.slice(2, -2)

	const hasComma = parameter.includes(',')
	if (!hasComma) {
		// This happens when spread operator is used as the only parameter
		if (parameter.includes('...'))
			return parameter.slice(parameter.indexOf('...') + 3)

		return
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

	for (const alias of aliases) {
		if (!alias) continue

		// Scan object destructured property
		if (alias.charCodeAt(0) === 123) {
			const parameters = retrieveRootParamters(alias).parameters

			if (!inference.query && parameters.includes('query'))
				inference.query = true

			if (!inference.headers && parameters.includes('headers'))
				inference.headers = true

			if (!inference.body && parameters.includes('body'))
				inference.body = true

			if (!inference.cookie && parameters.includes('cookie'))
				inference.cookie = true

			if (!inference.set && parameters.includes('set'))
				inference.set = true

			if (!inference.query && parameters.includes('server'))
				inference.server = true

			continue
		}

		if (!inference.query && access('query', alias)) inference.query = true

		if (
			code.includes('return ' + alias) ||
			code.includes('return ' + alias + '.query')
		)
			inference.query = true

		if (!inference.headers && access('headers', alias))
			inference.headers = true

		if (!inference.body && access('body', alias)) inference.body = true

		if (!inference.cookie && access('cookie', alias))
			inference.cookie = true

		if (!inference.set && access('set', alias)) inference.set = true
		if (!inference.server && access('server', alias))
			inference.server = true

		if (
			inference.query &&
			inference.headers &&
			inference.body &&
			inference.cookie &&
			inference.set &&
			inference.server
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

const isContextPassToFunction = (
	context: string,
	body: string,
	inference: Sucrose.Inference
) => {
	// ! Function is passed to another function, assume as all is accessed
	try {
		const captureFunction = new RegExp(`(?:\\w)\\((?:.*)?${context}`, 'gs')
		captureFunction.test(body)

		/*
		Since JavaScript engine already format the code (removing whitespace, newline, etc.),
		we can safely assume that the next character is either a closing bracket or a comma
		if the function is passed to another function
		*/
		const nextChar = body.charCodeAt(captureFunction.lastIndex)

		if (nextChar === 41 || nextChar === 44) {
			inference.query = true
			inference.headers = true
			inference.body = true
			inference.cookie = true
			inference.set = true
			inference.server = true

			return true
		}

		return false
	} catch (error) {
		console.log(
			'[Sucrose] warning: unexpected isContextPassToFunction error, you may continue development as usual but please report the following to the developer:'
		)
		console.log('--- body ---')
		console.log(body)
		console.log('--- context ---')
		console.log(context)

		return true
	}
}

export const sucrose = (
	lifeCycle: Sucrose.LifeCycle,
	inference: Sucrose.Inference = {
		query: false,
		headers: false,
		body: false,
		cookie: false,
		set: false,
		server: false
	}
): Sucrose.Inference => {
	const events = []

	if (lifeCycle.handler && typeof lifeCycle.handler === 'function')
		events.push(lifeCycle.handler)

	if (lifeCycle.request?.length) events.push(...lifeCycle.request)
	if (lifeCycle.beforeHandle?.length) events.push(...lifeCycle.beforeHandle)
	if (lifeCycle.parse?.length) events.push(...lifeCycle.parse)
	if (lifeCycle.error?.length) events.push(...lifeCycle.error)
	if (lifeCycle.transform?.length) events.push(...lifeCycle.transform)
	if (lifeCycle.afterHandle?.length) events.push(...lifeCycle.afterHandle)
	if (lifeCycle.mapResponse?.length) events.push(...lifeCycle.mapResponse)
	if (lifeCycle.afterResponse?.length) events.push(...lifeCycle.afterResponse)

	for (const e of events) {
		if (!e) continue

		const event = 'fn' in e ? e.fn : e

		const [parameter, body, { isArrowReturn }] = separateFunction(
			event.toString()
		)

		const rootParameters = findParameterReference(parameter, inference)
		const mainParameter = extractMainParameter(rootParameters)

		if (mainParameter) {
			const aliases = findAlias(mainParameter, body)
			aliases.splice(0, -1, mainParameter)

			if (!isContextPassToFunction(mainParameter, body, inference))
				inferBodyReference(body, aliases, inference)

			if (
				!inference.query &&
				body.includes('return ' + mainParameter + '.query')
			)
				inference.query = true
		}

		if (
			inference.query &&
			inference.headers &&
			inference.body &&
			inference.cookie &&
			inference.set &&
			inference.server
		)
			break
	}

	return inference
}
