/**
 * Alternative interpretation of a multipart body where single-value
 * fields containing serialized JSON are deserialized
 *
 * Set on the request context by the form data parser so body validation
 * can fall back to it when the schema expects structured data
 */
export const ELYSIA_STRUCTURED_FORM = Symbol('ElysiaStructuredForm')

/**
 * Matches array index notation in property paths
 * Examples:
 *   "users[0]"  → Group 1: "users", Group 2: "0"
 *   "items[42]" → Group 1: "items", Group 2: "42"
 *   "a[123]"    → Group 1: "a",     Group 2: "123"
 *
 * Does not match:
 *   "users"     → no brackets
 *   "users[]"   → no index
 *   "users[ab]" → non-numeric index
 */
const ARRAY_INDEX_REGEX = /^(.+)\[(\d+)\]$/
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const isDangerousKey = (key: string): boolean => {
	if (DANGEROUS_KEYS.has(key)) return true

	const match = key.match(ARRAY_INDEX_REGEX)
	return match ? DANGEROUS_KEYS.has(match[1]) : false
}

const parseArrayKey = (key: string) => {
	const match = key.match(ARRAY_INDEX_REGEX)
	if (!match) return null

	return {
		name: match[1],
		index: parseInt(match[2], 10)
	}
}

const parseObjectString = (entry: unknown) => {
	if (typeof entry !== 'string' || entry.charCodeAt(0) !== 123) return

	try {
		const parsed = JSON.parse(entry)
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
			return parsed
	} catch {
		return
	}
}

const setNestedValue = (obj: Record<string, any>, path: string, value: any) => {
	const keys = path.split('.')
	const lastKey = keys.pop() as string

	// Validate all keys upfront
	if (isDangerousKey(lastKey) || keys.some(isDangerousKey)) return

	let current = obj

	// Traverse intermediate keys
	for (const key of keys) {
		const arrayInfo = parseArrayKey(key)

		if (arrayInfo) {
			// Initialize array if needed
			if (!Array.isArray(current[arrayInfo.name]))
				current[arrayInfo.name] = []

			const existing = current[arrayInfo.name][arrayInfo.index]
			const isFile =
				typeof File !== 'undefined' && existing instanceof File

			// Initialize object at index if needed
			if (
				!existing ||
				typeof existing !== 'object' ||
				Array.isArray(existing) ||
				isFile
			)
				current[arrayInfo.name][arrayInfo.index] =
					parseObjectString(existing) ?? {}

			current = current[arrayInfo.name][arrayInfo.index]
		} else {
			// Initialize object property if needed
			if (!current[key] || typeof current[key] !== 'object')
				current[key] = {}

			current = current[key]
		}
	}

	// Set final value
	const arrayInfo = parseArrayKey(lastKey)

	if (arrayInfo) {
		if (!Array.isArray(current[arrayInfo.name]))
			current[arrayInfo.name] = []

		current[arrayInfo.name][arrayInfo.index] = value
	} else {
		current[lastKey] = value
	}
}

const normalizeFormValue = (value: unknown[]) => {
	if (value.length === 1) return value[0]

	const stringValue = value.find(
		(entry): entry is string => typeof entry === 'string'
	)
	if (!stringValue) return value

	if (typeof File === 'undefined') return value
	const files = value.filter((entry): entry is File => entry instanceof File)
	if (!files.length) return value

	if (stringValue.charCodeAt(0) !== 123) return value

	let parsed: unknown
	try {
		parsed = JSON.parse(stringValue)
	} catch {
		return value
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
		return value

	if (!('file' in parsed) && files.length === 1)
		(parsed as Record<string, unknown>).file = files[0]
	else if (!('files' in parsed) && files.length > 1)
		(parsed as Record<string, unknown>).files = files

	return parsed
}

const parseStructuredValue = (value: string) => {
	const code = value.charCodeAt(0)
	// Only values that look like JSON objects ('{') or arrays ('[')
	if (code !== 123 && code !== 91) return

	try {
		const parsed = JSON.parse(value)
		if (parsed && typeof parsed === 'object') return parsed
	} catch {
		return
	}
}

/**
 * Normalize a FormData into a body object
 *
 * The returned `body` preserves every single-value field as submitted so
 * schemas expecting text receive the original string. When at least one
 * single-value field looks like serialized JSON, `structured` holds the
 * variant where those fields are deserialized so schemas expecting
 * objects or arrays keep accepting JSON-serialized fields
 */
export const parseFormData = (
	// Structural type to accept both the DOM and Node FormData
	form: { forEach(callbackfn: (value: any, key: string) => void): void }
): {
	body: Record<string, any>
	structured: Record<string, any> | undefined
} => {
	const grouped = new Map<string, any[]>()
	form.forEach((value, key) => {
		const list = grouped.get(key)
		if (list) list.push(value)
		else grouped.set(key, [value])
	})

	let hasStructured = false
	for (const [, value] of grouped) {
		if (value.length !== 1 || typeof value[0] !== 'string') continue

		const code = (value[0] as string).charCodeAt(0)
		if (code === 123 || code === 91) {
			hasStructured = true
			break
		}
	}

	const body: Record<string, any> = {}
	const structured: Record<string, any> | undefined = hasStructured
		? {}
		: undefined

	for (const [key, value] of grouped) {
		if (body[key]) continue

		const finalValue = normalizeFormValue(value)

		let structuredValue = finalValue
		if (
			structured &&
			value.length === 1 &&
			typeof finalValue === 'string'
		)
			structuredValue = parseStructuredValue(finalValue) ?? finalValue

		if (key.includes('.') || key.includes('[')) {
			setNestedValue(body, key, finalValue)
			if (structured) setNestedValue(structured, key, structuredValue)
		} else {
			body[key] = finalValue
			if (structured) structured[key] = structuredValue
		}
	}

	return { body, structured }
}
