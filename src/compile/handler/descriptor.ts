import type { AnyElysia } from '../../base'
import { separateFunction, sucrose, type Sucrose } from '../../sucrose'

import type { RouteValidator } from '../../validator/route'
import type { Validator } from '../../validator'

import { isAsyncFunction, isAsyncLifecycle, mayReturnPromise } from '../utils'

import { compileCookieConfig } from '../../cookie/config'
import type { CompiledCookieConfig } from '../../cookie/config'
import { hasSyncHmac } from '../../cookie/utils'

import { unionTracePhases, type TraceEvent } from '../../trace'
import { Capture } from '../aot'
import { frozenRootOf } from '../../generation'
import { JITProbe } from '../jit-probe'

import type { CompactBeforeHandlePrefix } from '../../utils'
import type { AnyLocalHook, MaybeArray } from '../../types'

export interface RouteDescriptor {
	method: string
	path: string

	handlerKind: 'function' | 'response' | 'promise' | 'static-value'
	async: boolean

	// lifecycle presence
	hasBeforeHandle: boolean
	hasAfterHandle: boolean
	hasMapResponse: boolean
	hasAfterResponse: boolean
	hasErrorHook: boolean
	hasResponseValidator: boolean
	hasTrace: boolean
	traceCount: number
	hasLifecycleHook: boolean

	hasBody: boolean

	// per-slot validator asyncness
	bodyValiIsAsync: boolean
	headersValiIsAsync: boolean
	paramsValiIsAsync: boolean
	queryValiIsAsync: boolean
	cookieValiIsAsync: boolean
	responseValiAsync: boolean

	// cookie
	needsCookie: boolean
	hasCookieSign: boolean
	syncCookieSign: boolean
	asyncCookieSign: boolean

	// promotion purity fact (native-static eligibility)
	pureLiteral: boolean

	/**
	 * Conservative static set of cookie names read by the pipeline, or
	 * `undefined` when the analyser cannot prove the read set is closed.
	 * `undefined` is always the safe answer.
	 */
	cookieReads: readonly string[] | undefined

	// sucrose inference channels
	inferenceBody: boolean
	inferenceQuery: boolean
	inferenceHeaders: boolean
	inferenceCookie: boolean
	inferenceSet: boolean
	inferenceServer: boolean
	inferenceRoute: boolean
	inferenceUrl: boolean
	inferencePath: boolean

	// async-forcing family + sync fast-path facts
	handlerIsAsync: boolean
	errorHookForcesAsync: boolean
	afterResponseForcesAsync: boolean
	traceForcesAsync: boolean
	handlerResultObserved: boolean
	lifecycleForcesAsync: boolean
	callHandlerSyncOnAsync: boolean
	syncErrorHook: boolean
	syncAfterResponse: boolean
}

// Non-serialisable artifacts the JIT still needs, bundled with the descriptor.
export interface RouteCompileState {
	descriptor: RouteDescriptor

	vali: RouteValidator<any> | undefined
	inference: Sucrose.Inference
	cookieConfig: CompiledCookieConfig | undefined

	beforeHandlePrefix: CompactBeforeHandlePrefix | undefined
	traceHandlers: Function[] | undefined
	tracePhases: Set<TraceEvent> | null
	hasAnyPhase: boolean
	traceHandleOn: boolean
}

export interface DescribeRouteInput {
	method: string
	path: string
	handler: unknown
	root: AnyElysia
	hook: AnyLocalHook | undefined
	buildValidator: () => RouteValidator<any> | undefined
	isHandleFunction: boolean
	isStaticResponse: boolean
	isPromiseHandler: boolean
}

/**
 * Route descriptors, keyed by root instance → `METHOD path` → descriptor.
 * Populated on each JIT compile for tests, audit, and the B6 root-local freeze.
 */
export const routeDescriptors = new WeakMap<
	AnyElysia,
	Map<string, RouteDescriptor>
>()

const matchReturnIdentifier =
	// `=>` may be minified with no gap (`=>x`); `return` always needs a
	// separator or it fuses into a different identifier (`returnx`).
	// eslint-disable-next-line sonarjs/regex-complexity
	/(?:=>\s*|\breturn\s+)(?!(?:true|false|null|undefined|void|new|typeof|async|await|function|class)\b)[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*(?![\w$([])/

const mayReturnIdentifierCache = new WeakMap<Function, boolean>()

export const mayReturnIdentifier = (fn: Function): boolean => {
	let result = mayReturnIdentifierCache.get(fn)
	if (result !== undefined) return result
	result = matchReturnIdentifier.test(fn.toString())
	mayReturnIdentifierCache.set(fn, result)
	return result
}

export const lifecycleMayReturnPromise = (
	handlers: MaybeArray<Function> | undefined,
	observed: boolean
) =>
	handlers
		? Array.isArray(handlers)
			? handlers.some(
					(fn) =>
						!isAsyncFunction(fn) &&
						(mayReturnPromise(fn) ||
							(observed && mayReturnIdentifier(fn)))
				)
			: !isAsyncFunction(handlers) &&
				(mayReturnPromise(handlers) ||
					(observed && mayReturnIdentifier(handlers)))
		: false

const compactPrefixInference = new WeakMap<
	CompactBeforeHandlePrefix,
	Sucrose.Inference
>()
const compactPrefixAsync = new WeakMap<CompactBeforeHandlePrefix, boolean>()

export const mergeInference = (
	a: Sucrose.Inference,
	b: Sucrose.Inference
): Sucrose.Inference => ({
	body: a.body || b.body,
	cookie: a.cookie || b.cookie,
	headers: a.headers || b.headers,
	query: a.query || b.query,
	set: a.set || b.set,
	server: a.server || b.server,
	url: a.url || b.url,
	route: a.route || b.route,
	path: a.path || b.path
})

const inferCompactPrefix = (
	prefix: CompactBeforeHandlePrefix
): Sucrose.Inference => {
	const cached = compactPrefixInference.get(prefix)
	if (cached) return cached

	const pending: CompactBeforeHandlePrefix[] = []
	let current: CompactBeforeHandlePrefix | undefined = prefix
	let inference: Sucrose.Inference | undefined

	while (current) {
		inference = compactPrefixInference.get(current)
		if (inference) break

		pending.push(current)
		current = current.previous
	}

	for (let i = pending.length - 1; i >= 0; i--) {
		const item = pending[i]!
		const added = sucrose(undefined, {
			beforeHandle: item.added as any
		})
		inference = inference ? mergeInference(inference, added) : added
		compactPrefixInference.set(item, inference)
	}

	return inference!
}

const compactPrefixForcesAsync = (
	prefix: CompactBeforeHandlePrefix
): boolean => {
	const cached = compactPrefixAsync.get(prefix)
	if (cached !== undefined) return cached

	const pending: CompactBeforeHandlePrefix[] = []
	let current: CompactBeforeHandlePrefix | undefined = prefix
	let value = false

	while (current) {
		const previous = compactPrefixAsync.get(current)
		if (previous !== undefined) {
			value = previous
			break
		}

		pending.push(current)
		current = current.previous
	}

	for (let i = pending.length - 1; i >= 0; i--) {
		const item = pending[i]!
		for (let j = 0; !value && j < item.added.length; j++) {
			const fn = item.added[j]!
			value =
				isAsyncFunction(fn) ||
				(!isAsyncFunction(fn) &&
					(mayReturnPromise(fn) || mayReturnIdentifier(fn)))
		}
		compactPrefixAsync.set(item, value)
	}

	return value
}

const isAsyncValidator = (vali: Validator | undefined) =>
	(vali as Validator | undefined)?.isAsync ?? true

const mayReturnPromiseValidator = (vali: Validator | undefined) =>
	(vali as Validator | undefined)?.mayReturnPromise === true

/**
 * Shared "route has no request-dependent lifecycle" fact.
 *
 * Extracted from `buildNativeStaticResponse`'s for-in check so the native
 * static promotion predicate and the descriptor's `pureLiteral` fact agree by
 * construction. Returns `true` when the resolved pipeline hook is effectively
 * empty (every field absent / false / an empty array), ignoring the
 * documentation-only `detail` / `tags` fields.
 */
export function isEmptyPipelineHook(
	hook: AnyLocalHook | undefined
): boolean {
	if (!hook) return true

	for (const key in hook) {
		if (key === 'detail' || key === 'tags') continue

		const value = (hook as any)[key]
		if (
			value !== undefined &&
			value !== false &&
			(!Array.isArray(value) || value.length)
		)
			return false
	}

	return true
}

// ---------------------------------------------------------------------------
// Cookie-read set analyser
// ---------------------------------------------------------------------------
//
// Conservative static extraction of the cookie names read by the pipeline.
// Only provably-static patterns produce names:
//   - parameter destructuring `({ cookie: { a, b } })`
//   - direct member `cookie.a` / `<ctxAlias>.cookie.a`
//   - literal index `cookie['a']` / `cookie["a"]`
// Anything else that touches the cookie channel (aliasing the jar, dynamic
// index, enumeration, spread, passing cookie to a call, `Object.keys`, …)
// collapses the whole route to `undefined` (unanalysable). False "analysable"
// claims are security-relevant (Q8 lazy signed-cookie verify consumes this),
// so `undefined` is always the safe answer.

const isIdent = (ch: number) =>
	(ch >= 48 && ch <= 57) ||
	(ch >= 65 && ch <= 90) ||
	(ch >= 97 && ch <= 122) ||
	ch === 95 ||
	ch === 36

const UNANALYSABLE = Symbol('cookie-unanalysable')

// Collect names from one function; returns a set of names, or `UNANALYSABLE`.
function analyzeCookieFn(fn: Function): Set<string> | typeof UNANALYSABLE {
	const source = fn.toString()

	// `[native code]` — cannot inspect the body.
	if (source.includes('[native code]')) return UNANALYSABLE

	const [parameter, body] = separateFunction(source)

	// Parser could not split the function — degrade to unanalysable.
	if (body === undefined) return UNANALYSABLE

	const names = new Set<string>()

	// `jarAliases`: names that ARE the cookie jar (`{ cookie }` shorthand or a
	//   `cookie: jar` rename). A member `jarAlias.name` reads cookie `name`.
	// `ctxAliases`: the context parameter binding (e.g. `c`). A member chain
	//   `ctxAlias.cookie.name` reads cookie `name`; any other `ctxAlias.*` is
	//   irrelevant.
	const jarAliases = new Set<string>()
	const ctxAliases = new Set<string>()

	// 1) Root parameter destructuring — find `cookie` and, if it is itself
	//    destructured (`cookie: { a, b }`), harvest the leaf names.
	const paramResult = analyzeParameter(
		parameter,
		names,
		jarAliases,
		ctxAliases
	)
	if (paramResult === UNANALYSABLE) return UNANALYSABLE

	// 2) Body scan for `<jar>.name`, `<ctx>.cookie.name`, and bare jar escapes.
	const bodyResult = analyzeBody(body, names, jarAliases, ctxAliases)
	if (bodyResult === UNANALYSABLE) return UNANALYSABLE

	return names
}

// Match the closing bracket for the opener at `open` (`(`, `[`, or `{`),
// respecting nesting and strings. Returns -1 when unbalanced.
function matchParen(s: string, open: number): number {
	const opener = s.charCodeAt(open)
	const closer = opener === 40 ? 41 : opener === 91 ? 93 : 125
	let depth = 0
	let quote = 0
	for (let i = open; i < s.length; i++) {
		const ch = s.charCodeAt(i)

		if (quote) {
			if (ch === 92) {
				i++
				continue
			}
			if (ch === quote) quote = 0
			continue
		}

		if (ch === 34 || ch === 39 || ch === 96) {
			quote = ch
			continue
		}

		if (ch === 40 || ch === 91 || ch === 123) depth++
		else if (ch === 41 || ch === 93 || ch === 125) {
			depth--
			if (depth === 0 && ch === closer) return i
		}
	}

	return -1
}

// Analyse the parameter list. Named parameters and simple aliases are fine; a
// destructured `cookie` slot yields leaf names or marks alias usage.
function analyzeParameter(
	params: string,
	names: Set<string>,
	jarAliases: Set<string>,
	ctxAliases: Set<string>
): true | typeof UNANALYSABLE {
	// Not object-destructured at the root: e.g. `c` or `c, extra`.
	let trimmed = params.trim()
	if (trimmed.startsWith('(')) {
		const close = matchParen(trimmed, 0)
		if (close !== trimmed.length - 1) return UNANALYSABLE
		trimmed = trimmed.slice(1, close).trim()
	}
	if (!trimmed.startsWith('{')) {
		// The context binding itself — every `ctx.cookie.*` read is analysable.
		// Only the first identifier is the context; extras are unusual → but
		// harmless as we only track `.cookie` reads through it.
		let i = 0
		while (i < trimmed.length && !isIdent(trimmed.charCodeAt(i))) i++
		let j = i
		while (j < trimmed.length && isIdent(trimmed.charCodeAt(j))) j++
		if (j > i) ctxAliases.add(trimmed.slice(i, j))
		return true
	}

	// Root object destructuring — locate `cookie` key.
	const inner = extractBraceInner(trimmed)
	if (inner === UNANALYSABLE) return UNANALYSABLE

	const cookieSlot = findKeySlot(inner, 'cookie')
	if (cookieSlot === UNANALYSABLE) return UNANALYSABLE
	if (cookieSlot === undefined) return true // cookie not destructured here

	// `cookie` present. Forms:
	//   `cookie`            → the jar, bound to `cookie`
	//   `cookie: name`      → the jar, bound to `name`
	//   `cookie: { a, b }`  → static leaf names
	//   `cookie: [...]`     → unanalysable (array pattern is odd but be safe)
	if (cookieSlot.kind === 'shorthand') {
		jarAliases.add('cookie')
		return true
	}
	if (cookieSlot.kind === 'alias') {
		jarAliases.add(cookieSlot.value)
		return true
	}
	if (cookieSlot.kind === 'object') {
		const leaves = destructureLeaves(cookieSlot.value)
		if (leaves === UNANALYSABLE) return UNANALYSABLE
		for (const leaf of leaves) names.add(leaf)
		return true
	}

	return UNANALYSABLE
}

// Extract the inner text of a `{ ... }` string (must start with `{`).
function extractBraceInner(s: string): string | typeof UNANALYSABLE {
	const close = matchParen(s, 0)
	if (close === -1) return UNANALYSABLE
	return s.slice(1, close)
}

interface KeySlot {
	kind: 'shorthand' | 'alias' | 'object'
	value: string
}

// Split a destructuring body at top level by commas.
function splitTopLevel(inner: string): string[] | typeof UNANALYSABLE {
	const parts: string[] = []
	let depth = 0
	let quote = 0
	let start = 0
	for (let i = 0; i < inner.length; i++) {
		const ch = inner.charCodeAt(i)
		if (quote) {
			if (ch === 92) {
				i++
				continue
			}
			if (ch === quote) quote = 0
			continue
		}
		if (ch === 34 || ch === 39 || ch === 96) {
			quote = ch
			continue
		}
		if (ch === 40 || ch === 91 || ch === 123) depth++
		else if (ch === 41 || ch === 93 || ch === 125) depth--
		else if (ch === 44 && depth === 0) {
			parts.push(inner.slice(start, i))
			start = i + 1
		}
	}
	parts.push(inner.slice(start))
	return parts
}

// Find the `cookie` slot within a root destructuring body.
function findKeySlot(
	inner: string,
	key: string
): KeySlot | undefined | typeof UNANALYSABLE {
	const parts = splitTopLevel(inner)
	if (parts === UNANALYSABLE) return UNANALYSABLE

	for (let raw of parts) {
		raw = raw.trim()
		if (!raw) continue

		// Rest/spread at the root captures cookie implicitly → unanalysable.
		if (raw.startsWith('...') || raw.startsWith('['))
			return UNANALYSABLE

		// Extract leading identifier (the key name).
		let i = 0
		while (i < raw.length && !isIdent(raw.charCodeAt(i))) i++
		let j = i
		while (j < raw.length && isIdent(raw.charCodeAt(j))) j++
		const name = raw.slice(i, j)
		if (name !== key) continue

		const rest = raw.slice(j).trim()
		if (rest === '' || rest.startsWith('=')) {
			// `cookie` or `cookie = default` (default value on jar is odd but
			// the binding name is still `cookie`).
			return { kind: 'shorthand', value: 'cookie' }
		}
		if (rest.startsWith(':')) {
			const target = rest.slice(1).trim()
			if (target.startsWith('{')) return { kind: 'object', value: target }
			// alias `cookie: name` (possibly `cookie: name = default`)
			let k = 0
			while (k < target.length && !isIdent(target.charCodeAt(k))) k++
			let l = k
			while (l < target.length && isIdent(target.charCodeAt(l))) l++
			if (l > k) return { kind: 'alias', value: target.slice(k, l) }
			return UNANALYSABLE
		}

		return UNANALYSABLE
	}

	return undefined
}

// Harvest static leaf names from `{ a, b, c }` destructuring. Any rename,
// default, nesting, rest, or computed key → unanalysable.
function destructureLeaves(
	obj: string
): Set<string> | typeof UNANALYSABLE {
	const inner = extractBraceInner(obj.trim())
	if (inner === UNANALYSABLE) return UNANALYSABLE

	const parts = splitTopLevel(inner)
	if (parts === UNANALYSABLE) return UNANALYSABLE

	const leaves = new Set<string>()
	for (let raw of parts) {
		raw = raw.trim()
		if (!raw) continue

		// spread/rest, computed key, nested destructuring → give up.
		if (raw.startsWith('...') || raw.startsWith('[')) return UNANALYSABLE

		let i = 0
		while (i < raw.length && !isIdent(raw.charCodeAt(i))) i++
		let j = i
		while (j < raw.length && isIdent(raw.charCodeAt(j))) j++
		const name = raw.slice(i, j)
		if (!name) return UNANALYSABLE

		const rest = raw.slice(j).trim()
		// `a` shorthand → name is the cookie key.
		if (rest === '') {
			leaves.add(name)
			continue
		}
		// `a = default` → still reads cookie key `a`.
		if (rest.startsWith('=')) {
			leaves.add(name)
			continue
		}
		// `a: b` rename, `a: {...}` nested → unanalysable (binding ≠ key clean).
		return UNANALYSABLE
	}

	return leaves
}

// Is the character run ending at `idx-1` a `...` spread operator?
function precededBySpread(source: string, idx: number): boolean {
	return (
		idx >= 3 &&
		source.charCodeAt(idx - 1) === 46 &&
		source.charCodeAt(idx - 2) === 46 &&
		source.charCodeAt(idx - 3) === 46
	)
}

// Read `.name` / `['name']` immediately after position `pos` (the char after
// the jar reference), adding the cookie name to `names`. Returns:
//   'read'         — a static cookie name was captured
//   'escaped'      — the jar was used as a whole (no static member) → bail
//   UNANALYSABLE   — a member/index existed but was dynamic → bail
function readJarAccess(
	source: string,
	pos: number,
	names: Set<string>
): 'read' | 'escaped' | typeof UNANALYSABLE {
	let after = pos
	while (after < source.length) {
		const ch = source.charCodeAt(after)
		if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break
		after++
	}

	// Optional chaining after the jar: `jar?.name` or `jar?.['name']`. The `?.`
	// stands in for the `.`, so the member name follows directly.
	if (
		source.charCodeAt(after) === 63 &&
		source.charCodeAt(after + 1) === 46
	) {
		after += 2
		// `jar?.['name']` — a computed access follows the `?.`.
		if (source.charCodeAt(after) === 91) {
			const name = readIndexName(source, after + 1)
			if (name === UNANALYSABLE) return UNANALYSABLE
			names.add(name)
			return 'read'
		}
		// `jar?.name`
		const name = readMemberName(source, after)
		if (name === UNANALYSABLE) return UNANALYSABLE
		names.add(name)
		return 'read'
	}

	const op = source.charCodeAt(after)
	if (op === 46) {
		const name = readMemberName(source, after + 1)
		if (name === UNANALYSABLE) return UNANALYSABLE
		names.add(name)
		return 'read'
	}
	if (op === 91) {
		const name = readIndexName(source, after + 1)
		if (name === UNANALYSABLE) return UNANALYSABLE
		names.add(name)
		return 'read'
	}
	return 'escaped'
}

// Scan a function body for cookie reads through known aliases. Returns
// `UNANALYSABLE` on any non-member use of a cookie alias.
function analyzeBody(
	source: string,
	names: Set<string>,
	jarAliases: Set<string>,
	ctxAliases: Set<string>
): true | typeof UNANALYSABLE {
	// Jar aliases: `<jar>.name` / `<jar>['name']` reads cookie `name`; any bare
	// use (spread, passed to a call, assigned, enumerated) escapes → bail.
	for (const alias of jarAliases) {
		let from = 0
		while (true) {
			const idx = source.indexOf(alias, from)
			if (idx === -1) break
			from = idx + alias.length

			const before = idx === 0 ? -1 : source.charCodeAt(idx - 1)
			const after = source.charCodeAt(from)

			// A spread of the jar (`...cookie`) is an escape.
			if (precededBySpread(source, idx)) return UNANALYSABLE

			// A member access `x.cookie` (single dot) or an identifier-boundary
			// mismatch (`mycookie`) is not the jar binding — skip.
			if (
				(before !== -1 && (isIdent(before) || before === 46)) ||
				isIdent(after)
			)
				continue

			const access = readJarAccess(source, from, names)
			if (access === UNANALYSABLE || access === 'escaped')
				return UNANALYSABLE
		}
	}

	// Context aliases: only `<ctx>.cookie.name` / `<ctx>.cookie['name']` reads a
	// cookie. Any other `<ctx>.*` is irrelevant; a whole-jar use bails.
	for (const alias of ctxAliases) {
		let from = 0
		while (true) {
			const idx = source.indexOf(alias, from)
			if (idx === -1) break
			from = idx + alias.length

			const before = idx === 0 ? -1 : source.charCodeAt(idx - 1)
			if (
				(before !== -1 && (isIdent(before) || before === 46)) ||
				isIdent(source.charCodeAt(from))
			)
				continue

			// Skip whitespace + optional chaining after the ctx alias.
			let after = from
			while (after < source.length) {
				const ch = source.charCodeAt(after)
				if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break
				after++
			}

			// The `.cookie` member — reached via `.` or `?.`. `memberStart`
			// points at the member identifier itself.
			let memberStart: number
			if (
				source.charCodeAt(after) === 63 &&
				source.charCodeAt(after + 1) === 46
			)
				memberStart = after + 2
			else if (source.charCodeAt(after) === 46) memberStart = after + 1
			else return UNANALYSABLE

			const member = readMemberNameRaw(source, memberStart)
			if (member === UNANALYSABLE) return UNANALYSABLE
			if (member.name !== 'cookie') continue

			const access = readJarAccess(source, member.end, names)
			if (access === UNANALYSABLE || access === 'escaped')
				return UNANALYSABLE
		}
	}

	return true
}

// Read an identifier member name starting at `pos` (`.name`). Trailing member
// access like `cookie.a.value` is fine — `a` is the cookie key.
function readMemberName(
	source: string,
	pos: number
): string | typeof UNANALYSABLE {
	let i = pos
	while (i < source.length) {
		const ch = source.charCodeAt(i)
		if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break
		i++
	}
	let j = i
	while (j < source.length && isIdent(source.charCodeAt(j))) j++
	if (j === i) return UNANALYSABLE
	// Reject a computed continuation right after the name with no dot, e.g.
	// `cookie.a` is fine; the key is `a`.
	return source.slice(i, j)
}

// Read a literal string index `['name']` / `["name"]` starting after `[`.
function readIndexName(
	source: string,
	pos: number
): string | typeof UNANALYSABLE {
	let i = pos
	while (i < source.length) {
		const ch = source.charCodeAt(i)
		if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break
		i++
	}
	const quote = source.charCodeAt(i)
	if (quote !== 34 && quote !== 39) return UNANALYSABLE // dynamic index
	let j = i + 1
	let out = ''
	while (j < source.length) {
		const ch = source.charCodeAt(j)
		if (ch === 92) {
			// escape — bail rather than mis-decode
			return UNANALYSABLE
		}
		if (ch === quote) break
		out += source[j]
		j++
	}
	if (j >= source.length) return UNANALYSABLE
	// Ensure the bracket closes right after the string.
	let k = j + 1
	while (k < source.length) {
		const ch = source.charCodeAt(k)
		if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break
		k++
	}
	if (source.charCodeAt(k) !== 93) return UNANALYSABLE
	return out
}

// Read a raw member identifier and its end index, for `c.cookie` detection.
function readMemberNameRaw(
	source: string,
	pos: number
): { name: string; end: number } | typeof UNANALYSABLE {
	let i = pos
	while (i < source.length) {
		const ch = source.charCodeAt(i)
		if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break
		i++
	}
	let j = i
	while (j < source.length && isIdent(source.charCodeAt(j))) j++
	if (j === i) return UNANALYSABLE
	return { name: source.slice(i, j), end: j }
}

// Public entry: analyse the whole pipeline (handler + lifecycle fns that could
// read cookies) and return a stable, sorted name list or `undefined`.
export function analyzeCookieReads(
	handler: unknown,
	hook: AnyLocalHook | undefined,
	inference: Sucrose.Inference,
	hasCookieValidator: boolean
): readonly string[] | undefined {
	// No cookie channel touched and no validator → provably empty read set.
	if (!inference.cookie && !hasCookieValidator) return []

	const all = new Set<string>()

	const consider = (
		fn: Function | undefined
	): boolean /* analysable */ => {
		if (typeof fn !== 'function') return true
		const result = analyzeCookieFn(fn)
		if (result === UNANALYSABLE) return false
		for (const n of result) all.add(n)
		return true
	}

	const considerList = (list: unknown): boolean => {
		if (!list) return true
		if (Array.isArray(list)) {
			for (const fn of list) if (!consider(fn as Function)) return false
			return true
		}
		return consider(list as Function)
	}

	if (typeof handler === 'function' && !consider(handler as Function))
		return undefined

	if (hook) {
		if (!considerList(hook.beforeHandle)) return undefined
		if (!considerList(hook.transform)) return undefined
		if (!considerList(hook.afterHandle)) return undefined
		if (!considerList(hook.mapResponse)) return undefined
		if (!considerList(hook.afterResponse)) return undefined
		if (!considerList(hook.error)) return undefined
		if (!considerList((hook as any).resolve)) return undefined
		if (!considerList((hook as any).derive)) return undefined
	}

	return [...all].sort()
}

/**
 * Compute the full route descriptor + compile state. This holds the EXACT
 * derivation code that used to live at the top of `compileHandlerJit`, moved
 * out verbatim (same order, same semantics), including the
 * `JITProbe.record('sucrose')` call and the `hook.parse` array normalisation.
 */
export function describeRoute(
	input: DescribeRouteInput
): RouteCompileState {
	const {
		method,
		path,
		handler,
		root,
		hook,
		buildValidator,
		isHandleFunction,
		isStaticResponse,
		isPromiseHandler
	} = input

	const vali = buildValidator()
	const beforeHandlePrefix = (hook as any)?.['~beforeHandlePrefix'] as
		| CompactBeforeHandlePrefix
		| undefined

	JITProbe.record('sucrose')
	let inference = sucrose(handler as any, hook as Sucrose.LifeCycle)
	if (beforeHandlePrefix)
		inference = mergeInference(
			inference,
			inferCompactPrefix(beforeHandlePrefix)
		)

	if (hook && typeof hook.parse === 'function')
		hook.parse = [hook.parse] as any

	const parseLength = Array.isArray(hook?.parse) ? hook.parse.length : 0
	const parseFirst = Array.isArray(hook?.parse) ? hook.parse[0] : hook?.parse
	const hasStandaloneBody = !!(hook as any)?.schemas?.some(
		(s: any) => s?.body
	)

	const bodylessMethod = method === 'GET' || method === 'HEAD'
	const hasBody =
		!!hook?.body ||
		hasStandaloneBody ||
		(!bodylessMethod &&
			(parseLength > 0 || inference.body) &&
			parseFirst !== 'none')

	const bodyValiIsAsync =
		hasBody &&
		(isAsyncValidator(vali?.body) || mayReturnPromiseValidator(vali?.body))

	const headersValiIsAsync =
		vali?.headers &&
		(isAsyncValidator(vali?.headers) ||
			mayReturnPromiseValidator(vali?.headers))

	const paramsValiIsAsync =
		vali?.params &&
		(isAsyncValidator(vali?.params) ||
			mayReturnPromiseValidator(vali?.params))

	const queryValiIsAsync =
		vali?.query &&
		(isAsyncValidator(vali?.query) ||
			mayReturnPromiseValidator(vali?.query))

	const cookieValidIsAsync =
		vali?.cookie &&
		(isAsyncValidator(vali?.cookie) ||
			mayReturnPromiseValidator(vali?.cookie))

	const appCookieConfig = frozenRootOf(root)['~config']?.cookie
	const needsCookie = !!vali?.cookie || !!inference.cookie
	const cookieConfig = needsCookie
		? compileCookieConfig(hook?.cookie as any, appCookieConfig as any)
		: undefined
	const hasCookieSign = !!cookieConfig?.hasSign

	const syncCookieSign =
		hasCookieSign && hasSyncHmac && !Capture.isCapturing()
	const asyncCookieSign = hasCookieSign && !syncCookieSign

	const hasErrorHook = !!hook?.error?.length
	const hasAfterResponse = !!hook?.afterResponse?.length
	const hasBeforeHandle =
		!!beforeHandlePrefix?.length || !!hook?.beforeHandle?.length
	const hasAfterHandle = !!hook?.afterHandle?.length
	const hasMapResponse = !!hook?.mapResponse?.length
	const hasResponseValidator = !!vali?.response
	const traceHandlers = (hook?.trace as any[] | undefined) ?? undefined
	const hasTrace = !!traceHandlers?.length
	const traceCount = hasTrace ? traceHandlers!.length : 0
	const hasLifecycleHook =
		parseLength > 0 ||
		!!hook?.transform?.length ||
		hasBeforeHandle ||
		hasAfterHandle ||
		hasMapResponse ||
		hasErrorHook ||
		hasAfterResponse

	const tracePhases = hasTrace
		? unionTracePhases(traceHandlers as Function[])
		: new Set<TraceEvent>()

	const phaseOn = (phase: TraceEvent) =>
		hasTrace && (tracePhases === null || tracePhases.has(phase))

	const hasAnyPhase =
		hasTrace && (tracePhases === null || tracePhases.size > 0)

	const traceHandleOn = phaseOn('handle')

	let responseValiAsync = false
	if (vali?.response)
		for (const code in vali.response)
			if (
				isAsyncValidator(vali.response[code]) ||
				mayReturnPromiseValidator(vali.response[code])
			) {
				responseValiAsync = true
				break
			}

	const handlerIsAsync =
		isHandleFunction && isAsyncFunction(handler as Function)

	const errorHookForcesAsync =
		hasErrorHook &&
		(hasAfterHandle ||
			hasMapResponse ||
			hasResponseValidator ||
			isAsyncLifecycle(hook?.error) ||
			lifecycleMayReturnPromise(hook?.error, false))

	const afterResponseForcesAsync =
		hasAfterResponse &&
		(isAsyncLifecycle(hook?.afterResponse) ||
			hasAfterHandle ||
			hasMapResponse ||
			hasResponseValidator ||
			hasErrorHook)

	const traceForcesAsync =
		(traceHandleOn || phaseOn('error') || phaseOn('afterResponse')) &&
		isHandleFunction &&
		!handlerIsAsync &&
		(mayReturnPromise(handler as Function) ||
			mayReturnIdentifier(handler as Function))

	const handlerResultObserved =
		isHandleFunction &&
		!handlerIsAsync &&
		(hasResponseValidator || hasAfterHandle || hasMapResponse) &&
		(mayReturnPromise(handler as Function) ||
			mayReturnIdentifier(handler as Function))

	const lifecycleForcesAsync =
		!!hook &&
		((beforeHandlePrefix
			? compactPrefixForcesAsync(beforeHandlePrefix)
			: false) ||
			lifecycleMayReturnPromise(hook.beforeHandle, true) ||
			lifecycleMayReturnPromise(hook.transform, false) ||
			lifecycleMayReturnPromise(hook.afterHandle, true) ||
			lifecycleMayReturnPromise(hook.mapResponse, true))

	const isAsync =
		hasBody ||
		handlerIsAsync ||
		errorHookForcesAsync ||
		traceForcesAsync ||
		afterResponseForcesAsync ||
		handlerResultObserved ||
		lifecycleForcesAsync ||
		asyncCookieSign ||
		responseValiAsync ||
		(hook &&
			(!!isAsyncLifecycle(hook?.afterHandle) ||
				!!isAsyncLifecycle(hook?.beforeHandle) ||
				!!isAsyncLifecycle(hook?.transform) ||
				!!isAsyncLifecycle(hook?.mapResponse) ||
				!!isAsyncLifecycle(hook?.error) ||
				bodyValiIsAsync ||
				headersValiIsAsync ||
				paramsValiIsAsync ||
				queryValiIsAsync ||
				cookieValidIsAsync))

	const callHandlerSyncOnAsync =
		isAsync && isHandleFunction && !handlerIsAsync

	const syncErrorHook = hasErrorHook && !isAsync && !hasTrace
	const syncAfterResponse =
		hasAfterResponse && !isAsync && !hasTrace && !hasErrorHook

	const handlerKind: RouteDescriptor['handlerKind'] = isHandleFunction
		? 'function'
		: isStaticResponse
			? 'response'
			: isPromiseHandler
				? 'promise'
				: 'static-value'

	const pureLiteral = isEmptyPipelineHook(hook)

	const cookieReads = analyzeCookieReads(
		handler,
		hook,
		inference,
		!!vali?.cookie
	)

	const descriptor: RouteDescriptor = {
		method,
		path,
		handlerKind,
		async: !!isAsync,

		hasBeforeHandle,
		hasAfterHandle,
		hasMapResponse,
		hasAfterResponse,
		hasErrorHook,
		hasResponseValidator,
		hasTrace,
		traceCount,
		hasLifecycleHook,

		hasBody,

		bodyValiIsAsync: !!bodyValiIsAsync,
		headersValiIsAsync: !!headersValiIsAsync,
		paramsValiIsAsync: !!paramsValiIsAsync,
		queryValiIsAsync: !!queryValiIsAsync,
		cookieValiIsAsync: !!cookieValidIsAsync,
		responseValiAsync,

		needsCookie,
		hasCookieSign,
		syncCookieSign,
		asyncCookieSign,

		pureLiteral,
		cookieReads,

		inferenceBody: inference.body,
		inferenceQuery: inference.query,
		inferenceHeaders: inference.headers,
		inferenceCookie: inference.cookie,
		inferenceSet: inference.set,
		inferenceServer: inference.server,
		inferenceRoute: inference.route,
		inferenceUrl: inference.url,
		inferencePath: inference.path,

		handlerIsAsync,
		errorHookForcesAsync: !!errorHookForcesAsync,
		afterResponseForcesAsync: !!afterResponseForcesAsync,
		traceForcesAsync: !!traceForcesAsync,
		handlerResultObserved: !!handlerResultObserved,
		lifecycleForcesAsync: !!lifecycleForcesAsync,
		callHandlerSyncOnAsync: !!callHandlerSyncOnAsync,
		syncErrorHook,
		syncAfterResponse
	}

	return {
		descriptor,

		vali,
		inference,
		cookieConfig,

		beforeHandlePrefix,
		traceHandlers,
		tracePhases,
		hasAnyPhase,
		traceHandleOn
	}
}
