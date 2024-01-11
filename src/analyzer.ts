/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-constant-condition */
import type { Handler, LifeCycleStore } from './types'

namespace Sucrose {
	export interface Reference {
		query: boolean
		headers: boolean
		body: boolean
		cookie: boolean
		set: boolean
	}

	export interface LifeCycle extends LifeCycleStore {
		handler: Handler
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

	// Unknown case
	return code.split('\n', 1) as [string, string]
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

	return [start, end]
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
		code.includes(type + '.' + alias) ||
		code.includes(type + '["' + alias + '"]') ||
		code.includes(type + "['" + alias + "']")

	for (const alias of aliases) {
		if (alias.charCodeAt(0) === 123) {
			if (!reference.query && access('query', alias))
				reference.query = true

			if (!reference.headers && access('headers', alias))
				reference.headers = true

			if (!reference.body && access('body', alias)) reference.body = true

			if (!reference.cookie && access('cookie', alias))
				reference.cookie = true

			if (!reference.set && access('set', alias)) reference.set = true

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

		if (!reference.query && access(alias, 'query')) reference.query = true

		if (!reference.headers && access(alias, 'headers'))
			reference.headers = true

		if (!reference.body && access(alias, 'body')) reference.body = true

		if (!reference.cookie && access(alias, 'cookie'))
			reference.cookie = true

		if (!reference.set && access(alias, 'set')) reference.set = true

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

export const sucrose = (
	lifeCycle: Sucrose.LifeCycle,
	reference: Sucrose.Reference = {
		query: false,
		headers: false,
		body: false,
		cookie: false,
		set: false
	}
): Sucrose.Reference => {
	const events = [
		[lifeCycle.handler],
		lifeCycle.beforeHandle,
		lifeCycle.parse,
		lifeCycle.error,
		lifeCycle.afterHandle,
		lifeCycle.mapResponse,
		lifeCycle.request,
		lifeCycle.onResponse
	]

	analyze: for (const lifecycle of events) {
		for (const handler of lifecycle) {
			const [parameter, body] = separateFunction(handler.toString())

			const rootParameters = findParameterReference(parameter, reference)
			const mainParameter = extractMainParameter(rootParameters)

			if (mainParameter) {
				const aliases = findAlias(mainParameter, body)
				aliases.splice(0, -1, mainParameter)

				inferBodyReference(body, aliases, reference)

				continue
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

import { Suite } from 'benchmark'

export const run = (suite: Suite) => {
	suite
		// @ts-ignore
		.on('cycle', function (event) {
			console.log(String(event.target))
		})
		.on('complete', function () {
			// @ts-ignore
			console.log('Fastest is ' + this.filter('fastest').map('name'))
		})
		// run async
		.run()
}

run(
	new Suite('sucrose').add('analyze', () => {
		sucrose({
			handler: function ({ set }) {},
			afterHandle: [],
			beforeHandle: [],
			error: [
				function a({ headers: { hello }, ...rest }) {
					const keyword = 'cook' + 'ie'

					rest[keyword]
				}
			],
			mapResponse: [],
			onResponse: [],
			parse: [],
			request: [],
			start: [],
			stop: [],
			trace: [],
			transform: []
		})
	})
)

const a = sucrose({
	handler: function ({ set }) {},
	afterHandle: [],
	beforeHandle: [],
	error: [
		function a({ headers: { hello }, ...rest }) {
			const keyword = 'cook' + 'ie'

			rest[keyword]
		}
	],
	mapResponse: [],
	onResponse: [],
	parse: [],
	request: [],
	start: [],
	stop: [],
	trace: [],
	transform: []
})

console.log(a)
