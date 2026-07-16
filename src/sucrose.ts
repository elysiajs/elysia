import { fnv1a } from './utils'
import { isProduction } from './error'
import { getCompilerSession } from './compile/aot'

import type { Handler, AppHook } from './types'

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

	export type LifeCycle = Partial<Partial<AppHook>>
}

/**
 * Separate stringified function body and parameter
 *
 * @example
 * ```typescript
 * separateFunction('async ({ hello }) => { return hello }') // => ['({ hello })', '{ return hello }']
 * ```
 */
export function separateFunction(code: string): [string, string] {
	// Remove async keyword without removing space (both minify and non-minify)
	if (code.startsWith('async')) code = code.slice(5)
	code = code.trimStart()

	let index: number

	// JSC: Starts with '(', is an arrow function
	if (code.charCodeAt(0) === 40) {
		const parameterEnd = findClosingParenthesis(code, 0)
		index = code.indexOf('=>', parameterEnd)

		if (index !== -1) {
			let body = code.slice(index + 2)
			if (body.charCodeAt(0) === 32) body = body.trimStart()

			return [code.slice(1, parameterEnd), body]
		}
	}

	// V8: bracket is removed for 1 parameter arrow function
	if (/^([\w$]+)=>/g.test(code)) {
		index = code.indexOf('=>')

		if (index !== -1) {
			let body = code.slice(index + 2)
			if (body.charCodeAt(0) === 32) body = body.trimStart()

			return [code.slice(0, index), body]
		}
	}

	// Using function keyword
	if (code.startsWith('function')) {
		index = code.indexOf('(')
		const end = findClosingParenthesis(code, index)

		return [code.slice(index + 1, end), code.slice(end + 2)]
	}

	// Probably Declare as method
	const start = code.indexOf('(')

	if (start !== -1) {
		const sep = code.indexOf('\n', 2)
		const parameter = code.slice(0, sep)
		const end = parameter.lastIndexOf(')') + 1

		const body = code.slice(sep + 1)

		return [parameter.slice(start, end), '{' + body]
	}

	// Unknown case
	const x = code.split('\n', 2)

	return [x[0], x[1]]
}

function findClosingParenthesis(code: string, start: number) {
	let deep = 1

	for (let index = start + 1; index < code.length; index++) {
		const char = code.charCodeAt(index)

		if (char === 40) deep++
		else if (char === 41 && --deep === 0) return index
	}

	return start
}

/**
 * Get range between bracket pair
 *
 * @example
 * ```typescript
 * bracketPairRange('hello: { world: { a } }, elysia') // [6, 20]
 * ```
 */
export function bracketPairRange(parameter: string): [number, number] {
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
export function bracketPairRangeReverse(parameter: string): [number, number] {
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

export function removeColonAlias(parameter: string) {
	while (true) {
		const start = parameter.indexOf(':')
		if (start === -1) break

		// Drop the `:alias`
		let end = start + 1
		while (end < parameter.length) {
			const char = parameter.charCodeAt(end)
			if (char !== 32 && char !== 9 && char !== 10) break
			end++
		}

		// Consume the alias identifier up to the next delimiter/whitespace.
		while (end < parameter.length) {
			const char = parameter.charCodeAt(end)

			// , } space \t \n
			if (
				char === 44 ||
				char === 125 ||
				char === 32 ||
				char === 9 ||
				char === 10
			)
				break
			end++
		}

		parameter = parameter.slice(0, start) + parameter.slice(end)
	}

	return parameter
}

/**
 * Retrieve only root parameters of a function
 *
 * @example
 * ```typescript
 * retrieveRootParameters('({ hello: { world: { a } }, elysia })') // => {
 *   parameters: ['hello', 'elysia'],
 *   hasParenthesis: true
 * }
 * ```
 */
export function retrieveRootparameters(parameter: string) {
	let hasParenthesis = false

	// Remove () from parameter
	if (parameter.charCodeAt(0) === 40) parameter = parameter.slice(1, -1)

	// Remove {} from parameter
	if (parameter.charCodeAt(0) === 123) {
		hasParenthesis = true
		const [, end] = bracketPairRange(parameter)
		parameter = parameter.slice(1, end - 1)
	}

	parameter = parameter.replace(/[ \t\n]/g, '')
	let parameters = <string[]>[]

	// Object destructuring
	while (true) {
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
			parameterMap[removeDefaultParameter(p)] = true
			continue
		}

		for (const q of p.split(','))
			parameterMap[removeDefaultParameter(q.trim())] = true
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
function findParameterReference(
	parameter: string,
	inference: Sucrose.Inference
) {
	const { parameters, hasParenthesis } = retrieveRootparameters(parameter)

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

function findEndIndex(
	type: string,
	content: string,
	index?: number | undefined
) {
	let search = index ?? 0

	while (true) {
		const found = content.indexOf(type, search)
		if (found === -1) return -1

		switch (content.charCodeAt(found + type.length)) {
			case 10: // \n
			case 9: // \t
			case 44: // ,
			case 59: // ;
			case 32: // space
			case 41: // )
			case 125: // } end of a minified block, e.g. `{const a=body}`
				return found
		}

		search = found + 1
	}
}

/**
 * Find alias of variable from function body
 *
 * @example
 * ```typescript
 * findAlias('body', '{ const a = body, b = body }') // => ['a', 'b']
 * ```
 */
export function findAlias(
	type: string,
	body: string,
	seen: Set<string> = new Set()
) {
	const aliases: string[] = []

	let content = body

	const spaced = ' = ' + type
	const minified = '=' + type

	while (true) {
		let matchedLength = spaced.length
		let index = findEndIndex(spaced, content)
		// V8 engine minified the code
		if (index === -1) {
			index = findEndIndex(minified, content)
			matchedLength = minified.length
		}

		if (index === -1) {
			/**
			 * Check if pattern is at the end of the string
			 *
			 * @example
			 * ```typescript
			 * 'const a = body' // true
			 * ```
			 **/
			let lastIndex = content.indexOf(spaced)
			matchedLength = spaced.length
			if (lastIndex === -1) {
				lastIndex = content.indexOf(minified)
				matchedLength = minified.length
			}

			if (lastIndex === -1) break
			if (lastIndex + matchedLength !== content.length) break

			index = lastIndex
		}

		const part = content.slice(0, index)

		let boundary = -1
		for (let i = part.length - 1; i >= 0; i--) {
			const char = part.charCodeAt(i)
			// space , ( ; ) \t \n
			if (
				char === 32 ||
				char === 44 ||
				char === 40 ||
				char === 59 ||
				char === 41 ||
				char === 9 ||
				char === 10
			) {
				boundary = i
				break
			}
		}

		/**
		 * aliased variable last character
		 *
		 * @example
		 * ```typescript
		 * const { hello } = body // } is the last character
		 * ```
		 **/
		const variable = part.slice(boundary + 1)

		// Variable is using object destructuring, find the bracket pair
		if (variable.charCodeAt(variable.length - 1) === 125) {
			const [start, end] = bracketPairRangeReverse(part)

			aliases.push(removeColonAlias(content.slice(start, end)))

			content = content.slice(index + matchedLength)

			continue
		}

		if (variable && !variable.includes('(')) aliases.push(variable)

		content = content.slice(index + matchedLength)
	}

	for (let i = 0; i < aliases.length; i++) {
		const alias = aliases[i]
		if (alias.charCodeAt(0) === 123 || seen.has(alias)) continue

		seen.add(alias)
		aliases.push(...findAlias(alias, body, seen))
	}

	return aliases
}

export function extractMainParameter(parameter: string) {
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

function isIdentifierChar(char: number) {
	// 0-9
	return (
		(char >= 48 && char <= 57) ||
		// A-Z
		(char >= 65 && char <= 90) ||
		// a-z
		(char >= 97 && char <= 122) ||
		// _ $
		char === 95 ||
		char === 36
	)
}

export function hasAmbiguousContextUse(code: string, aliases: string[]) {
	for (const alias of aliases) {
		if (!alias || alias.charCodeAt(0) === 123) continue

		let from = 0
		while (true) {
			const index = code.indexOf(alias, from)
			if (index === -1) break

			from = index + alias.length

			// Reject partial identifier matches (e.g. alias `c` inside `abc`)
			const before = index === 0 ? -1 : code.charCodeAt(index - 1)
			if (before !== -1 && isIdentifierChar(before)) continue

			let spread = index - 1
			while (spread >= 0) {
				const char = code.charCodeAt(spread)
				if (char !== 32 && char !== 9 && char !== 10) break
				spread--
			}
			if (
				code.charCodeAt(spread) === 46 &&
				code.charCodeAt(spread - 1) === 46 &&
				code.charCodeAt(spread - 2) === 46
			)
				return true

			// Look at what immediately follows the alias.
			let after = from

			// Whitespace between the alias and a member operator
			// (`c .query`, `c\n.query`, `c [k]`) defeats the exact-string
			// `access()` matcher → treat as ambiguous once we confirm the
			// next non-space token is a member operator.
			let hadSpace = false
			while (after < code.length) {
				const char = code.charCodeAt(after)
				if (char !== 32 && char !== 9 && char !== 10) break
				hadSpace = true
				after++
			}

			// Skip an optional-chaining `?.` so `alias?.[k]` / `alias?.query`
			// are handled like their plain counterparts.
			if (
				code.charCodeAt(after) === 63 && // ?
				code.charCodeAt(after + 1) === 46 // .
			)
				after += 2

			const op = code.charCodeAt(after)

			// `.` member access
			if (op === 46) {
				// Spaced access (`c .query`)
				if (hadSpace) return true

				// Whitespace after the dot (`c.  query`) also defeats the
				// matcher's exact `alias.query` string.
				let cursor = after + 1
				while (cursor < code.length) {
					const char = code.charCodeAt(cursor)
					if (char !== 32 && char !== 9 && char !== 10) break
					cursor++
				}
				if (cursor !== after + 1) return true

				continue
			}

			// Computed `[…]` member access
			if (op !== 91) continue

			// Skip whitespace inside the bracket.
			let cursor = after + 1
			while (cursor < code.length) {
				const char = code.charCodeAt(cursor)
				if (char !== 32 && char !== 9 && char !== 10) break
				cursor++
			}

			// A string-literal key (`alias["query"]`) is statically clear and is
			// already handled by `access()`
			const keyChar = code.charCodeAt(cursor)
			if (keyChar !== 34 && keyChar !== 39) return true // not " or '
		}
	}

	// `arguments` gives the handler the whole context array positionally, which
	// the alias tracker cannot follow
	let from = 0
	while (true) {
		const index = code.indexOf('arguments', from)
		if (index === -1) break

		from = index + 9

		const before = index === 0 ? -1 : code.charCodeAt(index - 1)
		const after = code.charCodeAt(from)

		if (
			(before === -1 || !isIdentifierChar(before)) &&
			!isIdentifierChar(after)
		)
			return true
	}

	return false
}

/**
 * Analyze if context is mentioned in body
 */
export function inferBodyReference(
	code: string,
	aliases: string[],
	inference: Sucrose.Inference
) {
	const access = (type: string, alias: string) =>
		code.includes(`${alias}.${type}`) ||
		code.includes(`${alias}?.${type}`) ||
		code.includes(`${alias}["${type}"]`) ||
		code.includes(`${alias}?.["${type}"]`) ||
		code.includes(`${alias}['${type}']`) ||
		code.includes(`${alias}?.['${type}']`)

	for (const alias of aliases) {
		if (!alias) continue

		// Scan object destructured property
		if (alias.charCodeAt(0) === 123) {
			const parameters = retrieveRootparameters(alias).parameters

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

export function removeDefaultParameter(parameter: string) {
	while (true) {
		const index = parameter.indexOf('=')
		if (index === -1) break

		const commaIndex = parameter.indexOf(',', index)
		const bracketIndex = parameter.indexOf('}', index)

		const end =
			commaIndex === -1
				? bracketIndex
				: bracketIndex === -1
					? commaIndex
					: Math.min(commaIndex, bracketIndex)

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

function markAllAccessed(i: Sucrose.Inference) {
	i.query =
		i.headers =
		i.body =
		i.cookie =
		i.set =
		i.server =
		i.url =
		i.route =
		i.path =
			true
}

function isContextPassToFunction(
	context: string,
	body: string,
	inference: Sucrose.Inference
) {
	if (body.indexOf(context) === -1) return false

	if (body.length > 32_768) {
		markAllAccessed(inference)

		return true
	}

	try {
		const ctxLength = context.length
		const bodyLength = body.length

		let searchFrom = 0
		while (true) {
			const index = body.indexOf(context, searchFrom)
			if (index === -1) break

			searchFrom = index + ctxLength

			// Whole-token match only.
			const before = index === 0 ? -1 : body.charCodeAt(index - 1)
			const afterRaw = body.charCodeAt(searchFrom)
			if (
				(before !== -1 && isIdentifierChar(before)) ||
				(!Number.isNaN(afterRaw) && isIdentifierChar(afterRaw))
			)
				continue

			// Right boundary: skip whitespace, must be `)` or `,`.
			let right = searchFrom
			while (right < bodyLength) {
				const char = body.charCodeAt(right)
				if (char !== 32 && char !== 9 && char !== 10) break
				right++
			}
			const rightChar = body.charCodeAt(right)
			if (rightChar !== 41 && rightChar !== 44) continue // not `)` or `,`

			// Left boundary: skip whitespace, must be `(` or `,`.
			let left = index - 1
			while (left >= 0) {
				const char = body.charCodeAt(left)
				if (char !== 32 && char !== 9 && char !== 10) break
				left--
			}
			if (left < 0) continue

			const leftChar = body.charCodeAt(left)

			// `,ctx)` / `,ctx,` — already inside a call's argument list.
			if (leftChar === 44) {
				markAllAccessed(inference)

				return true
			}

			// `(ctx)` / `(ctx,` the `(` must be an invocation paren, i.e.
			// preceded by an identifier char, `]`, or `)` (`fn(ctx)`,
			// `obj.method(ctx)`, `arr[0](ctx)`, `f()(ctx)`). A grouping paren
			// (e.g. `(ctx) => …`, `= (ctx)`) is not a function call.
			if (leftChar === 40) {
				let prev = left - 1
				while (prev >= 0) {
					const char = body.charCodeAt(prev)
					if (char !== 32 && char !== 9 && char !== 10) break
					prev--
				}
				if (prev < 0) continue

				const prevChar = body.charCodeAt(prev)
				if (
					isIdentifierChar(prevChar) ||
					prevChar === 93 || // ]
					prevChar === 41 // )
				) {
					markAllAccessed(inference)

					return true
				}
			}
		}

		return false
	} catch {
		console.warn(
			'[Sucrose] warning: isContextPassToFunction failed; conservative all-access fallback used'
		)
		if (!isProduction()) {
			console.log('--- body ---')
			console.log(body)
			console.log('--- context ---')
			console.log(context)
		}

		return true
	}
}

const DEFAULT_CACHE_LIMIT = 1024

type SourceCache = Map<
	number,
	{ content: string; inference: Sucrose.Inference }
>

const sourceCache = () =>
	getCompilerSession()?.sucroseCache as SourceCache | undefined

let functionCaches = new WeakMap<Function, Sucrose.Inference>()

function rememberInference(
	caches: SourceCache | undefined,
	key: number,
	cached: { content: string; inference: Sucrose.Inference } | undefined,
	content: string,
	event: unknown,
	inference: Sucrose.Inference
) {
	if (caches && (!cached || cached.content !== content)) {
		if (caches.size >= DEFAULT_CACHE_LIMIT) {
			const oldest = caches.keys().next().value
			if (oldest !== undefined) caches.delete(oldest)
		}

		caches.set(key, { content, inference })
	}
	if (typeof event === 'function') functionCaches.set(event, inference)
}

function clearCache() {
	sourceCache()?.clear()
	functionCaches = new WeakMap()
}

export function clearSucroseCache(delay?: number | null) {
	if (delay === null) return
	clearCache()
}

export function mergeInference(a: Sucrose.Inference, b: Sucrose.Inference) {
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

const defaultSucrose = () => ({
	query: false,
	headers: false,
	body: false,
	cookie: false,
	set: false,
	server: false,
	url: false,
	route: false,
	path: false
})

function push(target: unknown[], array: unknown[]) {
	for (let i = 0; i < array.length; i++) target.push(array[i])
}

function pushParse(target: unknown[], array: unknown[]) {
	for (let i = 0; i < array.length; i++)
		if (typeof array[i] === 'function') target.push(array[i])
}

export function sucrose(
	handler: Handler | undefined,
	lifeCycle: Sucrose.LifeCycle | undefined
): Sucrose.Inference {
	let inference: Sucrose.Inference | undefined

	const events: Handler[] = []

	if (handler && typeof handler === 'function') events.push(handler)
	if (lifeCycle) {
		if (lifeCycle.request?.length) push(events, lifeCycle.request)
		if (lifeCycle.beforeHandle?.length) push(events, lifeCycle.beforeHandle)
		if (lifeCycle.parse?.length) pushParse(events, lifeCycle.parse)
		if (lifeCycle.error?.length) push(events, lifeCycle.error)
		if (lifeCycle.transform?.length) push(events, lifeCycle.transform)
		if (lifeCycle.afterHandle?.length) push(events, lifeCycle.afterHandle)
		if (lifeCycle.mapResponse?.length) push(events, lifeCycle.mapResponse)
		if (lifeCycle.afterResponse?.length)
			push(events, lifeCycle.afterResponse)
	}

	const caches = sourceCache()

	for (let i = 0; i < events.length; i++) {
		const event = events[i]
		if (!event) continue

		const memoized = functionCaches.get(event as Function)
		if (memoized) {
			inference = inference
				? mergeInference(inference, memoized)
				: memoized
			continue
		}

		const content = event.toString()
		const key = fnv1a(content)
		const cached = caches?.get(key)
		if (cached && cached.content === content) {
			const cachedInference = cached.inference
			caches!.delete(key)
			caches!.set(key, cached)

			if (typeof event === 'function')
				functionCaches.set(event, cachedInference)
			inference = inference
				? mergeInference(inference, cachedInference)
				: cachedInference
			continue
		}

		inference ??= defaultSucrose()

		const fnInference: Sucrose.Inference = defaultSucrose()

		if (content.includes('[native code]')) {
			markAllAccessed(fnInference)

			rememberInference(caches, key, cached, content, event, fnInference)

			inference = mergeInference(inference, fnInference)
			continue
		}

		const [parameter, body] = separateFunction(content)

		if (body === undefined) {
			// Unknown case: parser could not extract body, degrade to all-true per contract
			markAllAccessed(fnInference)

			rememberInference(caches, key, cached, content, event, fnInference)

			inference = mergeInference(inference, fnInference)
			continue
		}

		const rootParameters = findParameterReference(parameter, fnInference)
		const mainParameter = extractMainParameter(rootParameters)

		if (mainParameter) {
			const aliases = findAlias(mainParameter, body.slice(1, -1))
			aliases.splice(0, -1, mainParameter)

			let code = body

			if (
				code.charCodeAt(0) === 123
				// start with { is implied to end with }
				// && code.charCodeAt(body.length - 1) === 125
			)
				code = code.slice(1, -1).trim()

			if (!isContextPassToFunction(mainParameter, code, fnInference)) {
				inferBodyReference(code, aliases, fnInference)

				if (hasAmbiguousContextUse(code, aliases))
					markAllAccessed(fnInference)
			}

			if (
				!fnInference.query &&
				code.includes(`return ${mainParameter}.query`)
			)
				fnInference.query = true
		}

		rememberInference(caches, key, cached, content, event, fnInference)

		inference = mergeInference(inference, fnInference)

		if (
			inference &&
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

	// Fall back to defaults when no analysable events were found
	return inference ?? defaultSucrose()
}
