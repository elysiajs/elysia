import { isAsyncFunction } from '../utils'
import { ElysiaStatus } from '../../error'
import { ELYSIA_TYPES } from '../../type/constants'

import type { Link } from '../types'
import type { AnyElysia } from '../../base'
import type { ElysiaAdapter } from '../../adapter'
import type { AppEvent, AppHook, MaybeArray } from '../../types'

export interface TraceReporter {
	resolveChild(name: string): {
		begin: string
		end: (errBinding?: string) => string
	}
}

const childName = (fn: unknown) =>
	(fn as any)?.name && typeof (fn as any).name === 'string'
		? (fn as any).name
		: 'anonymous'

const noTrace = { begin: '', end: () => '' } as const

export const cloneResponse = (r: unknown) =>
	r instanceof Response ? r.clone() : r

const trace = (report: TraceReporter | undefined, fn: Function) =>
	report?.resolveChild(childName(fn)) ?? noTrace

const toArray = <T>(v: MaybeArray<T>): T[] => (Array.isArray(v) ? v : [v])

export const mapTransform = map<'transform', [report?: TraceReporter]>(
	(i, fn, [report]) => {
		const t = trace(report, fn)
		return t.begin + `${Await(fn)}tf${at(i)}(c)\n` + t.end()
	}
)

const deriveKeyCache = new WeakMap<Function, string[] | null>()

export function extractDeriveKeys(fn: Function) {
	const cached = deriveKeyCache.get(fn)
	if (cached !== undefined) return cached

	const result = scanDeriveKeys(fn)
	deriveKeyCache.set(fn, result)
	return result
}

function scanDeriveKeys(fn: Function) {
	let src: string
	try {
		src = Function.prototype.toString.call(fn)
	} catch {
		return null
	}

	if (src.includes('[native code]')) return null
	if (src.includes('...')) return null

	const objStart = findReturnedObjectStart(src)
	if (objStart === -1) return null

	return scanObjectLiteralKeys(src, objStart)
}

function findReturnedObjectStart(src: string) {
	const arrow = topLevelArrowIndex(src)
	if (arrow !== -1) {
		let i = arrow + 2
		while (i < src.length && isSpace(src[i])) i++

		if (src[i] === '(') {
			let j = i + 1

			while (j < src.length && isSpace(src[j])) j++
			if (src[j] === '{') return j

			// `=> (` not followed by an object literal → not a plain object
			// implicit return, bail.
			return -1
		}

		if (src[i] !== '{') return -1
		// `=> {` is a block body: fall through to the single-return logic below.
	}

	const returns = countReturns(src)
	if (returns !== 1) return -1

	const idx = returnKeywordIndex(src)
	if (idx === -1) return -1
	let i = idx + 6
	while (i < src.length && isSpace(src[i])) i++
	while (i < src.length && src[i] === '(') {
		i++
		while (i < src.length && isSpace(src[i])) i++
	}
	return src[i] === '{' ? i : -1
}

function topLevelArrowIndex(src: string): number {
	let depth = 0
	for (let i = 0; i < src.length; ) {
		const ch = src[i]
		if (ch === '"' || ch === "'" || ch === '`') {
			i = skipString(src, i)
			continue
		}

		if (ch === '/' && src[i + 1] === '/') {
			const nl = src.indexOf('\n', i)
			if (nl === -1) return -1
			i = nl + 1
			continue
		}

		if (ch === '/' && src[i + 1] === '*') {
			const end = src.indexOf('*/', i)
			if (end === -1) return -1
			i = end + 2
			continue
		}

		if (
			depth === 0 &&
			ch === 'f' &&
			src.startsWith('function', i) &&
			!isIdentChar(src[i - 1] ?? ' ') &&
			!isIdentChar(src[i + 8] ?? ' ')
		)
			return -1

		if (ch === '(' || ch === '[' || ch === '{') {
			depth++
			i++
			continue
		}

		if (ch === ')' || ch === ']' || ch === '}') {
			depth--
			i++
			continue
		}

		if (depth === 0 && ch === '=' && src[i + 1] === '>') return i
		i++
	}
	return -1
}

const isSpace = (ch: string) =>
	ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r'

const isIdentChar = (ch: string) =>
	(ch >= 'a' && ch <= 'z') ||
	(ch >= 'A' && ch <= 'Z') ||
	(ch >= '0' && ch <= '9') ||
	ch === '_' ||
	ch === '$'

function countReturns(src: string): number {
	let count = 0
	for (let i = 0; i < src.length; ) {
		const ch = src[i]
		if (ch === '"' || ch === "'" || ch === '`') {
			i = skipString(src, i)
			continue
		}

		if (ch === '/' && src[i + 1] === '/') {
			i = src.indexOf('\n', i)
			if (i === -1) break
			continue
		}

		if (ch === '/' && src[i + 1] === '*') {
			i = src.indexOf('*/', i)
			if (i === -1) break
			i += 2
			continue
		}

		if (
			ch === 'r' &&
			src.startsWith('return', i) &&
			!isIdentChar(src[i - 1] ?? ' ') &&
			!isIdentChar(src[i + 6] ?? ' ')
		) {
			count++
			i += 6
			continue
		}

		i++
	}
	return count
}

function returnKeywordIndex(src: string): number {
	for (let i = 0; i < src.length; ) {
		const ch = src[i]
		if (ch === '"' || ch === "'" || ch === '`') {
			i = skipString(src, i)
			continue
		}

		if (ch === '/' && src[i + 1] === '/') {
			const nl = src.indexOf('\n', i)
			if (nl === -1) break
			i = nl
			continue
		}

		if (ch === '/' && src[i + 1] === '*') {
			const end = src.indexOf('*/', i)
			if (end === -1) break
			i = end + 2
			continue
		}

		if (
			ch === 'r' &&
			src.startsWith('return', i) &&
			!isIdentChar(src[i - 1] ?? ' ') &&
			!isIdentChar(src[i + 6] ?? ' ')
		)
			return i

		i++
	}
	return -1
}

// Returns the index just past the closing quote
function skipString(src: string, start: number): number {
	const quote = src[start]
	let i = start + 1

	if (quote === '`') {
		while (i < src.length) {
			const ch = src[i]
			if (ch === '\\') {
				i += 2
				continue
			}

			if (ch === '`') return i + 1
			if (ch === '$' && src[i + 1] === '{') {
				// skip balanced `${ ... }`
				let depth = 1
				i += 2

				while (i < src.length && depth > 0) {
					const c = src[i]
					if (c === '"' || c === "'" || c === '`') {
						i = skipString(src, i)
						continue
					}

					if (c === '{') depth++
					else if (c === '}') depth--

					i++
				}

				continue
			}

			i++
		}

		return i
	}

	while (i < src.length) {
		const ch = src[i]
		if (ch === '\\') {
			i += 2
			continue
		}

		if (ch === quote) return i + 1
		i++
	}

	return i
}

function scanObjectLiteralKeys(src: string, open: number): string[] | null {
	const keys: string[] = []
	let i = open + 1
	let expectKey = true

	while (i < src.length) {
		const ch = src[i]

		if (isSpace(ch)) {
			i++
			continue
		}

		if (ch === '/' && src[i + 1] === '/') {
			const nl = src.indexOf('\n', i)
			if (nl === -1) return null
			i = nl + 1
			continue
		}

		if (ch === '/' && src[i + 1] === '*') {
			const end = src.indexOf('*/', i)
			if (end === -1) return null
			i = end + 2
			continue
		}

		if (ch === '}') return keys

		if (expectKey) {
			// computed key, spread, getter/setter/method → bail
			if (ch === '[') return null

			let key: string
			if (ch === '"' || ch === "'") {
				const end = skipString(src, i)
				key = src.slice(i + 1, end - 1)

				if (key.includes('\\')) return null
				i = end
			} else if (isIdentChar(ch) && !(ch >= '0' && ch <= '9')) {
				const start = i
				while (i < src.length && isIdentChar(src[i])) i++
				key = src.slice(start, i)
			} else {
				return null
			}

			let j = i
			while (j < src.length && isSpace(src[j])) j++
			if (src[j] !== ':') return null // shorthand / method / getter → bail

			keys.push(key)
			i = j + 1
			i = skipValue(src, i)

			if (i === -1) return null
			expectKey = false

			continue
		}

		if (ch === ',') {
			expectKey = true
			i++
			continue
		}

		return null
	}

	return null
}

function skipValue(src: string, i: number): number {
	let depth = 0
	while (i < src.length) {
		const ch = src[i]
		if (ch === '"' || ch === "'" || ch === '`') {
			i = skipString(src, i)
			continue
		}

		if (ch === '/' && src[i + 1] === '/') {
			const nl = src.indexOf('\n', i)
			if (nl === -1) return -1
			i = nl + 1
			continue
		}

		if (ch === '/' && src[i + 1] === '*') {
			const end = src.indexOf('*/', i)
			if (end === -1) return -1
			i = end + 2
			continue
		}

		if (ch === '{' || ch === '(' || ch === '[') {
			depth++
			i++
			continue
		}

		if (ch === '}' || ch === ')' || ch === ']') {
			if (depth === 0) {
				if (ch === '}') return i
				return -1
			}

			depth--
			i++
			continue
		}

		if (ch === ',' && depth === 0) return i
		i++
	}
	return -1
}

// `beforeHandle` / `afterHandle` / `mapResponse` all share a
// short-circuit shape: each successive hook runs ONLY if the previous
// one didn't set the gating var (`_r === undefined` or
// `tmp === undefined`). That cross-iteration state (depth tracking,
// closing brace count) doesn't fit the per-hook `map` HOF, so these
// stay as manual loops with `toArray` + `trace` for consistency.
export function mapBeforeHandle(
	_hooks: AppHook['beforeHandle'] | AppHook['beforeHandle'][0],
	derive: AnyElysia['~derive'],
	link: Link,
	report?: TraceReporter
) {
	const hooks = toArray(_hooks)

	let code = ''
	let depth = 0
	let needsEs = false

	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]
		if (i > 0) {
			code += `if(_r===undefined){\n`
			depth++
		}

		const t = trace(report, fn)
		code += t.begin
		code += `tmp=${Await(fn)}bf${at(i)}(c)\n`
		if (derive?.has(fn)) {
			needsEs = true
			const keys = extractDeriveKeys(fn)
			const merge =
				keys && keys.length
					? keys
							.map(
								(k) =>
									`c[${JSON.stringify(k)}]=tmp[${JSON.stringify(k)}]`
							)
							.join(';')
					: 'Object.assign(c,tmp)'
			code +=
				'if(tmp instanceof es)_r=tmp\n' +
				`else if(tmp){${merge};tmp=undefined}\n`
		} else code += 'if(tmp!==undefined)_r=tmp\n'
		code += t.end('tmp')
	}

	code += '}'.repeat(depth)
	if (needsEs) link(ElysiaStatus, 'es')

	return code
}

// afterHandle + mapResponse share this chain: run each hook until one returns
// a value, nesting `if(tmp===undefined)` guards. Only the emit prefix differs.
function mapChainHook(
	hooks: Function[],
	prefix: string,
	report?: TraceReporter
) {
	let code = ''
	let depth = 0

	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]
		if (i > 0) {
			code += `if(tmp===undefined){\n`
			depth++
		}

		const t = trace(report, fn)
		code += t.begin
		code += `tmp=${Await(fn)}${prefix}${at(i)}(c)\n`
		code += t.end('tmp')
	}

	code += '}'.repeat(depth)
	code += `if(tmp!==undefined)_r=c.responseValue=tmp\n`
	return code
}

export function mapAfterHandle(
	_hooks: AppHook['afterHandle'] | AppHook['afterHandle'][0],
	report?: TraceReporter
) {
	return mapChainHook(toArray(_hooks), 'af', report)
}

export const mapMapResponse = (
	_hooks: AppHook['mapResponse'] | AppHook['mapResponse'][0],
	report?: TraceReporter
) => mapChainHook(toArray(_hooks), 'mr', report)

// `try / catch` per hook so a thrown hook doesn't drop the rest
export const mapAfterResponse = map<'afterResponse', [report?: TraceReporter]>(
	(i, fn, [report]) => {
		const t = trace(report, fn)
		return (
			`try{` +
			t.begin +
			`${Await(fn)}ar${at(i)}(c)\n` +
			t.end() +
			`}catch(_e){` +
			t.end('_e') +
			`}\n`
		)
	}
)

export const mapError = map<
	'error',
	[
		map: string,
		link: Link,
		mapResponse: ElysiaAdapter['response']['map'],
		schedule: string,
		sign: string
	]
>((i, fn, [map, link, mapResponse, schedule, sign]) => {
	link(mapResponse, 'rm')
	return (
		`_r=${Await(fn)}er${at(i)}(c)\n` +
		`if(_r!==undefined){\n` +
		`if(_r?.status)c.set.status=_r.status\n` +
		`else if(c.set.status===undefined||c.set.status===200)c.set.status=500\n` +
		schedule +
		sign +
		`return ${map}(_r,c.set,c.request)\n` +
		`}\n`
	)
})

// NOTE: must stay a `function` declaration so `mapTransform`,
// `mapAfterResponse`, and `mapError` above can use it.
function map<Event extends AppEvent, T extends unknown[] = []>(
	map: (
		index: number | undefined,
		fn: AppHook[Event][0],
		rest: T
	) => string
) {
	return function (event: MaybeArray<AppHook[Event][0]>, rest?: T) {
		if (Array.isArray(event)) {
			let code = ''

			for (let i = 0; i < event.length; i++)
				code += map(i, event[i], rest as T)

			return code
		} else return map(undefined, event, rest as T)
	}
}

const at = (index: number | undefined) =>
	index === undefined ? '' : `[${index}]`

function arrayItemSchema(v: any): any {
	if (!v) return
	if (v.type === 'array' || v['~kind'] === 'Array') return v.items
	if (Array.isArray(v.anyOf))
		for (const x of v.anyOf) {
			const it = arrayItemSchema(x)
			if (it) return it
		}
}

function isObjectish(v: any) {
	if (!v) return false
	if (v.type === 'object' || v['~kind'] === 'Object') return true
	if (Array.isArray(v.anyOf)) return v.anyOf.some(isObjectish)

	return false
}

function containsArray(v: any, seen?: WeakSet<object>) {
	if (!v || typeof v !== 'object') return false
	if (seen?.has(v)) return false

	if (v.type === 'array' || v['~kind'] === 'Array') return true
	if (v['~elyTyp'] === ELYSIA_TYPES.ArrayString) return true

	for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
		const arr = v[key]
		if (Array.isArray(arr)) {
			seen ??= new WeakSet<object>()
			seen.add(v)
			for (const x of arr) if (containsArray(x, seen)) return true
		}
	}

	return false
}

interface QueryWalkState {
	array: Record<string, 1> | undefined
	object: Record<string, 1> | undefined
}

function getQueryParseArgsCollect(
	node: any,
	seen: WeakSet<object>,
	state: QueryWalkState
): void {
	if (!node || typeof node !== 'object' || seen.has(node)) return
	seen.add(node)

	const props = node.properties

	if (props)
		for (const k in props) {
			const v = props[k]
			const kind = v?.['~elyTyp']
			if (containsArray(v)) {
				;(state.array ??= {})[k] = 1

				const item = arrayItemSchema(v)
				if (item && isObjectish(item)) (state.object ??= {})[k] = 1
			}
			if (kind === ELYSIA_TYPES.ObjectString) (state.object ??= {})[k] = 1
		}

	for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
		const arr = node[key]
		if (Array.isArray(arr))
			for (const x of arr) getQueryParseArgsCollect(x, seen, state)
	}
}

// gather metadata for `parseQueryFromURL`
export function getQueryParseChannels(
	querySchema: any
): QueryWalkState | undefined {
	if (!querySchema) return

	const state: QueryWalkState = {
		array: undefined,
		object: undefined
	}

	getQueryParseArgsCollect(querySchema, new WeakSet(), state)

	if (!state.array && !state.object) return undefined

	return state
}

export function getQueryParseArgs(querySchema: any): string {
	const channels = getQueryParseChannels(querySchema)
	if (!channels) return ''

	const arrayProps = channels.array
	const objectProps = channels.object

	const arrLit = arrayProps ? `,${JSON.stringify(arrayProps)}` : ''
	const objLit = objectProps
		? `,${arrayProps ? '' : 'undefined,'}${JSON.stringify(objectProps)}`
		: ''

	return arrLit + objLit
}

export const Await = (fn: Function) => (isAsyncFunction(fn) ? 'await ' : '')
