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
		route: boolean
	}

	export type InferenceOverride = Partial<Inference>
	export type Implementation = 'oracle' | 'candidate'

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
	if (parameters.route) inference.route = true

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
			if (parameters.route) inference.route = true

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

		if (!inference.route && access('route', alias)) inference.route = true

		if (
			inference.query &&
			inference.headers &&
			inference.body &&
			inference.cookie &&
			inference.set &&
			inference.route
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
	i.query = i.headers = i.body = i.cookie = i.set = i.route = true
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

const SOURCE_CACHE_LIMIT = 1024 * 1024

type SourceCacheEntry = {
	content: string
	inference: Sucrose.Inference
	bytes: number
}

const compilerSession = () => getCompilerSession()

let oracleFunctionCaches = new WeakMap<Function, Sucrose.Inference>()
let candidateFunctionCaches = new WeakMap<Function, Sucrose.Inference>()
const literalHeaderName = /^[!#$%&'*+\-.^_`|~0-9a-z]+$/

function rememberInference(
	lane: Sucrose.Implementation,
	key: string,
	cached: SourceCacheEntry | undefined,
	content: string,
	event: unknown,
	inference: Sucrose.Inference,
	functionCache: WeakMap<Function, Sucrose.Inference>
) {
	const immutable = Object.freeze({ ...inference })
	const session = compilerSession()
	const caches = session?.sucroseCache as
		| Map<string, SourceCacheEntry>
		| undefined
	if (session && caches && (!cached || cached.content !== content)) {
		const bytes = content.length * 2 + 64
		if (bytes <= SOURCE_CACHE_LIMIT) {
			while (session.sucroseCacheBytes + bytes > SOURCE_CACHE_LIMIT) {
				const oldest = caches.keys().next().value
				if (oldest === undefined) break
				const removed = caches.get(oldest)
				caches.delete(oldest)
				if (removed) session.sucroseCacheBytes -= removed.bytes
			}

			const cacheKey = `${lane}:${key}`
			const previous = caches.get(cacheKey)
			if (previous) session.sucroseCacheBytes -= previous.bytes
			caches.set(cacheKey, { content, inference: immutable, bytes })
			session.sucroseCacheBytes += bytes
		}
	}
	if (typeof event === 'function') functionCache.set(event, immutable)
}

function clearCache() {
	const session = compilerSession()
	session?.sucroseCache.clear()
	if (session) session.sucroseCacheBytes = 0
	oracleFunctionCaches = new WeakMap()
	candidateFunctionCaches = new WeakMap()
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
		route: a.route || b.route
	}
}

const defaultSucrose = () => ({
	query: false,
	headers: false,
	body: false,
	cookie: false,
	set: false,
	route: false
})

function push(target: unknown[], array: unknown[]) {
	for (let i = 0; i < array.length; i++) target.push(array[i])
}

function pushParse(target: unknown[], array: unknown[]) {
	for (let i = 0; i < array.length; i++)
		if (typeof array[i] === 'function') target.push(array[i])
}

function collectInferenceEvents(
	handler: Handler | undefined,
	lifeCycle: Sucrose.LifeCycle | undefined
) {
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

	return events
}

function literalHeaderKeys(event: Function): readonly string[] | null {
	let source: string
	try {
		source = Function.prototype.toString.call(event)
	} catch {
		return null
	}

	if (
		Object.hasOwn(event, 'toString') ||
		source.includes('[native code]') ||
		/\b(?:arguments|eval)\b/.test(source)
	)
		return null

	const [parameter, body] = separateFunction(source)
	if (body === undefined) return null

	const keys = new Set<string>()
	const touchesHeaders = inferCandidateFunction(event).headers
	if (!touchesHeaders) return []
	if (parameter.includes('...') || parameter.includes('[')) return null

	let hasNested = false
	for (const nested of parameter.matchAll(/\bheaders\s*:\s*\{([^{}]*)\}/g)) {
		hasNested = true
		for (const item of nested[1].split(',')) {
			const key = item.trim().split(/\s*[:=]\s*/, 1)[0]
			if (!key) continue
			if (!/^[a-z_$][a-z0-9_$-]*$/.test(key)) return null
			keys.add(key)
		}
	}
	if (hasNested) return [...keys]

	const destructured =
		/^\s*\{[\s\S]*\bheaders\s*(?::\s*([A-Za-z_$][\w$]*))?[\s\S]*\}\s*$/.exec(
			parameter.trim()
		)
	const alias =
		destructured?.[1] ?? (destructured ? 'headers' : parameter.trim())
	if (!/^[A-Za-z_$][\w$]*$/.test(alias)) return null
	if (
		!destructured &&
		findAlias(alias, body).some(
			(candidate) => candidate.charCodeAt(0) === 123
		)
	)
		return null

	const escaped = alias.replace(/[$]/g, '\\$&')
	const channelSource = destructured
		? `\\b${escaped}`
		: `\\b${escaped}\\s*(?:\\?\\.\\s*)?\\.\\s*headers`
	const channel = new RegExp(channelSource + '\\b', 'g')
	const read = new RegExp(
		`${channelSource}\\s*(?:\\?\\.\\s*)?(?:\\.\\s*([A-Za-z_$][\\w$]*)|\\[\\s*(['\"])([^'\"]+)\\2\\s*\\])`,
		'g'
	)

	let channelCount = 0
	while (channel.exec(body)) channelCount++
	let readCount = 0
	for (let match: RegExpExecArray | null; (match = read.exec(body)); ) {
		const key = match[1] ?? match[3]
		if (
			!key ||
			key === 'set-cookie' ||
			key !== key.toLowerCase() ||
			!literalHeaderName.test(key)
		)
			return null
		keys.add(key)
		readCount++
	}

	if (channelCount !== readCount || readCount === 0) return null

	return [...keys]
}

export function inferHeaderKeys(
	handler: Handler | undefined,
	lifeCycle: Sucrose.LifeCycle | undefined
): readonly string[] | null {
	const keys = new Set<string>()
	for (const event of collectInferenceEvents(handler, lifeCycle)) {
		if (typeof event !== 'function') continue
		const inferred = literalHeaderKeys(event)
		if (inferred === null) return null
		for (const key of inferred) keys.add(key)
	}

	return [...keys]
}

export function sucroseOracle(
	handler: Handler | undefined,
	lifeCycle: Sucrose.LifeCycle | undefined
): Sucrose.Inference {
	let inference: Sucrose.Inference | undefined

	const events = collectInferenceEvents(handler, lifeCycle)

	const caches = compilerSession()?.sucroseCache as
		| Map<string, SourceCacheEntry>
		| undefined

	for (let i = 0; i < events.length; i++) {
		const event = events[i]
		if (!event) continue

		const memoized = oracleFunctionCaches.get(event as Function)
		if (memoized) {
			inference = inference
				? mergeInference(inference, memoized)
				: memoized
			continue
		}

		const content = event.toString()
		const key = String(fnv1a(content))
		const cacheKey = `oracle:${key}`
		const cached = caches?.get(cacheKey)
		if (cached && cached.content === content) {
			const cachedInference = cached.inference
			caches!.delete(cacheKey)
			caches!.set(cacheKey, cached)

			if (typeof event === 'function')
				oracleFunctionCaches.set(event, cachedInference)
			inference = inference
				? mergeInference(inference, cachedInference)
				: cachedInference
			continue
		}

		inference ??= defaultSucrose()

		const fnInference: Sucrose.Inference = defaultSucrose()

		if (content.includes('[native code]')) {
			markAllAccessed(fnInference)

			rememberInference(
				'oracle',
				key,
				cached,
				content,
				event,
				fnInference,
				oracleFunctionCaches
			)

			inference = mergeInference(inference, fnInference)
			continue
		}

		const [parameter, body] = separateFunction(content)

		if (body === undefined) {
			// Unknown case: parser could not extract body, degrade to all-true per contract
			markAllAccessed(fnInference)

			rememberInference(
				'oracle',
				key,
				cached,
				content,
				event,
				fnInference,
				oracleFunctionCaches
			)

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

		rememberInference(
			'oracle',
			key,
			cached,
			content,
			event,
			fnInference,
			oracleFunctionCaches
		)

		inference = mergeInference(inference, fnInference)

		if (
			inference &&
			inference.query &&
			inference.headers &&
			inference.body &&
			inference.cookie &&
			inference.set &&
			inference.route
		)
			break
	}

	// Fall back to defaults when no analysable events were found
	return inference ?? defaultSucrose()
}

type ScanToken = {
	k: 'i' | 's' | 'p'
	value: string
}

const prefixKeywords = new Set([
	'await',
	'case',
	'delete',
	'do',
	'else',
	'in',
	'instanceof',
	'new',
	'of',
	'return',
	'throw',
	'typeof',
	'void',
	'yield'
])

const isIdentifierStart = (char: number) =>
	(char >= 65 && char <= 90) ||
	(char >= 97 && char <= 122) ||
	char === 36 ||
	char === 95 ||
	char >= 128

const isIdentifierPart = (char: number) =>
	isIdentifierStart(char) || (char >= 48 && char <= 57)

function decodeIdentifier(value: string): string | undefined {
	if (!value.includes('\\u')) return value

	let decoded = ''
	for (let i = 0; i < value.length; i++) {
		if (value.charCodeAt(i) !== 92 || value.charCodeAt(i + 1) !== 117) {
			decoded += value[i]
			continue
		}

		i += 2
		let hex: string
		if (value.charCodeAt(i) === 123) {
			const end = value.indexOf('}', i + 1)
			if (end === -1) return
			hex = value.slice(i + 1, end)
			i = end
		} else {
			hex = value.slice(i, i + 4)
			if (hex.length !== 4) return
			i += 3
		}

		const codePoint = Number.parseInt(hex, 16)
		if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return
		decoded += String.fromCodePoint(codePoint)
	}

	return decoded
}

function scanTokens(source: string): ScanToken[] | undefined {
	const tokens: ScanToken[] = []
	let index = 0
	let canEndExpression = false

	const scanCode = (templateExpression = false): boolean => {
		let templateDepth = 0

		while (index < source.length) {
			const char = source.charCodeAt(index)

			if (char === 32 || char === 9 || char === 10 || char === 13) {
				index++
				continue
			}

			if (char === 92 && source.charCodeAt(index + 1) !== 117)
				return false

			if (char === 47) {
				const next = source.charCodeAt(index + 1)
				if (next === 47) {
					index += 2
					while (
						index < source.length &&
						source.charCodeAt(index) !== 10 &&
						source.charCodeAt(index) !== 13
					)
						index++
					continue
				}
				if (next === 42) {
					index += 2
					while (
						index + 1 < source.length &&
						!(
							source.charCodeAt(index) === 42 &&
							source.charCodeAt(index + 1) === 47
						)
					)
						index++
					if (index + 1 >= source.length) return false
					index += 2
					continue
				}

				if (!canEndExpression) {
					index++
					let escaped = false
					let characterClass = false
					let closed = false
					while (index < source.length) {
						const regexChar = source.charCodeAt(index++)
						if (escaped) {
							escaped = false
							continue
						}
						if (regexChar === 92) {
							escaped = true
							continue
						}
						if (regexChar === 91) characterClass = true
						else if (regexChar === 93) characterClass = false
						else if (regexChar === 47 && !characterClass) {
							closed = true
							break
						} else if (regexChar === 10 || regexChar === 13)
							return false
					}
					if (!closed) return false
					while (isIdentifierPart(source.charCodeAt(index))) index++
					canEndExpression = true
					continue
				}

				tokens.push({ k: 'p', value: '/' })
				index++
				canEndExpression = false
				continue
			}

			if (char === 34 || char === 39) {
				const quote = char
				const start = ++index
				let escaped = false
				while (index < source.length) {
					const stringChar = source.charCodeAt(index)
					if (escaped) escaped = false
					else if (stringChar === 92) escaped = true
					else if (stringChar === quote) break
					else if (stringChar === 10 || stringChar === 13)
						return false
					index++
				}
				if (index >= source.length) return false
				tokens.push({
					k: 's',
					value: source.slice(start, index)
				})
				index++
				canEndExpression = true
				continue
			}

			if (char === 96) {
				index++
				let closed = false
				while (index < source.length) {
					const templateChar = source.charCodeAt(index)
					if (templateChar === 92) {
						index += 2
						continue
					}
					if (templateChar === 96) {
						index++
						closed = true
						break
					}
					if (
						templateChar === 36 &&
						source.charCodeAt(index + 1) === 123
					) {
						index += 2
						canEndExpression = false
						if (!scanCode(true)) return false
						continue
					}
					index++
				}
				if (!closed) return false
				canEndExpression = true
				continue
			}

			if (
				isIdentifierStart(char) ||
				(char === 92 && source.charCodeAt(index + 1) === 117)
			) {
				const start = index
				if (char === 92) {
					index += 2
					if (source.charCodeAt(index) === 123) {
						const end = source.indexOf('}', index + 1)
						if (end === -1) return false
						index = end + 1
					} else {
						for (let digit = 0; digit < 4; digit++) {
							const hex = source.charCodeAt(index + digit)
							if (
								!(
									(hex >= 48 && hex <= 57) ||
									(hex >= 65 && hex <= 70) ||
									(hex >= 97 && hex <= 102)
								)
							)
								return false
						}
						index += 4
					}
				} else index++
				while (index < source.length) {
					const identifierChar = source.charCodeAt(index)
					if (isIdentifierPart(identifierChar)) {
						index++
						continue
					}
					if (
						identifierChar === 92 &&
						source.charCodeAt(index + 1) === 117
					) {
						index += 2
						if (source.charCodeAt(index) === 123) {
							const end = source.indexOf('}', index + 1)
							if (end === -1) return false
							index = end + 1
						} else {
							for (let digit = 0; digit < 4; digit++) {
								const hex = source.charCodeAt(index + digit)
								if (
									!(
										(hex >= 48 && hex <= 57) ||
										(hex >= 65 && hex <= 70) ||
										(hex >= 97 && hex <= 102)
									)
								)
									return false
							}
							index += 4
						}
						continue
					}
					break
				}
				const value = decodeIdentifier(source.slice(start, index))
				if (value === undefined) return false
				tokens.push({ k: 'i', value })
				canEndExpression = !prefixKeywords.has(value)
				continue
			}

			if (char >= 48 && char <= 57) {
				index++
				while (isIdentifierPart(source.charCodeAt(index))) index++
				canEndExpression = true
				continue
			}

			if (templateExpression) {
				if (char === 123) templateDepth++
				else if (char === 125) {
					if (templateDepth === 0) {
						index++
						return true
					}
					templateDepth--
				}
			}

			let value = source[index]
			const pair = source.slice(index, index + 2)
			const triple = source.slice(index, index + 3)
			if (triple === '...') value = triple
			else if (
				pair === '?.' ||
				pair === '=>' ||
				pair === '++' ||
				pair === '--'
			)
				value = pair
			tokens.push({ k: 'p', value })
			index += value.length
			if (value !== '++' && value !== '--')
				canEndExpression =
					value === ')' || value === ']' || value === '}'
		}

		return !templateExpression
	}

	return scanCode() ? tokens : undefined
}

const channel = (value: string): keyof Sucrose.Inference | undefined => {
	switch (value) {
		case 'query':
		case 'headers':
		case 'body':
		case 'cookie':
		case 'set':
		case 'route':
			return value
	}
}

function computedDestructuringChannel(
	tokens: ScanToken[],
	index: number
): false | keyof Sucrose.Inference {
	const property = tokens[index + 1]
	return (
		(property?.k === 's' &&
			!property.value.includes('\\') &&
			tokens[index + 2]?.value === ']' &&
			channel(property.value)) ||
		false
	)
}

function inferCandidateFunction(event: Function): Sucrose.Inference {
	const inference = defaultSucrose()

	if (Object.hasOwn(event, 'toString')) {
		markAllAccessed(inference)
		return inference
	}

	let source: string
	try {
		source = Function.prototype.toString.call(event)
	} catch {
		markAllAccessed(inference)
		return inference
	}

	if (
		source.includes('[native code]') ||
		source.trimStart().startsWith('class')
	) {
		markAllAccessed(inference)
		return inference
	}

	let tokens: ScanToken[] | undefined
	try {
		tokens = scanTokens(source)
	} catch {
		markAllAccessed(inference)
		return inference
	}
	if (!tokens?.length) {
		markAllAccessed(inference)
		return inference
	}

	let arrow = -1
	const callableStart = tokens[0].value === 'async' ? 1 : 0
	if (tokens[callableStart]?.value !== 'function') {
		let parentheses = 0
		let brackets = 0
		let braces = 0
		for (let i = callableStart; i < tokens.length; i++) {
			const value = tokens[i].value
			if (value === '(') parentheses++
			else if (value === ')') parentheses--
			else if (value === '[') brackets++
			else if (value === ']') brackets--
			else if (value === '{') {
				if (parentheses === 0 && brackets === 0 && braces === 0) break
				braces++
			} else if (value === '}') braces--
			else if (
				value === '=>' &&
				parentheses === 0 &&
				brackets === 0 &&
				braces === 0
			) {
				arrow = i
				break
			}
		}
	}

	let parameterStart = -1
	let parameterEnd = -1
	let bodyStart = -1
	if (arrow !== -1) {
		bodyStart = arrow + 1
		if (tokens[arrow - 1]?.value === ')') {
			let depth = 1
			for (let i = arrow - 2; i >= 0; i--) {
				if (tokens[i].value === ')') depth++
				else if (tokens[i].value === '(' && --depth === 0) {
					parameterStart = i + 1
					parameterEnd = arrow - 1
					break
				}
			}
		} else {
			parameterStart = arrow - 1
			parameterEnd = arrow
		}
	} else {
		for (let i = 0; i < tokens.length; i++)
			if (tokens[i].value === '(') {
				parameterStart = i + 1
				let depth = 1
				for (let j = i + 1; j < tokens.length; j++) {
					if (tokens[j].value === '(') depth++
					else if (tokens[j].value === ')' && --depth === 0) {
						parameterEnd = j
						bodyStart = j + 1
						break
					}
				}
				break
			}
	}

	if (parameterStart < 0 || parameterEnd < parameterStart || bodyStart < 0) {
		markAllAccessed(inference)
		return inference
	}

	const aliases = new Set<string>()
	const first = tokens[parameterStart]
	if (parameterStart === parameterEnd) {
		// A zero-parameter handler cannot name the context except through
		// `arguments`, which is handled conservatively in the body scan
	} else if (first?.k === 'i') aliases.add(first.value)
	else if (first?.value === '{') {
		let depth = 0
		for (let i = parameterStart; i < parameterEnd; i++) {
			const token = tokens[i]
			if (token.value === '{') depth++
			else if (token.value === '}') depth--
			else if (
				token.value === '[' &&
				depth === 1 &&
				(tokens[i - 1]?.value === '{' || tokens[i - 1]?.value === ',')
			) {
				const computed = computedDestructuringChannel(tokens, i)
				if (computed === false) {
					markAllAccessed(inference)
					return inference
				}
				if (computed) inference[computed] = true
			} else if (token.value === '...' && depth === 1) {
				const rest = tokens[i + 1]
				if (rest?.k === 'i') aliases.add(rest.value)
			} else if (token.k === 'i' && depth === 1) {
				const key = channel(token.value)
				if (key) inference[key] = true
			}
		}
	} else {
		markAllAccessed(inference)
		return inference
	}

	type Pattern = [
		channels: Set<false | keyof Sucrose.Inference>,
		rest?: string
	]
	const patterns: Pattern[] = []
	let closedPattern: Pattern | undefined

	for (let i = bodyStart; i < tokens.length; i++) {
		const token = tokens[i]
		if (token.value === '{') {
			patterns.push([new Set()])
			closedPattern = undefined
			continue
		}
		if (token.value === '}') {
			closedPattern = patterns.pop()
			continue
		}
		if (patterns.length) {
			const current = patterns[patterns.length - 1]
			if (
				token.value === '[' &&
				(tokens[i - 1]?.value === '{' || tokens[i - 1]?.value === ',')
			) {
				const computed = computedDestructuringChannel(tokens, i)
				current[0].add(computed)
			} else if (token.value === '...' && tokens[i + 1]?.k === 'i')
				current[1] = tokens[i + 1].value
			else if (token.k === 'i') {
				const key = channel(token.value)
				if (key) current[0].add(key)
			}
		}

		if (token.value === '=') {
			const right = tokens[i + 1]
			let member = i + 2
			if (tokens[member]?.value === '?.') member++
			if (
				right?.k === 'i' &&
				aliases.has(right.value) &&
				tokens[member]?.value !== '.' &&
				tokens[member]?.value !== '[' &&
				tokens[member]?.k !== 'i'
			) {
				const left = tokens[i - 1]
				if (left?.k === 'i') aliases.add(left.value)
				else if (left?.value === '}' && closedPattern) {
					for (const key of closedPattern[0]) {
						if (key === false) {
							markAllAccessed(inference)
							return inference
						}
						inference[key] = true
					}
					if (closedPattern[1]) aliases.add(closedPattern[1])
				}
			}
			continue
		}

		if (token.k !== 'i') continue
		if (token.value === 'arguments' || token.value === 'eval') {
			markAllAccessed(inference)
			break
		}
		if (!aliases.has(token.value)) continue

		let next = i + 1
		if (tokens[next]?.value === '?.') next++
		if (tokens[next]?.value === '.') next++

		if (tokens[next]?.k === 'i' && next > i + 1) {
			const key = channel(tokens[next].value)
			if (key) inference[key] = true
			continue
		}

		if (tokens[next]?.value === '[') {
			const property = tokens[next + 1]
			const key = property?.k === 's' && channel(property.value)
			if (key && tokens[next + 2]?.value === ']') inference[key] = true
			else markAllAccessed(inference)
			if (
				inference.query &&
				inference.headers &&
				inference.body &&
				inference.cookie &&
				inference.set &&
				inference.route
			)
				break
			continue
		}

		if (
			tokens[i - 1]?.value === '=' &&
			(tokens[i - 2]?.k === 'i' || tokens[i - 2]?.value === '}')
		)
			continue

		markAllAccessed(inference)
		break
	}

	return inference
}

export function sucroseCandidate(
	handler: Handler | undefined,
	lifeCycle: Sucrose.LifeCycle | undefined
): Sucrose.Inference {
	let inference: Sucrose.Inference | undefined
	const events = collectInferenceEvents(handler, lifeCycle)

	const caches = compilerSession()?.sucroseCache as
		| Map<string, SourceCacheEntry>
		| undefined
	for (let i = 0; i < events.length; i++) {
		const event = events[i] as Function
		if (!event) continue

		let inferred = candidateFunctionCaches.get(event)
		if (!inferred) {
			if (Object.hasOwn(event, 'toString')) {
				inferred = Object.freeze({ ...inferCandidateFunction(event) })
				candidateFunctionCaches.set(event, inferred)
				inference = inference
					? mergeInference(inference, inferred)
					: inferred
				continue
			}

			let content: string
			try {
				content = Function.prototype.toString.call(event)
			} catch {
				content = ''
			}
			const key = String(fnv1a(content))
			const cacheKey = `candidate:${key}`
			const cached = caches?.get(cacheKey)
			if (cached?.content === content) {
				inferred = cached.inference
				caches!.delete(cacheKey)
				caches!.set(cacheKey, cached)
				candidateFunctionCaches.set(event, inferred)
			} else {
				inferred = inferCandidateFunction(event)
				rememberInference(
					'candidate',
					key,
					cached,
					content,
					event,
					inferred,
					candidateFunctionCaches
				)
			}
		}

		inference = inference ? mergeInference(inference, inferred) : inferred
		if (
			inference.query &&
			inference.headers &&
			inference.body &&
			inference.cookie &&
			inference.set &&
			inference.route
		)
			break
	}

	return Object.freeze(inference ? { ...inference } : defaultSucrose())
}

const d1InferenceImplementation: Sucrose.Implementation =
	(globalThis as any).process?.env?.D1_VALIDATION_LANE === 'candidate'
		? 'candidate'
		: 'oracle'

export const D1_INFERENCE_IMPLEMENTATION = d1InferenceImplementation

export const sucrose = (
	handler: Handler | undefined,
	lifeCycle: Sucrose.LifeCycle | undefined,
	implementation: Sucrose.Implementation = d1InferenceImplementation
) =>
	implementation === 'candidate'
		? sucroseCandidate(handler, lifeCycle)
		: sucroseOracle(handler, lifeCycle)
