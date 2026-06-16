import { dangerousKeys } from '../../constants'
import { nullObject } from '../../utils'

type FormDataEntryValue = string | File

const DOT = 46 // '.'
const BRACKET_O = 91 // '['
const BRACKET_C = 93 // ']'
const QUOTE_1 = 39 // "'"
const QUOTE_2 = 34 // '"'
const ZERO = 48
const NINE = 57
const BRACE_O = 123 // '{'
const BRACE_C = 125 // '}'

const HAS_FILE = typeof File !== 'undefined'
const HAS_NESTING = /[.[]/
// ponytail: max nesting depth for a single form key. Each '.'/'[' segment
// allocates an object (~185 bytes), so an unbounded key like `'.'.repeat(2e6)`
// would amplify a few KB into hundreds of MB. Real forms never nest this deep.
const MAX_NESTING = 64
// ponytail: absolute cap on nested objects allocated per body. The per-key
// depth cap stops one huge key; this stops many medium-deep keys from
// amplifying a small body into a huge heap. ~100k nodes ≈ 18MB ceiling.
const MAX_NESTED_NODES = 100_000

function tryParseJson(
	val: string
): Record<string, unknown> | unknown[] | undefined {
	const code = val.charCodeAt(0)
	const closer =
		code === BRACE_O ? BRACE_C : code === BRACKET_O ? BRACKET_C : 0

	if (closer === 0 || val.charCodeAt(val.length - 1) !== closer) return

	try {
		const p = JSON.parse(val)
		if (p) return p
	} catch {}
}

function resolveValue(entries: FormDataEntryValue[]): unknown {
	const length = entries.length

	if (length === 1) {
		const v = entries[0]
		return typeof v === 'string' ? (tryParseJson(v) ?? v) : v
	}

	let jsonObj: Record<string, unknown> | undefined
	let fileCount = 0
	const result = new Array<unknown>(length)

	for (let i = 0; i < length; i++) {
		const e = entries[i]
		if (typeof e === 'string') {
			const parsed = tryParseJson(e)
			if (jsonObj === undefined && parsed && !Array.isArray(parsed))
				jsonObj = parsed as Record<string, unknown>
			result[i] = parsed ?? e
		} else {
			if (HAS_FILE && e instanceof File) fileCount++
			result[i] = e
		}
	}

	if (fileCount && jsonObj) {
		if (fileCount === 1 && !('file' in jsonObj)) {
			for (let i = 0; i < length; i++) {
				const e = entries[i]
				if (HAS_FILE && e instanceof File) {
					jsonObj.file = e
					break
				}
			}
		} else if (!('files' in jsonObj)) {
			const files: File[] = []
			for (let i = 0; i < length; i++) {
				const e = entries[i]
				if (HAS_FILE && e instanceof File) files.push(e)
			}
			jsonObj.files = files
		}
		return jsonObj
	}

	return result
}

function setNested(
	body: Record<string, unknown>,
	path: string,
	value: unknown,
	budget: { left: number }
): void {
	let current: any = body
	let i = 0
	let depth = 0
	const len = path.length

	while (i < len) {
		if (++depth > MAX_NESTING) return
		let key: string | number
		let nextIsArrayIdx = false

		if (path.charCodeAt(i) === BRACKET_O) {
			const ch2 = path.charCodeAt(++i)

			if (ch2 === QUOTE_1 || ch2 === QUOTE_2) {
				const start = ++i
				while (i < len && path.charCodeAt(i) !== ch2) i++
				key = path.slice(start, i)
				i += 2 // skip quote + ]
			} else {
				const start = i
				while (i < len && path.charCodeAt(i) !== BRACKET_C) i++
				key = +path.slice(start, i)
				i++ // skip ]
			}
		} else {
			const start = i
			while (i < len) {
				const c = path.charCodeAt(i)
				if (c === DOT || c === BRACKET_O) break
				i++
			}
			key = path.slice(start, i)
		}

		if (path.charCodeAt(i) === DOT) i++

		if (typeof key === 'string' && dangerousKeys.has(key)) return

		if (i >= len) {
			current[key] = value
			return
		}

		if (path.charCodeAt(i) === BRACKET_O) {
			const code = path.charCodeAt(i + 1)
			nextIsArrayIdx = code >= ZERO && code <= NINE
		}

		const existing = current[key]
		if (existing === undefined) {
			if (--budget.left < 0) return
			current = current[key] = nextIsArrayIdx ? [] : nullObject()
			continue
		}
		if (
			typeof existing === 'object' &&
			(!HAS_FILE || !(existing instanceof File))
		) {
			current = existing
			continue
		}
		if (typeof existing === 'string') {
			const parsed = tryParseJson(existing)
			if (parsed && !Array.isArray(parsed)) {
				current = current[key] = parsed
				continue
			}
		}
		if (--budget.left < 0) return
		current = current[key] = nextIsArrayIdx ? [] : nullObject()
	}
}

export function formDataToObject(form: FormData): Record<string, unknown> {
	const body: Record<string, unknown> = nullObject()

	let grouped: Map<string, FormDataEntryValue[]> | undefined
	form.forEach((value, key) => {
		const list = (grouped ??= new Map()).get(key)
		if (list) list.push(value)
		else grouped!.set(key, [value])
	})

	if (!grouped) return body

	const budget = { left: MAX_NESTED_NODES }
	for (const [key, entries] of grouped) {
		if (HAS_NESTING.test(key))
			setNested(body, key, resolveValue(entries), budget)
		else if (!(key in body)) body[key] = resolveValue(entries)
	}

	return body
}
