/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-constant-condition */
import { checksum } from './utils'
import { isBun } from './universal/utils'

import type { Handler, HookContainer, LifeCycleStore } from './types'

export namespace Sucrose {
	export interface Inference {
		query: boolean
		headers: boolean
		body: boolean
		cookie: boolean
		set: boolean
		server: boolean
		route: boolean
		url: boolean
		path: boolean
	}

	export interface LifeCycle extends Partial<LifeCycleStore> {
		handler?: Handler
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
export const separateFunction = (
	code: string
): [string, string, { isArrowReturn: boolean }] => {
	// Remove async keyword without removing space (both minify and non-minify)
	if (code.startsWith('async')) code = code.slice(5)
	code = code.trimStart()

	let index = -1

	// JSC: Starts with '(', is an arrow function
	if (code.charCodeAt(0) === 40) {
		index = code.indexOf('=>', code.indexOf(')'))

		if (index !== -1) {
			let bracketEndIndex = index
			// Walk back to find bracket end
			while (bracketEndIndex > 0)
				if (code.charCodeAt(--bracketEndIndex) === 41) break

			let body = code.slice(index + 2)
			if (body.charCodeAt(0) === 32) body = body.trimStart()

			return [
				code.slice(1, bracketEndIndex),
				body,
				{
					isArrowReturn: body.charCodeAt(0) !== 123
				}
			]
		}
	}

	// V8: bracket is removed for 1 parameter arrow function
	if (/^(\w+)=>/g.test(code)) {
		index = code.indexOf('=>')

		if (index !== -1) {
			let body = code.slice(index + 2)
			if (body.charCodeAt(0) === 32) body = body.trimStart()

			return [
				code.slice(0, index),
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

	const parameterMap: Record<string, true> = Object.create(null)
	for (const p of parameters) {
		if (p.indexOf(',') === -1) {
			parameterMap[p] = true
			continue
		}

		for (const q of p.split(',')) parameterMap[q.trim()] = true
	}

	return {
		hasParenthesis,
		parameters: parameterMap
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
	if (parameters.query) inference.query = true
	if (parameters.headers) inference.headers = true
	if (parameters.body) inference.body = true
	if (parameters.cookie) inference.cookie = true
	if (parameters.set) inference.set = true
	if (parameters.server) inference.server = true
	if (parameters.route) inference.route = true
	if (parameters.url) inference.url = true
	if (parameters.path) inference.path = true

	if (hasParenthesis) return `{ ${Object.keys(parameters).join(', ')} }`

	return Object.keys(parameters).join(', ')
}

const findEndIndex = (
	type: string,
	content: string,
	index?: number | undefined
) => {
	const regex = new RegExp(
		`${type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\n\\t,; ]`
	)

	if (index !== undefined) regex.lastIndex = index

	const match = regex.exec(content)

	return match ? match.index : -1
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
		// V8 engine minified the code
		if (index === -1) index = findEndIndex('=' + type, content)

		if (index === -1) {
			/**
			 * Check if pattern is at the end of the string
			 *
			 * @example
			 * ```typescript
			 * 'const a = body' // true
			 * ```
			 **/
			let lastIndex = content.indexOf(' = ' + type)
			if (lastIndex === -1) lastIndex = content.indexOf('=' + type)

			if (lastIndex + 3 + type.length !== content.length) break

			index = lastIndex
		}

		const part = content.slice(0, index)

		// V8 engine minified the code
		const lastPart = part.lastIndexOf(' ')
		/**
		 * aliased variable last character
		 *
		 * @example
		 * ```typescript
		 * const { hello } = body // } is the last character
		 * ```
		 **/
		let variable = part.slice(lastPart !== -1 ? lastPart + 1 : -1)

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
		const index = parameter.indexOf('...')
		// This happens when spread operator is used as the only parameter
		if (index !== -1) return parameter.slice(parameter.indexOf('...') + 3)

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
		new RegExp(
			`${alias}\\.(${type})|${alias}\\["${type}"\\]|${alias}\\['${type}'\\]`
		).test(code)

	for (const alias of aliases) {
		if (!alias) continue

		// Scan object destructured property
		if (alias.charCodeAt(0) === 123) {
			const parameters = retrieveRootParamters(alias).parameters

			if (parameters.query) inference.query = true
			if (parameters.headers) inference.headers = true
			if (parameters.body) inference.body = true
			if (parameters.cookie) inference.cookie = true
			if (parameters.set) inference.set = true
			if (parameters.server) inference.server = true
			if (parameters.url) inference.url = true
			if (parameters.route) inference.route = true
			if (parameters.path) inference.path = true

			continue
		}

		if (
			!inference.query &&
			(access('query', alias) ||
				code.includes('return ' + alias) ||
				code.includes('return ' + alias + '.query'))
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

		if (!inference.route && access('route', alias)) inference.route = true
		if (!inference.url && access('url', alias)) inference.url = true
		if (!inference.path && access('path', alias)) inference.path = true

		if (
			inference.query &&
			inference.headers &&
			inference.body &&
			inference.cookie &&
			inference.set &&
			inference.server &&
			inference.route &&
			inference.url &&
			inference.path
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

export const isContextPassToFunction = (
	context: string,
	body: string,
	inference: Sucrose.Inference
) => {
	// ! Function is passed to another function, assume as all is accessed
	try {
		const captureFunction = new RegExp(`\\w\\((.*?)?${context}`, 'gs')
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
			inference.url = true
			inference.route = true
			inference.path = true

			return true
		}

		return false
	} catch (error) {
		console.log(
			'[Sucrose] warning: unexpected isContextPassToFunction error, you may continue development as usual but please report the following to maintainers:'
		)
		console.log('--- body ---')
		console.log(body)
		console.log('--- context ---')
		console.log(context)

		return true
	}
}

let pendingGC: number | undefined
let caches = <Record<number, Sucrose.Inference>>{}

export const clearSucroseCache = (delay = 0) => {
	if (pendingGC) clearTimeout(pendingGC)

	pendingGC = setTimeout(() => {
		caches = {}

		pendingGC = undefined
		if (isBun) Bun.gc(false)
	}, delay) as unknown as number
}

export const mergeInference = (a: Sucrose.Inference, b: Sucrose.Inference) => {
	return {
		body: a.body || b.body,
		cookie: a.cookie || b.cookie,
		headers: a.headers || b.headers,
		query: a.query || b.query,
		set: a.set || b.set,
		server: a.server || b.server,
		url: a.url || b.url,
		route: a.route || b.route,
		path: a.path || b.path
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
		server: false,
		url: false,
		route: false,
		path: false
	}
): Sucrose.Inference => {
	const events = <(Handler | HookContainer)[]>[]

	if (lifeCycle.request?.length) events.push(...lifeCycle.request)
	if (lifeCycle.beforeHandle?.length) events.push(...lifeCycle.beforeHandle)
	if (lifeCycle.parse?.length) events.push(...lifeCycle.parse)
	if (lifeCycle.error?.length) events.push(...lifeCycle.error)
	if (lifeCycle.transform?.length) events.push(...lifeCycle.transform)
	if (lifeCycle.afterHandle?.length) events.push(...lifeCycle.afterHandle)
	if (lifeCycle.mapResponse?.length) events.push(...lifeCycle.mapResponse)
	if (lifeCycle.afterResponse?.length) events.push(...lifeCycle.afterResponse)

	if (lifeCycle.handler && typeof lifeCycle.handler === 'function')
		events.push(lifeCycle.handler as Handler)

	for (let i = 0; i < events.length; i++) {
		const e = events[i]
		if (!e) continue

		const event = typeof e === 'object' ? e.fn : e

		// parse can be either a function or string
		if (typeof event !== 'function') continue

		const content = event.toString()
		const key = checksum(content)
		const cachedInference = caches[key]
		if (cachedInference) {
			inference = mergeInference(inference, cachedInference)
			continue
		}

		const fnInference: Sucrose.Inference = {
			query: false,
			headers: false,
			body: false,
			cookie: false,
			set: false,
			server: false,
			url: false,
			route: false,
			path: false
		}

		const [parameter, body] = separateFunction(content)

		const rootParameters = findParameterReference(parameter, fnInference)
		const mainParameter = extractMainParameter(rootParameters)

		if (mainParameter) {
			const aliases = findAlias(mainParameter, body.slice(1, -1))
			aliases.splice(0, -1, mainParameter)

			let code = body

			if (
				code.charCodeAt(0) === 123 &&
				code.charCodeAt(body.length - 1) === 125
			)
				code = code.slice(1, -1)

			if (!isContextPassToFunction(mainParameter, code, fnInference))
				inferBodyReference(code, aliases, fnInference)

			if (
				!fnInference.query &&
				code.includes('return ' + mainParameter + '.query')
			)
				fnInference.query = true
		}

		if (!caches[key]) caches[key] = fnInference

		inference = mergeInference(inference, fnInference)

		if (
			inference.query &&
			inference.headers &&
			inference.body &&
			inference.cookie &&
			inference.set &&
			inference.server &&
			inference.url &&
			inference.route &&
			inference.path
		)
			break
	}

	return inference
}
