import { isAsyncFunction } from '../utils'
import {
	assignOwn,
	deriveEntryFn,
	deriveQueues,
	isMapDeriveEntry,
	isPlainDeriveEntry,
	occurrenceDeriveEntries,
	type CompactBeforeHandleChunk,
	type CompactBeforeHandlePrefix,
	type DeriveEntry
} from '../../utils'
import { skipClone } from '../../adapter/skip-clone'
import { origin } from '../../adapter/origin'
import { ElysiaStatus } from '../../error'
import { ElysiaFile } from '../../universal/file'
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
	// structuredClone drops the class and would serve the path as JSON
	if (ElysiaFile.isElysiaFile(value)) return value

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

const traceChild = (report: TraceReporter | undefined, fn: Function) =>
	report?.resolveChild(
		(fn as any)?.name && typeof (fn as any).name === 'string'
			? (fn as any).name
			: 'anonymous'
	) ?? noTrace

const toArray = <T>(v: MaybeArray<T>): T[] => (Array.isArray(v) ? v : [v])

export const mapTransform = /*#__PURE__*/ map<
	'transform',
	[mode: AsyncMode, report?: TraceReporter, arm?: string]
>((i, fn, [mode, report, arm]) => {
	const t = traceChild(report, fn)
	const call = mode
		? awaitSite(`tf${at(i)}(c)`, fn, mode, '_tf', arm)
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

	const isPunct = (i: number, value: string) =>
		tokens[i]?.k === 'p' && tokens[i].value === value

	const spaceOnlyAfter = (i: number) => {
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
			if (!spaceOnlyAfter(i)) return null
			if (isPunct(i + 1, '(')) {
				if (!spaceOnlyAfter(i + 1) || !isPunct(i + 2, '{')) return null
				open = i + 2
				parens = 1
			} else if (!isPunct(i + 1, '{')) return null
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

		for (; spaceOnlyAfter(at) && isPunct(at + 1, '('); at++) parens++
		if (!spaceOnlyAfter(at) || !isPunct(at + 1, '{')) return null
		open = at + 1
	}

	const keys: string[] = []
	let i = open + 1
	while (!isPunct(i, '}')) {
		const key = tokens[i]
		if (
			!key ||
			(key.k === 's'
				? key.value.includes('\\')
				: key.k !== 'i' || !/^[\w$]+$/.test(key.value)) ||
			!spaceOnlyAfter(i) ||
			!isPunct(i + 1, ':')
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

		if (isPunct(i, ',')) i++
	}

	// the literal must be the whole returned expression, not `({ a }).a`
	for (; parens; parens--) if (!isPunct(++i, ')')) return null

	return i + 1 === tokens.length || isPunct(i + 1, ';') || isPunct(i + 1, '}')
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
	const queues = deriveQueues(entries)
	if (!queues) return

	let found = false
	const modes: (boolean | undefined)[] = Array(hooks.length)

	for (let i = 0; i < hooks.length; i++) {
		const entry = queues.get(hooks[i]!)?.shift()
		// none left, or a plain occurrence ahead of this function's derive
		if (entry === undefined || isPlainDeriveEntry(entry)) continue

		modes[i] = isMapDeriveEntry(entry)
		found = true
	}

	return found ? modes : undefined
}

const deriveEntriesOf = (part: Partial<AppHook> | undefined) =>
	(part as { '~deriveEntries'?: DeriveEntry[] } | undefined)?.[
		'~deriveEntries'
	]

function sharesDerive(
	part: Partial<AppHook> | undefined,
	index: number,
	parts: readonly (Partial<AppHook> | undefined)[]
) {
	const entries = deriveEntriesOf(part)
	if (entries)
		for (let i = 0; i < parts.length; i++) {
			const other = parts[i]?.beforeHandle
			if (i === index || !other) continue

			for (let j = 0; j < entries.length; j++) {
				const fn = deriveEntryFn(entries[j]!)
				if (
					Array.isArray(other)
						? (other as Function[]).includes(fn)
						: other === fn
				)
					return true
			}
		}

	return false
}

/**
 * `~deriveEntries` of the `beforeHandle` lists of `parts` joined in order,
 * each occurrence keeping the role its own part gave it; undefined when
 * their own entries joined already do
 */
export function joinDeriveEntries(
	parts: readonly (Partial<AppHook> | undefined)[]
): DeriveEntry[] | undefined {
	if (!parts.some(sharesDerive)) return

	const hooks: Function[] = []
	let at: (DeriveEntry | undefined)[] | undefined

	for (const part of parts) {
		const value = part?.beforeHandle
		if (!value) continue

		const queues = deriveQueues(deriveEntriesOf(part))
		for (const fn of toArray(value) as Function[]) {
			const entry = queues?.get(fn)?.shift()
			// a plain occurrence ahead of this function's derive has no role
			if (entry !== undefined && !isPlainDeriveEntry(entry))
				(at ??= [])[hooks.length] = entry

			hooks.push(fn)
		}
	}

	if (at) return occurrenceDeriveEntries(hooks, at)
}

export function mapBeforeHandle(
	_hooks: AppHook['beforeHandle'] | AppHook['beforeHandle'][0],
	derive: readonly DeriveEntry[] | undefined,
	link: Link,
	mode: AsyncMode,
	report?: TraceReporter,
	abortGuard?: string,
	arm?: string
) {
	const hooks = toArray(_hooks)
	const modes = deriveModes(hooks, derive)
	const tail = asyncTail(mode)

	let code = ''
	let needsEs = false

	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]
		const guard =
			i > 0
				? `${abortGuard ? `!${abortGuard}&&` : ''}_r===undefined`
				: undefined

		if (tail) code += tailStage(tail, guard)
		else if (guard) code += `if(${guard}){\n`

		const t = traceChild(report, fn)
		code += t.begin
		code += awaitSite(`bf${at(i)}(c)`, fn, mode, 'tmp', arm)
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
		if (tail || guard) code += '}\n'
	}

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
	mode: AsyncMode,
	report?: TraceReporter,
	abortGuard?: string,
	arm?: string
) {
	const hooks = toArray(_hooks)
	const tail = asyncTail(mode)
	let code = ''

	for (let i = 0; i < hooks.length; i++) {
		const fn = hooks[i]
		const guard =
			i > 0
				? `${abortGuard ? `!${abortGuard}&&` : ''}tmp===undefined`
				: undefined

		if (tail) code += tailStage(tail, guard)
		else if (guard) code += `if(${guard}){\n`

		const t = traceChild(report, fn)
		code += t.begin
		code += awaitSite(`${prefix}${at(i)}(c)`, fn, mode, 'tmp', arm)
		code += t.end('tmp')
		if (tail || guard) code += '}\n'
	}

	code += tailPlain(mode, `if(tmp!==undefined)_r=c.responseValue=tmp\n`)
	return code
}

export const mapAfterResponse = /*#__PURE__*/ map<
	'afterResponse',
	[report?: TraceReporter]
>((i, fn, [report]) => {
	const t = traceChild(report, fn)
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
		mode: AsyncMode,
		arm?: string
	]
>((i, fn, [map, link, mapResponse, schedule, sign, mode, arm]) => {
	link(mapResponse, 'rm')
	link(adoptErrorType, 'aet')
	return (
		awaitSite(`er${at(i)}(c)`, fn, mode, '_r', arm) +
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
		abortGuard?: string,
		// the async tail flattens the chain into one resumable stage per hook
		tail?: TailMode
	) {
		if (Array.isArray(event)) {
			let code = ''

			for (let i = 0; i < event.length; i++) {
				const guard = i > 0 && abortGuard ? `!${abortGuard}` : undefined
				if (tail) code += tailStage(tail, guard)
				else if (guard) code += `if(${guard}){\n`
				code += map(i, event[i], rest as T)
				if (tail || guard) code += '}\n'
			}

			return code
		} else if (tail)
			return tailStage(tail) + map(undefined, event, rest as T) + '}\n'
		else return map(undefined, event, rest as T)
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

export type AsyncMode = boolean | TailMode

export interface TailMode {
	// rendering the async tail `_t`, not the sync route
	async: boolean
	// next await point index
	n: number
	// `_r` is live across await points
	r?: boolean
	// inside the error hooks: `e` is live
	e?: boolean
	// route-scope locals carried into the tail, each prefixed by `,`
	live: string
	// each await point's `target=call` (`e:` inside the error hooks), so the
	// route and its tail can be checked to be in step
	sites: string[]
}

export const asyncTail = (mode: AsyncMode) =>
	typeof mode === 'object' && mode.async ? mode : undefined

// `target=call`, then suspend if the result is a thenable
export function awaitSite(
	call: string,
	fn: Function,
	mode: AsyncMode,
	target: string,
	arm = ''
) {
	if (typeof mode !== 'object')
		return `${target}=${call}\n${awaitGuard(fn, mode, target, arm)}`

	const k = mode.n++
	mode.sites.push(`${mode.e ? 'e:' : ''}${target}=${call}`)

	return mode.async
		? `${target}=_rk===${k}?_y:${call}\n` +
				`if(_rk===${k}||typeof ${target}?.then==='function'){${arm ? `;${arm}\n` : ''}${target}=await ${target}}\n`
		: `${target}=${call}\n` +
				`if(typeof ${target}?.then==='function')return _t(c,${k},${target},${mode.r ? '_r' : 'undefined'},${mode.e ? 'e' : 'undefined'}${mode.live})\n`
}

export const tailStage = (mode: TailMode, guard?: string) =>
	`if(_rk<=${mode.n}${guard ? `&&(_rk===${mode.n}||${guard})` : ''}){\n`

export const tailPlain = (mode: AsyncMode, code: string) =>
	!code || !asyncTail(mode)
		? code
		: (mode as TailMode).n
			? `if(_rk<${(mode as TailMode).n}){\n${code}}\n`
			: ''

export function awaitGuard(
	fn: Function,
	mode: AsyncMode,
	target: string,
	arm = ''
) {
	if (!mode) return ''

	const code = `${arm ? `;${arm}\n` : ''}${target}=await ${target}\n`
	return isAsyncFunction(fn)
		? code
		: `if(typeof ${target}?.then==='function'){${code}}\n`
}
