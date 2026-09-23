import { isAsyncFunction } from '../utils'
import {
	assignOwn,
	deriveEntryFn,
	isMapDeriveEntry,
	type CompactBeforeHandleChunk,
	type CompactBeforeHandlePrefix,
	type DeriveEntry
} from '../../utils'
import { skipClone } from '../../adapter/skip-clone'
import { origin } from '../../adapter/origin'
import { ElysiaStatus } from '../../error'
import { adoptErrorType } from '../../handler/error'
import { ELYSIA_TYPES } from '../../type/constants'
import { scanTokens } from '../lexer'
import { registerDeriveDisposable } from '../../handler/utils'

import type { ElysiaAdapter } from '../../adapter'
import type { AppEvent, AppHook, MaybeArray } from '../../types'

export type Link = (v: unknown, key: string) => void

export interface TraceReporter {
	resolveChild(name: string): {
		begin: string
		end: (errBinding?: string) => string
	}
}

const noTrace = { begin: '', end: () => '' } as const

export function cloneResponse(r: unknown) {
	if (r instanceof Response) {
		const cloned = r.clone()
		skipClone.add(cloned)
		return cloned
	}

	return r
}

export function cloneStaticValue(value: unknown) {
	try {
		const cloned = structuredClone(value)
		if (Object.getPrototypeOf(value) === ElysiaStatus.prototype)
			Object.setPrototypeOf(cloned, ElysiaStatus.prototype)

		return cloned
	} catch {
		return value
	}
}

export function hasRequestBody(request: Request) {
	const length = request.headers.get('content-length')
	if (length !== null) return length !== '0'
	if (request.headers.get('transfer-encoding') !== null) return true

	return request.body != null
}

/**
 * Route-entry abort probe. Mirrors `createFetchHandler`'s `armEager`, but is
 * paid only by routes that can actually observe an abort, so a hook-less
 * route never materializes `request.signal` on any lane.
 *
 * @see `../../adapter/origin` for the provenance channel
 */
export function armEntryAbort(context: any) {
	const sig = context['~sig']
	if (sig !== undefined) return sig.aborted === true
	if (context.request === origin.request) return false

	return (context['~sig'] = context.request.signal).aborted
}

const trace = (report: TraceReporter | undefined, fn: Function) =>
	report?.resolveChild(
		(fn as any)?.name && typeof (fn as any).name === 'string'
			? (fn as any).name
			: 'anonymous'
	) ?? noTrace

const toArray = <T>(v: MaybeArray<T>): T[] => (Array.isArray(v) ? v : [v])

export const mapTransform = /*#__PURE__*/ map<
	'transform',
	[isAsync: AsyncMode, report?: TraceReporter, arm?: string]
>((i, fn, [isAsync, report, arm]) => {
	const t = trace(report, fn)
	const call = isAsync
		? `_tf=tf${at(i)}(c)\n${awaitGuard(fn, isAsync, '_tf', arm)}`
		: `tf${at(i)}(c)\n`

	return t.begin + call + t.end()
})

const deriveKeyCache = new WeakMap<Function, string[] | null>()

function extractDeriveKeys(fn: Function) {
	const cached = deriveKeyCache.get(fn)
	if (cached !== undefined) return cached

	let src: string | undefined
	try {
		src = Function.prototype.toString.call(fn)
	} catch {
		src = undefined
	}

	const result =
		src === undefined ||
		src.includes('[native code]') ||
		src.includes('...')
			? null
			: returnedObjectKeys(src)

	deriveKeyCache.set(fn, result)
	return result
}

// Keys of the plain object literal `src` returns, `null` when unprovable:
// computed, numeric, shorthand, method or escaped key, several returns, a
// comment inside `=> ({` / `return ({` / `key:`, trailing expression
function returnedObjectKeys(src: string): string[] | null {
	const tokens = scanTokens(src)
	if (!tokens) return null

	const is = (i: number, value: string) =>
		tokens[i]?.k === 'p' && tokens[i].value === value

	const blank = (i: number) => {
		const token = tokens[i]

		return /^[ \t\n\r]*$/.test(
			src.slice(
				token.at + token.value.length + (token.k === 's' ? 2 : 0),
				tokens[i + 1]?.at
			)
		)
	}

	// the returned `{`, and how many `(` wrap it
	let open = -1
	let parens = 0
	let depth = 0
	for (let i = 0; i < tokens.length; i++) {
		const { k, value } = tokens[i]
		if (k === 'i') {
			if (depth === 0 && value === 'function') break
		} else if (k !== 'p') continue
		else if (value === '(' || value === '[' || value === '{') depth++
		else if (value === ')' || value === ']' || value === '}') depth--
		else if (depth === 0 && value === '=>') {
			if (!blank(i)) return null
			if (is(i + 1, '(')) {
				if (!blank(i + 1) || !is(i + 2, '{')) return null
				open = i + 2
				parens = 1
			} else if (!is(i + 1, '{')) return null
			break
		}
	}

	// block body: the single `return`, then `(`* `{`
	if (open === -1) {
		let at = -1
		for (let i = 0; i < tokens.length; i++) {
			const { k, value } = tokens[i]
			if (k !== 'i') continue
			if (value === 'return') {
				if (at !== -1) return null
				at = i
			}
			// kept generic: an ASCII word-boundary `return` scan would count
			// the one inside `éreturn` as a second return
			else if (value.includes('return') && /[^\w$]/.test(value))
				return null
		}
		if (at === -1) return null

		for (; blank(at) && is(at + 1, '('); at++) parens++
		if (!blank(at) || !is(at + 1, '{')) return null
		open = at + 1
	}

	const keys: string[] = []
	let i = open + 1
	while (!is(i, '}')) {
		const key = tokens[i]
		if (
			!key ||
			(key.k === 's'
				? key.value.includes('\\')
				: key.k !== 'i' || !/^[\w$]+$/.test(key.value)) ||
			!blank(i) ||
			!is(i + 1, ':')
		)
			return null

		keys.push(key.value)

		// the value runs to the `,` or `}` closing it at depth 0
		for (depth = 0, i += 2; ; i++) {
			const token = tokens[i]
			if (!token) return null
			if (token.k !== 'p') continue

			const { value } = token
			if (value === '(' || value === '[' || value === '{') depth++
			else if (value === ')' || value === ']' || value === '}') {
				if (depth === 0) {
					if (value !== '}') return null
					break
				}
				depth--
			} else if (value === ',' && depth === 0) break
		}

		if (is(i, ',')) i++
	}

	// the literal must be the whole returned expression, not `({ a }).a`
	for (; parens; parens--) if (!is(++i, ')')) return null

	return i + 1 === tokens.length || is(i + 1, ';') || is(i + 1, '}')
		? keys
		: null
}

export function replaceDeriveContext(context: any, derivative: any) {
	const next = Object.create(Object.getPrototypeOf(context))
	// an own `__proto__` would reach the inherited setter and reparent the
	// context — `assignOwn` defines it as inert data instead
	assignOwn(next, derivative)

	next.request = context.request
	next['~sig'] = context['~sig']
	next['~afterResponse'] = context['~afterResponse']
	next['~dispose'] = context['~dispose']
	next.store = context.store
	next.set = context.set
	next.body = context.body
	next.query = context.query
	next.params = context.params
	next.headers = context.headers
	next.cookie = context.cookie
	next.server = context.server
	next.path = context.path
	next.route = context.route
	next.rid = context.rid
	next.trace = context.trace
	next.qi = context.qi
	next.responseValue = context.responseValue
	next.error = context.error
	next.status = context.status
	next.redirect = context.redirect

	return next
}

export function deriveModes(
	hooks: Function[],
	entries?: readonly DeriveEntry[]
) {
	let queues: Map<Function, boolean[]> | undefined
	if (entries?.length) {
		queues = new Map<Function, boolean[]>()

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i]
			const fn = deriveEntryFn(entry)
			const queue = queues.get(fn)
			const mode = isMapDeriveEntry(entry)

			if (queue) queue.push(mode)
			else queues.set(fn, [mode])
		}
	}
	if (!queues) return

	let found = false
	const modes: (boolean | undefined)[] = Array(hooks.length)

	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]
		const queue = queues.get(fn)
		if (!queue?.length) continue

		found = true
		modes[i] = queue.shift()
	}

	return found ? modes : undefined
}

export function mapBeforeHandle(
	_hooks: AppHook['beforeHandle'] | AppHook['beforeHandle'][0],
	derive: readonly DeriveEntry[] | undefined,
	link: Link,
	isAsync: AsyncMode,
	report?: TraceReporter,
	abortGuard?: string,
	arm?: string
) {
	const hooks = toArray(_hooks)
	const modes = deriveModes(hooks, derive)

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
		code += `tmp=bf${at(i)}(c)\n`
		code += awaitGuard(fn, isAsync, 'tmp', arm)
		if (modes?.[i] !== undefined) {
			needsEs = true
			link(registerDeriveDisposable, 'dsp')

			if (modes[i]) {
				link(replaceDeriveContext, 'rdc')
				// the pre-swap context is the reference for "already there"
				code +=
					'if(tmp instanceof es)_r=tmp\n' +
					"else if(tmp){if(typeof tmp==='object'||typeof tmp==='function'){const _pc=c;c=rdc(c,tmp);for(const _k of Object.keys(tmp))dsp(c,c[_k],_pc)}tmp=undefined}\n"
			} else {
				const keys = extractDeriveKeys(fn)
				const keyed =
					!!keys && !!keys.length && !keys.includes('__proto__')
				// keyed: one read per key, registered before assignment, so the
				// registered instance is the one the context exposes
				const merge = keyed
					? keys!
							.map(
								(k) =>
									`_v=tmp[${JSON.stringify(k)}];dsp(c,_v);c[${JSON.stringify(k)}]=_v`
							)
							.join(';')
					: "if(Object.hasOwn(tmp,'__proto__')){for(const _k of Object.keys(tmp))dsp(c,tmp[_k]);Object.defineProperties(c,Object.getOwnPropertyDescriptors(tmp))}else{_v=Object.assign({},tmp);for(const _k of Reflect.ownKeys(_v)){dsp(c,_v[_k]);c[_k]=_v[_k]}}"
				code +=
					'if(tmp instanceof es)_r=tmp\n' +
					`else if(tmp){${merge};tmp=undefined}\n`
			}
		} else code += 'if(tmp!==undefined)_r=tmp\n'

		code += t.end('tmp')
	}

	code += '}'.repeat(depth)
	if (needsEs) link(ElysiaStatus, 'es')

	return code
}

const compactBeforeHandleChunks = (prefix: CompactBeforeHandlePrefix) => {
	const chunks: CompactBeforeHandleChunk[] = []
	for (let chunk = prefix.tail; chunk; chunk = chunk.parent)
		chunks.push(chunk)

	return chunks
}

type BeforeHandleContext = { request: Request; '~sig'?: AbortSignal }

export function runBeforeHandlePrefix(
	prefix: CompactBeforeHandlePrefix,
	context: BeforeHandleContext,
	// Elysia config: abortSignal
	abort?: 1
) {
	const chunks = compactBeforeHandleChunks(prefix)
	let first = true

	for (let i = chunks.length - 1; i >= 0; i--) {
		const values = chunks[i]!.values
		for (let j = 0; j < values.length; j++) {
			if (!first && abort && context['~sig']?.aborted) return
			first = false
			const result = values[j]!(context)
			if (result !== undefined) return result
		}
	}
}

export async function runBeforeHandlePrefixAsync(
	prefix: CompactBeforeHandlePrefix,
	context: BeforeHandleContext,
	abort?: 1
) {
	const chunks = compactBeforeHandleChunks(prefix)
	let first = true

	for (let i = chunks.length - 1; i >= 0; i--) {
		const values = chunks[i]!.values
		for (let j = 0; j < values.length; j++) {
			if (!first && abort && context['~sig']?.aborted) return
			first = false
			let result = values[j]!(context)
			if (typeof (result as any)?.then === 'function') {
				result = await result
				// arm at the suspension so the next iteration's peek is exact
				if (abort) context['~sig'] ??= context.request.signal
			}
			if (result !== undefined) return result
		}
	}
}

export function mapChainHook(
	_hooks: Function | Function[],
	prefix: string,
	isAsync: AsyncMode,
	report?: TraceReporter,
	abortGuard?: string,
	arm?: string
) {
	const hooks = toArray(_hooks)
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
		code += `tmp=${prefix}${at(i)}(c)\n`
		code += awaitGuard(fn, isAsync, 'tmp', arm)
		code += t.end('tmp')
	}

	code += '}'.repeat(depth)
	code += `if(tmp!==undefined)_r=c.responseValue=tmp\n`
	return code
}

export const mapAfterResponse = /*#__PURE__*/ map<
	'afterResponse',
	[report?: TraceReporter]
>((i, fn, [report]) => {
	const t = trace(report, fn)
	const call = isAsyncFunction(fn)
		? `await ar${at(i)}(c)\n`
		: `let _ar=ar${at(i)}(c)\nif(typeof _ar?.then==='function')await _ar\n`

	return `try{${t.begin}${call}${t.end()}}catch(_e){${t.end('_e')}console.error(_e)}\n`
})

export const mapError = /*#__PURE__*/ map<
	'error',
	[
		map: string,
		link: Link,
		mapResponse: ElysiaAdapter['response']['map'],
		schedule: string,
		sign: string,
		isAsync: AsyncMode,
		arm?: string
	]
>((i, fn, [map, link, mapResponse, schedule, sign, isAsync, arm]) => {
	link(mapResponse, 'rm')
	link(adoptErrorType, 'aet')
	return (
		`_r=er${at(i)}(c)\n` +
		awaitGuard(fn, isAsync, '_r', arm) +
		`if(_r!==undefined){\n` +
		`if(_r instanceof Response)c.set.status=_r.status\n` +
		`else if(c.set.status===undefined||c.set.status===200)c.set.status=500\n` +
		schedule +
		sign +
		`return _em(c,${map}(aet(_r,e),c.set,c.request,true))\n` +
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
) {
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
const queryParseChannelsCache = new WeakMap<object, QueryWalkState | null>()

export function getQueryParseChannels(
	querySchema: any
): QueryWalkState | undefined {
	if (!querySchema || typeof querySchema !== 'object') return

	const cached = queryParseChannelsCache.get(querySchema)
	if (cached !== undefined) return cached ?? undefined

	const state: QueryWalkState = {
		array: undefined,
		object: undefined
	}

	getQueryParseArgsCollect(querySchema, new WeakSet(), state)

	const result = state.array || state.object ? state : null
	queryParseChannelsCache.set(querySchema, result)

	return result ?? undefined
}

/**
 * How a compiled route suspends on a value that may be a thenable:
 * `await` in an `async` route, `yield` in a sync-first generator route
 * (driven by {@link resumeRoute}), nothing in a sync route
 */
export type AsyncMode = boolean | 'yield'

/**
 * Continues a sync-first route after its first real thenable
 *
 * A route whose callbacks only *might* return a promise is compiled as a
 * generator that yields exactly the values that are thenables. It runs to
 * completion synchronously until one is, and only then pays for async.
 */
export async function resumeRoute(
	route: Generator<unknown, unknown, unknown>,
	pending: unknown
) {
	while(true) {
		let value: unknown
		let failed = false

		try {
			value = await pending
		} catch (error) {
			value = error
			failed = true
		}

		const next = failed ? route.throw(value) : route.next(value)
		if (next.done) return next.value

		pending = next.value
	}
}

export function awaitGuard(
	fn: Function,
	isAsync: AsyncMode,
	target: string,
	arm = ''
) {
	if (!isAsync) return ''
	const code = `${arm ? `;${arm}\n` : ''}${target}=${isAsync === 'yield' ? `(yield ${target})` : `await ${target}`}\n`
	return isAsyncFunction(fn)
		? code
		: `if(typeof ${target}?.then==='function'){${code}}\n`
}
