import { fnv1a, evictOldestHalf } from './utils'
import { getCompilerSession } from './compile/aot'
import { scanTokens, type ScanToken } from './compile/lexer'

import type { Handler, AppHook } from './types'

export namespace Sucrose {
	export interface Inference {
		query: boolean
		headers: boolean
		body: boolean
		cookie: boolean
		set: boolean
		route: boolean
		afterResponse?: boolean
	}

	export type LifeCycle = Partial<Partial<AppHook>>
}

function markAllAccessed(i: Sucrose.Inference) {
	i.query = i.headers = i.body = i.cookie = i.set = i.route = true
	i.afterResponse = true
}

const isAllAccessed = (i: Sucrose.Inference) =>
	i.query &&
	i.headers &&
	i.body &&
	i.cookie &&
	i.set &&
	i.route &&
	i.afterResponse

const DEFAULT_CACHE_LIMIT = 1024

type SourceCache = Map<
	number,
	{ content: string; inference: Sucrose.Inference }
>

const globalSourceCache: SourceCache = new Map()

let functionCaches = new WeakMap<Function, Sucrose.Inference>()

export function clearSucroseCache() {
	globalSourceCache.clear()
	getCompilerSession()?.sucroseCache.clear()
	functionCaches = new WeakMap()
}

export const mergeInference = (
	a: Sucrose.Inference,
	b: Sucrose.Inference
): Sucrose.Inference => ({
	body: a.body || b.body,
	cookie: a.cookie || b.cookie,
	headers: a.headers || b.headers,
	query: a.query || b.query,
	set: a.set || b.set,
	route: a.route || b.route,
	...(a.afterResponse || b.afterResponse ? { afterResponse: true } : {})
})

const defaultSucrose = (): Sucrose.Inference => ({
	query: false,
	headers: false,
	body: false,
	cookie: false,
	set: false,
	route: false
})

const emptyInference = Object.freeze(defaultSucrose())

const channel = (value: string): keyof Sucrose.Inference | undefined => {
	switch (value) {
		case 'query':
		case 'headers':
		case 'body':
		case 'cookie':
		case 'set':
		case 'route':
			return value
		case 'defer':
			return 'afterResponse'
	}
}

function computedDestructuringChannel<K extends string>(
	tokens: ScanToken[],
	index: number,
	channelOf: (value: string) => K | undefined
): false | K {
	const property = tokens[index + 1]

	return (
		(property?.k === 's' &&
			!property.value.includes('\\') &&
			tokens[index + 2]?.value === ']' &&
			channelOf(property.value)) ||
		false
	)
}

/**
 * @internal Which `channelOf`-mapped members of a function's first parameter
 * the function may read, or `null` when any member may be read
 */
export function inferFunction<K extends string>(
	source: string,
	channelOf: (value: string) => K | undefined,
	// bail on any alias made by `=`: the scan does not follow it through a
	// member store, a forward use or an assignment inside an expression
	strict = false
): Set<K> | null {
	if (
		!source ||
		source.includes('[native code]') ||
		source.trimStart().startsWith('class')
	)
		return null

	let tokens: ScanToken[] | undefined
	try {
		tokens = scanTokens(source)
	} catch {
		return null
	}

	if (!tokens?.length) return null

	const keys = new Set<K>()

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

	if (parameterStart < 0 || parameterEnd < parameterStart || bodyStart < 0)
		return null

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
			// later parameters (message body, close code) never carry the context
			else if (token.value === ',' && depth === 0) break
			else if (
				token.value === '[' &&
				depth === 1 &&
				(tokens[i - 1]?.value === '{' || tokens[i - 1]?.value === ',')
			) {
				const computed = computedDestructuringChannel(
					tokens,
					i,
					channelOf
				)
				if (computed === false) return null
				keys.add(computed)
			} else if (token.value === '...' && depth === 1) {
				const rest = tokens[i + 1]
				if (rest?.k === 'i') aliases.add(rest.value)
			} else if (token.k === 'i' && depth === 1) {
				// `ws` is the WS context's self-reference: `({ ws })` binds
				// the whole context, so channels read through it must count
				if (
					token.value === 'ws' &&
					(tokens[i - 1]?.value === '{' ||
						tokens[i - 1]?.value === ',')
				) {
					const renamed =
						tokens[i + 1]?.value === ':' &&
						tokens[i + 2]?.k === 'i'
							? tokens[i + 2].value
							: token.value
					aliases.add(renamed)
					continue
				}

				const key = channelOf(token.value)
				if (key) keys.add(key)
			}
		}
	} else return null

	type Pattern = [channels: Set<false | K>, rest?: string]

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
				const computed = computedDestructuringChannel(
					tokens,
					i,
					channelOf
				)
				current[0].add(computed)
			} else if (token.value === '...' && tokens[i + 1]?.k === 'i')
				current[1] = tokens[i + 1].value
			else if (token.k === 'i') {
				const key = channelOf(token.value)
				if (key) current[0].add(key)
			}
		}

		if (token.value === '=') {
			const right = tokens[i + 1]
			let member = i + 2
			const optional = tokens[member]?.value === '?.'
			if (optional) member++
			if (
				right?.k === 'i' &&
				aliases.has(right.value) &&
				tokens[member]?.value !== '.' &&
				tokens[member]?.value !== '[' &&
				// without a semicolon, the next statement may start right here
				(tokens[member]?.k !== 'i' || (strict && !optional))
			) {
				const left = tokens[i - 1]
				if (left?.k === 'i') {
					if (strict) return null
					aliases.add(left.value)
				} else if (left?.value === '}' && closedPattern) {
					for (const key of closedPattern[0]) {
						if (key === false) return null
						keys.add(key)
					}
					if (closedPattern[1]) aliases.add(closedPattern[1])
				}
			}

			continue
		}

		if (token.k !== 'i') continue
		if (token.value === 'arguments' || token.value === 'eval') return null
		if (!aliases.has(token.value)) continue

		// template boundaries emit no token: in `tag`${c}`.x` the `.x` is
		// on the tag's result, and `c` escapes into `tag`
		if (i + 1 < tokens.length)
			for (let j = token.at + 1; j < tokens[i + 1].at; j++)
				if (source.charCodeAt(j) === 96) return null

		let next = i + 1
		if (tokens[next]?.value === '?.') next++
		if (tokens[next]?.value === '.') next++

		if (tokens[next]?.k === 'i' && next > i + 1) {
			const key = channelOf(tokens[next].value)
			if (key) keys.add(key)
			continue
		}

		if (tokens[next]?.value === '[') {
			const property = tokens[next + 1]
			const key = property?.k === 's' && channelOf(property.value)
			if (!key || tokens[next + 2]?.value !== ']') return null

			keys.add(key)
			continue
		}

		if (
			tokens[i - 1]?.value === '=' &&
			(tokens[i - 2]?.k === 'i' || tokens[i - 2]?.value === '}')
		)
			continue

		return null
	}

	return keys
}

// scanned after the handler, in order. `parse` also holds content-type names
const lifeCycleEvents = [
	'request',
	'beforeHandle',
	'parse',
	'error',
	'transform',
	'afterHandle',
	'mapResponse',
	'afterResponse'
] as const

export function sucrose(
	handler: Handler | undefined,
	lifeCycle: Sucrose.LifeCycle | undefined
): Sucrose.Inference {
	let inference: Sucrose.Inference | undefined
	let merged = false

	const events: Handler[] = []
	if (handler && typeof handler === 'function') events.push(handler)
	if (lifeCycle)
		for (const name of lifeCycleEvents) {
			const array = lifeCycle[name] as Handler[] | undefined
			if (array)
				for (let i = 0; i < array.length; i++)
					if (name !== 'parse' || typeof array[i] === 'function')
						events.push(array[i])
		}

	const session = getCompilerSession()
	const caches = session?.external
		? (session.sucroseCache as SourceCache)
		: globalSourceCache

	for (let i = 0; i < events.length; i++) {
		const event = events[i]
		if (!event) continue

		let inferred = functionCaches.get(event as Function)
		if (!inferred) {
			if (
				typeof event === 'function' &&
				Object.hasOwn(event, 'toString')
			) {
				// An own `toString` is a forged source: the real behavior
				// cannot be trusted from it, so widen every channel and memo
				// by identity only, never by content
				const forged = defaultSucrose()
				markAllAccessed(forged)

				inferred = Object.freeze(forged)
			} else {
				const content = event.toString()
				const key = fnv1a(content)
				const cached = caches.get(key)

				if (cached && cached.content === content) {
					inferred = cached.inference
					if (caches.size >= DEFAULT_CACHE_LIMIT) {
						caches.delete(key)
						caches.set(key, cached)
					}
				} else {
					const channels = inferFunction(content, channel)
					const fresh = defaultSucrose()
					if (channels) for (const c of channels) fresh[c] = true
					else markAllAccessed(fresh)

					inferred = Object.freeze(fresh)
					if (caches.size >= DEFAULT_CACHE_LIMIT)
						evictOldestHalf(caches)

					caches.set(key, { content, inference: inferred })
				}
			}

			if (typeof event === 'function') functionCaches.set(event, inferred)
		}

		if (inference) {
			inference = mergeInference(inference, inferred)
			merged = true
		} else inference = inferred

		if (isAllAccessed(inference)) break
	}

	// every `inferred` is already frozen, so a single-event result is returned as-is
	// Only new allocations still need sealing
	if (!inference) return emptyInference

	return merged ? Object.freeze(inference) : inference
}
