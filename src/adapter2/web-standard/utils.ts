const DANGEROUS = new Set(['__proto__', 'constructor', 'prototype'])

type FormDataEntryValue = string | File

const Ch = {
	Dot: 46, // '.'
	BracketO: 91, // '['
	BracketC: 93, // ']'
	Quote1: 39, // "'"
	Quote2: 34, // '"'
	Zero: 48,
	Nine: 57,
	BraceO: 123, // '{'
	BraceL: 91 // '['
} as const

function tryParseJson(
	val: string
): Record<string, unknown> | unknown[] | undefined {
	const code = val.charCodeAt(0)
	if (code !== Ch.BraceO && code !== Ch.BraceL) return

	try {
		const p = JSON.parse(val)
		return p && typeof p === 'object' ? p : undefined
	} catch {}
}

function tryParseJsonObject(val: unknown) {
	if (typeof val !== 'string') return

	const v = tryParseJson(val)
	return v && !Array.isArray(v) ? v : undefined
}

function resolveValue(entries: FormDataEntryValue[]): unknown {
	const length = entries.length

	if (length === 1) {
		const v = entries[0]
		return typeof v === 'string' ? (tryParseJson(v) ?? v) : v
	}

	// Multiple entries — check for File + JSON pattern
	let jsonString: string | undefined
	let fileCount = 0
	const hasFile = typeof File !== 'undefined'

	for (let i = 0; i < length; i++) {
		const entry = entries[i]

		if (typeof entry === 'string') {
			if (jsonString === undefined && entry.charCodeAt(0) === Ch.BraceO)
				jsonString = entry
		} else if (hasFile && entry instanceof File) fileCount++
	}

	if (fileCount && jsonString) {
		const object = tryParseJsonObject(jsonString)

		if (object) {
			if (!('file' in object) && fileCount === 1) {
				for (let i = 0; i < length; i++)
					if (entries[i] instanceof File) {
						object.file = entries[i]
						break
					}
			} else if (!('files' in object)) {
				const files: File[] = []
				for (let i = 0; i < length; i++)
					if (entries[i] instanceof File)
						files.push(entries[i] as File)

				object.files = files
			}

			return object
		}
	}

	const result: unknown[] = new Array(length)
	for (let i = 0; i < length; i++) {
		const e = entries[i]
		result[i] = typeof e === 'string' ? (tryParseJson(e) ?? e) : e
	}

	return result
}

function setNested(
	body: Record<string, unknown>,
	path: string,
	value: unknown
): void {
	let current: any = body
	let i = 0
	const len = path.length

	while (i < len) {
		let key: string | number
		let nextIsArrayIdx = false

		if (path.charCodeAt(i) === Ch.BracketO) {
			const ch2 = path.charCodeAt(++i)

			if (ch2 === Ch.Quote1 || ch2 === Ch.Quote2) {
				// ['key'] or ["key"]
				const start = ++i
				while (path.charCodeAt(i) !== ch2) i++
				key = path.slice(start, i)
				i += 2 // skip quote + ]
			} else {
				// [0]
				const start = i
				while (path.charCodeAt(i) !== Ch.BracketC) i++
				key = +path.slice(start, i)
				i++ // skip ]
			}
		} else {
			// bare key
			const start = i
			while (i < len) {
				const c = path.charCodeAt(i)
				if (c === Ch.Dot || c === Ch.BracketO) break
				i++
			}
			key = path.slice(start, i)
		}

		// skip trailing dot
		if (path.charCodeAt(i) === Ch.Dot) i++

		// dangerous key check
		if (typeof key === 'string' && DANGEROUS.has(key)) return

		// last segment?
		if (i >= len) {
			current[key] = value
			return
		}

		// lookahead: does next segment need array?
		if (path.charCodeAt(i) === Ch.BracketO) {
			const code = path.charCodeAt(i + 1)
			nextIsArrayIdx = code >= Ch.Zero && code <= Ch.Nine
		}

		// ensure container
		const existing = current[key]
		if (existing != null && typeof existing === 'object') {
			if (typeof File === 'undefined' || !(existing instanceof File)) {
				current = existing
				continue
			}
		}

		const parsed = tryParseJsonObject(existing)
		if (parsed) {
			current = current[key] = parsed
			continue
		}

		current = current[key] = nextIsArrayIdx ? [] : Object.create(null)
	}
}

export function formDataToObject(form: FormData): Record<string, unknown> {
	const body: Record<string, unknown> = Object.create(null)

	for (const key of form.keys()) {
		if (key in body) continue

		const value = resolveValue(form.getAll(key))

		// fast path — no nesting
		if (key.indexOf('.') === -1 && key.indexOf('[') === -1) {
			body[key] = value
			continue
		}

		setNested(body, key, value)
	}

	return body
}
