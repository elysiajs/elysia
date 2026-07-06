import { isAsyncFunction } from '../utils'
import { skipClone } from '../../adapter/skip-clone'
import { ElysiaStatus } from '../../error'
import { ELYSIA_TYPES } from '../../type/constants'
import { isSpace, isIdentChar, skipString } from '../lexer'
export { emptyResponse } from '../../handler/utils'

import type { ElysiaAdapter } from '../../adapter'
import type { AppEvent, AppHook, MaybeArray } from '../../types'

export type Link = (v: unknown, key: string) => void

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

export function cloneResponse(r: unknown) {
	if (r instanceof Response) {
		const cloned = r.clone()
		skipClone.add(cloned)
		return cloned
	}

	return r
}

export function hasRequestBody(request: Request) {
	const length = request.headers.get('content-length')
	if (length !== null) return length !== '0'
	if (request.headers.get('transfer-encoding') !== null) return true

	return request.body != null
}

const trace = (report: TraceReporter | undefined, fn: Function) =>
	report?.resolveChild(childName(fn)) ?? noTrace

const toArray = <T>(v: MaybeArray<T>): T[] => (Array.isArray(v) ? v : [v])

export const mapTransform = /*#__PURE__*/ map<
	'transform',
	[isAsync: boolean, report?: TraceReporter]
>((i, fn, [isAsync, report]) => {
	const t = trace(report, fn)
	const guard = awaitGuard(fn, isAsync, '_tf')
	const call = guard
		? `_tf=tf${at(i)}(c)\n${guard}`
		: `${Await(fn)}tf${at(i)}(c)\n`

	return t.begin + call + t.end()
})

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

	const { count: returns, firstIndex: idx } = scanReturns(src)
	if (returns !== 1) return -1

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


function scanReturns(src: string): { count: number; firstIndex: number } {
	let count = 0
	let firstIndex = -1
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
		) {
			if (firstIndex === -1) firstIndex = i
			count++
			i += 6
			continue
		}

		i++
	}
	return { count, firstIndex }
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

export function mapBeforeHandle(
	_hooks: AppHook['beforeHandle'] | AppHook['beforeHandle'][0],
	derive: Set<Function> | undefined,
	link: Link,
	isAsync: boolean,
	report?: TraceReporter,
	abortGuard?: string
) {
	const hooks = toArray(_hooks)

	let code = ''
	let depth = 0
	let needsEs = false

	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]
		if (i > 0) {
			code += `if(${abortGuard ? `!${abortGuard}&&` : ''}_r===undefined){\n`
			depth++
		}

		const t = trace(report, fn)
		code += t.begin
		code += `tmp=${Await(fn)}bf${at(i)}(c)\n`
		code += awaitGuard(fn, isAsync, 'tmp')
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

function mapChainHook(
	hooks: Function[],
	prefix: string,
	isAsync: boolean,
	report?: TraceReporter,
	abortGuard?: string
) {
	let code = ''
	let depth = 0

	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]
		if (i > 0) {
			code += `if(${abortGuard ? `!${abortGuard}&&` : ''}tmp===undefined){\n`
			depth++
		}

		const t = trace(report, fn)
		code += t.begin
		code += `tmp=${Await(fn)}${prefix}${at(i)}(c)\n`
		code += awaitGuard(fn, isAsync, 'tmp')
		code += t.end('tmp')
	}

	code += '}'.repeat(depth)
	code += `if(tmp!==undefined)_r=c.responseValue=tmp\n`
	return code
}

export const mapAfterHandle = (
	_hooks: AppHook['afterHandle'] | AppHook['afterHandle'][0],
	isAsync: boolean,
	report?: TraceReporter,
	abortGuard?: string
) => mapChainHook(toArray(_hooks), 'af', isAsync, report, abortGuard)

export const mapMapResponse = (
	_hooks: AppHook['mapResponse'] | AppHook['mapResponse'][0],
	isAsync: boolean,
	report?: TraceReporter,
	abortGuard?: string
) => mapChainHook(toArray(_hooks), 'mr', isAsync, report, abortGuard)

export const mapAfterResponse = /*#__PURE__*/ map<
	'afterResponse',
	[report?: TraceReporter]
>((i, fn, [report]) => {
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
})

export const mapError = /*#__PURE__*/ map<
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
		`if(_r instanceof Response)c.set.status=_r.status\n` +
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
	map: (index: number | undefined, fn: AppHook[Event][0], rest: T) => string
) {
	return function (
		event: MaybeArray<AppHook[Event][0]>,
		rest?: T,
		abortGuard?: string
	) {
		if (Array.isArray(event)) {
			let code = ''
			let depth = 0

			for (let i = 0; i < event.length; i++) {
				if (i > 0 && abortGuard) {
					code += `if(!${abortGuard}){\n`
					depth++
				}
				code += map(i, event[i], rest as T)
			}

			code += '}'.repeat(depth)
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

function containsObjectSchema(v: any) {
	if (!v) return false
	if (v.type === 'object' || v['~kind'] === 'Object') return true
	if (Array.isArray(v.anyOf)) return v.anyOf.some(containsObjectSchema)

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
			const isArray = containsArray(v)

			if (isArray) {
				;(state.array ??= Object.create(null))[k] = 1
			}

			if (
				(isArray && containsObjectSchema(arrayItemSchema(v))) ||
				v?.['~elyTyp'] === ELYSIA_TYPES.ObjectString
			) {
				;(state.object ??= Object.create(null))[k] = 1
			}
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

const Await = (fn: Function) => (isAsyncFunction(fn) ? 'await ' : '')

const awaitGuard = (fn: Function, isAsync: boolean, target: string) =>
	isAsync && !isAsyncFunction(fn)
		? `if(${target} instanceof Promise)${target}=await ${target}\n`
		: ''
