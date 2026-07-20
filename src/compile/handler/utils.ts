import { isAsyncFunction } from '../utils'
import {
	deriveEntryFn,
	isMapDeriveEntry,
	type CompactBeforeHandlePrefix,
	type DeriveEntry
} from '../../utils'
import { ElysiaStatus } from '../../error'
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
	if (r instanceof Response) return r.clone()

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
	[isAsync: boolean, report?: TraceReporter, suspensionAbort?: string]
>((i, fn, [isAsync, report, suspensionAbort]) => {
	const t = trace(report, fn)
	if (suspensionAbort && report) {
		if (isAsyncFunction(fn))
			return (
				t.begin +
				`try{await tf${at(i)}(c)}catch(_e){${t.end('_e')}${suspensionAbort}throw _e}\n` +
				t.end() +
				suspensionAbort
			)

		if (isAsync)
			return (
				t.begin +
				`_tf=tf${at(i)}(c)\n` +
				`if(_tf instanceof Promise){try{_tf=await _tf}catch(_e){${t.end('_e')}${suspensionAbort}throw _e}\n${t.end()}${suspensionAbort}}else{${t.end()}}\n`
			)
	}

	const guard = awaitGuard(fn, isAsync, '_tf', suspensionAbort)
	const call = guard
		? `_tf=tf${at(i)}(c)\n${guard}`
		: isAsyncFunction(fn) && suspensionAbort
			? `try{await tf${at(i)}(c)}catch(_e){${suspensionAbort}throw _e}\n${suspensionAbort}`
			: `${Await(fn)}tf${at(i)}(c)\n`

	return t.begin + call + t.end()
})

let deriveKeyCache = new WeakMap<Function, string[] | null>()

export const clearHandlerUtilityAnalysisCaches = () => {
	deriveKeyCache = new WeakMap()
}

export function extractDeriveKeys(fn: Function) {
	const cached = deriveKeyCache.get(fn)
	if (cached !== undefined) return cached

	const result = scanDeriveKeys(fn)
	deriveKeyCache.set(fn, result)
	return result
}

export function replaceDeriveContext(context: any, derivative: any) {
	if (context === derivative) return context

	const mapped = Object.assign(Object.create(null), derivative)

	const request = context.request
	const store = context.store
	const set = context.set
	const body = context.body
	const query = context.query
	const params = context.params
	const headers = context.headers
	const cookie = context.cookie
	const server = context.server
	const path = context.path
	const route = context.route
	const rid = context.rid
	const trace = context.trace
	const qi = context.qi
	const responseValue = context.responseValue
	const error = context.error
	const status = context.status
	const redirect = context.redirect

	for (const key of Reflect.ownKeys(context)) delete context[key]
	Object.assign(context, mapped)

	context.request = request
	context.store = store
	context.set = set
	context.body = body
	context.query = query
	context.params = params
	context.headers = headers
	context.cookie = cookie
	context.server = server
	context.path = path
	context.route = route
	context.rid = rid
	context.trace = trace
	context.qi = qi
	context.responseValue = responseValue
	context.error = error
	context.status = status
	context.redirect = redirect

	return context
}

function deriveModeQueues(entries?: readonly DeriveEntry[]) {
	if (!entries?.length) return

	const queues = new Map<Function, boolean[]>()

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]
		const fn = deriveEntryFn(entry)
		const queue = queues.get(fn)
		const mode = isMapDeriveEntry(entry)

		if (queue) queue.push(mode)
		else queues.set(fn, [mode])
	}

	return queues
}

export function deriveModes(
	hooks: Function[],
	entries?: readonly DeriveEntry[]
) {
	const queues = deriveModeQueues(entries)
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
	derive: readonly DeriveEntry[] | undefined,
	link: Link,
	isAsync: boolean,
	report?: TraceReporter,
	abortGuard?: string,
	suspensionAbort?: string
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
		let closedAtBoundary = false
		if (isAsyncFunction(fn) && suspensionAbort) {
			code += `try{tmp=await bf${at(i)}(c)}catch(_e){${t.end('_e')}${suspensionAbort}throw _e}\n${t.end('tmp')}${suspensionAbort}`
			closedAtBoundary = !!report
		} else if (isAsync && suspensionAbort && report) {
			code +=
				`tmp=bf${at(i)}(c)\n` +
				`if(tmp instanceof Promise){try{tmp=await tmp}catch(_e){${t.end('_e')}${suspensionAbort}throw _e}\n${t.end('tmp')}${suspensionAbort}}else{${t.end('tmp')}}\n`
			closedAtBoundary = true
		} else {
			code += `tmp=${Await(fn)}bf${at(i)}(c)\n`
			code += awaitGuard(fn, isAsync, 'tmp', suspensionAbort)
		}
		if (modes?.[i] !== undefined) {
			needsEs = true
			if (modes[i]) {
				link(replaceDeriveContext, 'rdc')
				code +=
					'if(tmp instanceof es)_r=tmp\n' +
					"else if(tmp){if(typeof tmp==='object'||typeof tmp==='function')c=rdc(c,tmp);tmp=undefined}\n"
			} else {
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
			}
		} else code += 'if(tmp!==undefined)_r=tmp\n'

		if (!closedAtBoundary) code += t.end('tmp')
	}

	code += '}'.repeat(depth)
	if (needsEs) link(ElysiaStatus, 'es')

	return code
}

export function lowerBeforeHandlePrefix(
	prefix: CompactBeforeHandlePrefix | undefined
): readonly Function[] | undefined {
	if (!prefix) return

	const values = new Array<Function>(prefix.length)
	let offset = prefix.length
	for (let chunk = prefix.tail; chunk; chunk = chunk.parent) {
		offset -= chunk.values.length
		for (let i = 0; i < chunk.values.length; i++)
			values[offset + i] = chunk.values[i]!
	}

	return values
}

type BeforeHandleContext = { request: Request }

export function runBeforeHandlePrefix(
	prefix: CompactBeforeHandlePrefix | readonly Function[],
	context: BeforeHandleContext,
	compat = true
) {
	const values = Array.isArray(prefix)
		? prefix
		: lowerBeforeHandlePrefix(prefix as CompactBeforeHandlePrefix)!
	for (let i = 0; i < values.length; i++) {
		if (compat && i && context.request.signal.aborted) return
		const result = values[i]!(context)
		if (result !== undefined) return result
	}
}

export async function runBeforeHandlePrefixAsync(
	prefix: CompactBeforeHandlePrefix | readonly Function[],
	context: BeforeHandleContext,
	compat = true
) {
	const values = Array.isArray(prefix)
		? prefix
		: lowerBeforeHandlePrefix(prefix as CompactBeforeHandlePrefix)!
	for (let i = 0; i < values.length; i++) {
		if (compat && i && context.request.signal.aborted) return
		let result = values[i]!(context)
		if (result instanceof Promise) {
			try {
				result = await result
			} catch (error) {
				if (!compat && context.request.signal.aborted) return

				throw error
			}
			if (!compat && context.request.signal.aborted) return
		}
		if (result !== undefined) return result
	}
}

export function mapChainHook(
	_hooks: MaybeArray<Function>,
	prefix: string,
	isAsync: boolean,
	report?: TraceReporter,
	abortGuard?: string,
	suspensionAbort?: string
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
		let closedAtBoundary = false
		if (isAsyncFunction(fn) && suspensionAbort) {
			code += `try{tmp=await ${prefix}${at(i)}(c)}catch(_e){${t.end('_e')}${suspensionAbort}throw _e}\n${t.end('tmp')}${suspensionAbort}`
			closedAtBoundary = !!report
		} else if (isAsync && suspensionAbort && report) {
			code +=
				`tmp=${prefix}${at(i)}(c)\n` +
				`if(tmp instanceof Promise){try{tmp=await tmp}catch(_e){${t.end('_e')}${suspensionAbort}throw _e}\n${t.end('tmp')}${suspensionAbort}}else{${t.end('tmp')}}\n`
			closedAtBoundary = true
		} else {
			code += `tmp=${Await(fn)}${prefix}${at(i)}(c)\n`
			code += awaitGuard(fn, isAsync, 'tmp', suspensionAbort)
		}
		if (!closedAtBoundary) code += t.end('tmp')
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
	return (
		`try{` +
		t.begin +
		`const _ar=ar${at(i)}(c)\n` +
		`if(typeof _ar?.then==='function')await _ar\n` +
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
		sign: string,
		isAsync: boolean,
		suspensionAbort?: string,
		report?: TraceReporter
	]
>(
	(
		i,
		fn,
		[
			map,
			link,
			mapResponse,
			schedule,
			sign,
			isAsync,
			suspensionAbort,
			report
		]
	) => {
		link(mapResponse, 'rm')
		const t = trace(report, fn)
		let call: string

		if (report && isAsyncFunction(fn))
			call =
				t.begin +
				`try{_r=await er${at(i)}(c)}catch(_e){${t.end('_e')}${suspensionAbort ?? ''}throw _e}\n` +
				t.end() +
				(suspensionAbort ?? '')
		else if (report && isAsync)
			call =
				t.begin +
				`try{_r=er${at(i)}(c)}catch(_e){${t.end('_e')}throw _e}\n` +
				`if(_r instanceof Promise){try{_r=await _r}catch(_e){${t.end('_e')}${suspensionAbort ?? ''}throw _e}\n${t.end()}${suspensionAbort ?? ''}}else{${t.end()}}\n`
		else {
			const invoke =
				isAsyncFunction(fn) && suspensionAbort
					? `try{_r=await er${at(i)}(c)}catch(_e){${suspensionAbort}throw _e}\n${suspensionAbort}`
					: `_r=${Await(fn)}er${at(i)}(c)\n` +
						awaitGuard(fn, isAsync, '_r', suspensionAbort)
			call = report
				? `try{${t.begin}${invoke}${t.end()}}catch(_e){${t.end('_e')}throw _e}\n`
				: invoke
		}
		return (
			call +
			`if(_r!==undefined){\n` +
			`if(_r instanceof Response)c.set.status=_r.status\n` +
			`else if(c.set.status===undefined||c.set.status===200)c.set.status=500\n` +
			schedule +
			sign +
			`return _em(c,${map}(_r,c.set,c.request,true))\n` +
			`}\n`
		)
	}
)

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

const Await = (fn: Function) => (isAsyncFunction(fn) ? 'await ' : '')

const awaitGuard = (
	fn: Function,
	isAsync: boolean,
	target: string,
	afterAwait = ''
) =>
	isAsync && !isAsyncFunction(fn)
		? afterAwait
			? `if(${target} instanceof Promise){try{${target}=await ${target}}catch(_e){${afterAwait}throw _e}\n${afterAwait}}\n`
			: `if(${target} instanceof Promise)${target}=await ${target}\n`
		: ''
