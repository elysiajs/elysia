import { separateFunction, type Sucrose } from '../../sucrose'
import type { AnyLocalHook } from '../../types'

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

const UNANALYSABLE = false as const

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
		if (raw.startsWith('...') || raw.startsWith('[')) return UNANALYSABLE

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
function destructureLeaves(obj: string): Set<string> | typeof UNANALYSABLE {
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

	const consider = (fn: Function | undefined): boolean /* analysable */ => {
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
