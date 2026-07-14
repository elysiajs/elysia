import { separateFunction, type Sucrose } from '../../sucrose'
import type { AnyLocalHook } from '../../types'

const isIdent = (ch: number) =>
	(ch >= 48 && ch <= 57) ||
	(ch >= 65 && ch <= 90) ||
	(ch >= 97 && ch <= 122) ||
	ch === 95 ||
	ch === 36

function analyzeCookieFn(fn: Function) {
	const source = fn.toString()

	// `[native code]` cannot inspect the body.
	if (source.includes('[native code]')) return false

	const [parameter, body] = separateFunction(source)
	if (body === undefined) return false

	const names = new Set<string>()

	const jarAliases = new Set<string>()
	const ctxAliases = new Set<string>()

	const paramResult = analyzeParameter(
		parameter,
		names,
		jarAliases,
		ctxAliases
	)

	if (paramResult === false) return false

	const bodyResult = analyzeBody(body, names, jarAliases, ctxAliases)
	if (bodyResult === false) return false

	return names
}

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

function analyzeParameter(
	params: string,
	names: Set<string>,
	jarAliases: Set<string>,
	ctxAliases: Set<string>
) {
	let trimmed = params.trim()
	if (trimmed.startsWith('(')) {
		const close = matchParen(trimmed, 0)
		if (close !== trimmed.length - 1) return false
		trimmed = trimmed.slice(1, close).trim()
	}

	if (!trimmed.startsWith('{')) {
		// harmless as we only track `.cookie` reads through it.
		let i = 0
		while (i < trimmed.length && !isIdent(trimmed.charCodeAt(i))) i++

		let j = i
		while (j < trimmed.length && isIdent(trimmed.charCodeAt(j))) j++

		if (j > i) ctxAliases.add(trimmed.slice(i, j))
		return true
	}

	const inner = extractBraceInner(trimmed)
	if (inner === false) return false

	const cookieSlot = findKeySlot(inner, 'cookie')
	if (cookieSlot === false) return false
	if (cookieSlot === undefined) return true // cookie not destructured here

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
		if (leaves === false) return false

		for (const leaf of leaves) names.add(leaf)

		return true
	}

	return false
}

function extractBraceInner(s: string): string | false {
	const close = matchParen(s, 0)
	if (close === -1) return false
	return s.slice(1, close)
}

interface KeySlot {
	kind: 'shorthand' | 'alias' | 'object'
	value: string
}

function splitTopLevel(inner: string): string[] {
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

function findKeySlot(inner: string, key: string): KeySlot | undefined | false {
	const parts = splitTopLevel(inner)

	for (let raw of parts) {
		raw = raw.trim()
		if (!raw) continue

		if (raw.startsWith('...') || raw.startsWith('[')) return false

		let i = 0
		while (i < raw.length && !isIdent(raw.charCodeAt(i))) i++

		let j = i
		while (j < raw.length && isIdent(raw.charCodeAt(j))) j++

		const name = raw.slice(i, j)
		if (name !== key) continue

		const rest = raw.slice(j).trim()
		if (rest === '' || rest.startsWith('='))
			return { kind: 'shorthand', value: 'cookie' }

		if (rest.startsWith(':')) {
			const target = rest.slice(1).trim()
			if (target.startsWith('{')) return { kind: 'object', value: target }

			// alias `cookie: name` (possibly `cookie: name = default`)
			let k = 0
			while (k < target.length && !isIdent(target.charCodeAt(k))) k++

			let l = k
			while (l < target.length && isIdent(target.charCodeAt(l))) l++

			if (l > k) return { kind: 'alias', value: target.slice(k, l) }
			return false
		}

		return false
	}
}

function destructureLeaves(obj: string) {
	const inner = extractBraceInner(obj.trim())
	if (inner === false) return false

	const parts = splitTopLevel(inner)

	const leaves = new Set<string>()
	for (let raw of parts) {
		raw = raw.trim()
		if (!raw) continue

		if (raw.startsWith('...') || raw.startsWith('[')) return false

		let i = 0
		while (i < raw.length && !isIdent(raw.charCodeAt(i))) i++

		let j = i
		while (j < raw.length && isIdent(raw.charCodeAt(j))) j++

		const name = raw.slice(i, j)
		if (!name) return false

		const rest = raw.slice(j).trim()

		if (rest === '' || rest.startsWith('=')) {
			leaves.add(name)
			continue
		}

		return false
	}

	return leaves
}

const precededBySpread = (source: string, idx: number) =>
	idx >= 3 &&
	source.charCodeAt(idx - 1) === 46 &&
	source.charCodeAt(idx - 2) === 46 &&
	source.charCodeAt(idx - 3) === 46

function readJarAccess(
	source: string,
	pos: number,
	names: Set<string>
) {
	let after = pos
	while (after < source.length) {
		const ch = source.charCodeAt(after)
		if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break

		after++
	}

	if (
		source.charCodeAt(after) === 63 &&
		source.charCodeAt(after + 1) === 46
	) {
		after += 2

		if (source.charCodeAt(after) === 91) {
			const name = readIndexName(source, after + 1)
			if (name === false) return false
			names.add(name)
			return 'read'
		}

		// `jar?.name`
		const name = readMemberName(source, after)
		if (name === false) return false

		names.add(name)
		return 'read'
	}

	const op = source.charCodeAt(after)
	if (op === 46) {
		const name = readMemberName(source, after + 1)
		if (name === false) return false

		names.add(name)
		return 'read'
	}

	if (op === 91) {
		const name = readIndexName(source, after + 1)
		if (name === false) return false

		names.add(name)
		return 'read'
	}

	return 'escaped'
}

function analyzeBody(
	source: string,
	names: Set<string>,
	jarAliases: Set<string>,
	ctxAliases: Set<string>
) {
	for (const alias of jarAliases) {
		let from = 0

		while (true) {
			const idx = source.indexOf(alias, from)
			if (idx === -1) break
			from = idx + alias.length

			const before = idx === 0 ? -1 : source.charCodeAt(idx - 1)
			const after = source.charCodeAt(from)

			if (precededBySpread(source, idx)) return false

			if (
				(before !== -1 && (isIdent(before) || before === 46)) ||
				isIdent(after)
			)
				continue

			const access = readJarAccess(source, from, names)
			if (access === false || access === 'escaped') return false
		}
	}

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

			let after = from
			while (after < source.length) {
				const ch = source.charCodeAt(after)
				if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break
				after++
			}

			let memberStart: number
			if (
				source.charCodeAt(after) === 63 &&
				source.charCodeAt(after + 1) === 46
			)
				memberStart = after + 2
			else if (source.charCodeAt(after) === 46) memberStart = after + 1
			else return false

			const member = readMemberNameRaw(source, memberStart)
			if (member === false) return false
			if (member.name !== 'cookie') continue

			const access = readJarAccess(source, member.end, names)
			if (access === false || access === 'escaped') return false
		}
	}

	return true
}

function readMemberName(source: string, pos: number): string | false {
	let i = pos
	while (i < source.length) {
		const ch = source.charCodeAt(i)
		if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break
		i++
	}

	let j = i
	while (j < source.length && isIdent(source.charCodeAt(j))) j++
	if (j === i) return false

	return source.slice(i, j)
}

function readIndexName(source: string, pos: number): string | false {
	let i = pos
	while (i < source.length) {
		const ch = source.charCodeAt(i)
		if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break
		i++
	}

	const quote = source.charCodeAt(i)
	if (quote !== 34 && quote !== 39) return false

	let j = i + 1
	let out = ''

	while (j < source.length) {
		const ch = source.charCodeAt(j)
		if (ch === 92)
			return false

		if (ch === quote) break
		out += source[j]
		j++
	}

	if (j >= source.length) return false

	let k = j + 1

	while (k < source.length) {
		const ch = source.charCodeAt(k)
		if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break
		k++
	}

	if (source.charCodeAt(k) !== 93) return false
	return out
}

function readMemberNameRaw(
	source: string,
	pos: number
) {
	let i = pos
	while (i < source.length) {
		const ch = source.charCodeAt(i)
		if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) break
		i++
	}

	let j = i
	while (j < source.length && isIdent(source.charCodeAt(j))) j++

	if (j === i) return false

	return { name: source.slice(i, j), end: j }
}

export function analyzeCookieReads(
	handler: unknown,
	hook: AnyLocalHook | undefined,
	inference: Sucrose.Inference,
	hasCookieValidator: boolean
) {
	if (!inference.cookie && !hasCookieValidator) return []

	const all = new Set<string>()

	const consider = (fn: Function | undefined) => {
		if (typeof fn !== 'function') return true

		const result = analyzeCookieFn(fn)
		if (result === false) return false

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
