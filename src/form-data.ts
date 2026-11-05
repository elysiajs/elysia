const ARRAY_INDEX_REGEX = /^(.+)\[(\d+)\]$/
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const MAX_PATH_DEPTH = 32
const MAX_ARRAY_INDEX = 10_000
const MAX_ASSIGNMENTS = 20_000

const spend = (budget: { remaining: number }, cost = 1) => {
	if (budget.remaining < cost) return false

	budget.remaining -= cost
	return true
}

const growArray = (
	array: unknown[],
	index: number,
	budget: { remaining: number }
) => index < array.length || spend(budget, index - array.length + 1)

const isDangerousKey = (key: string) => {
	if (DANGEROUS_KEYS.has(key)) return true

	const match = key.match(ARRAY_INDEX_REGEX)
	return match ? DANGEROUS_KEYS.has(match[1]) : false
}

const parseArrayKey = (key: string) => {
	const match = key.match(ARRAY_INDEX_REGEX)
	if (!match) return

	const index = Number(match[2])
	if (!Number.isSafeInteger(index) || index > MAX_ARRAY_INDEX) return null

	return {
		name: match[1],
		index
	}
}

const parseObjectString = (entry: unknown) => {
	if (typeof entry !== 'string' || entry.charCodeAt(0) !== 123) return

	try {
		const parsed = JSON.parse(entry)
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
			return parsed
	} catch {}
}

const normalizeFormValue = (value: unknown[]) => {
	if (value.length === 1) {
		const stringValue = value[0]
		if (
			typeof stringValue === 'string' &&
			(stringValue.charCodeAt(0) === 123 ||
				stringValue.charCodeAt(0) === 91)
		)
			try {
				const parsed = JSON.parse(stringValue)
				if (parsed && typeof parsed === 'object') return parsed
			} catch {}

		return value[0]
	}

	const stringValue = value.find(
		(entry): entry is string => typeof entry === 'string'
	)
	if (!stringValue || typeof File === 'undefined') return value

	const files = value.filter((entry): entry is File => entry instanceof File)
	if (!files.length || stringValue.charCodeAt(0) !== 123) return value

	const parsed = parseObjectString(stringValue)
	if (!parsed) return value

	if (!('file' in parsed) && files.length === 1) parsed.file = files[0]
	else if (!('files' in parsed) && files.length > 1) parsed.files = files

	return parsed
}

const setNestedValue = (
	obj: Record<string, any>,
	path: string,
	value: unknown,
	budget: { remaining: number }
) => {
	const keys = path.split('.')
	if (keys.length > MAX_PATH_DEPTH) return

	const lastKey = keys.pop() as string
	if (isDangerousKey(lastKey) || keys.some(isDangerousKey)) return

	let current = obj
	for (const key of keys) {
		const arrayInfo = parseArrayKey(key)
		if (arrayInfo === null) return

		if (arrayInfo) {
			if (!Array.isArray(current[arrayInfo.name])) {
				if (!spend(budget)) return
				current[arrayInfo.name] = []
			}

			const array = current[arrayInfo.name]
			if (!growArray(array, arrayInfo.index, budget)) return

			const existing = array[arrayInfo.index]
			const isFile =
				typeof File !== 'undefined' && existing instanceof File

			if (
				!existing ||
				typeof existing !== 'object' ||
				Array.isArray(existing) ||
				isFile
			) {
				if (!spend(budget)) return
				array[arrayInfo.index] = parseObjectString(existing) ?? {}
			}

			current = array[arrayInfo.index]
			continue
		}

		if (!current[key] || typeof current[key] !== 'object') {
			if (!spend(budget)) return
			current[key] = {}
		}

		current = current[key]
	}

	const arrayInfo = parseArrayKey(lastKey)
	if (arrayInfo === null) return

	if (arrayInfo) {
		if (!Array.isArray(current[arrayInfo.name])) {
			if (!spend(budget)) return
			current[arrayInfo.name] = []
		}

		const array = current[arrayInfo.name]
		if (!growArray(array, arrayInfo.index, budget)) return
		if (!spend(budget)) return
		array[arrayInfo.index] = value
		return
	}

	if (!spend(budget)) return
	current[lastKey] = value
}

export const parseFormData = (form?: {
	forEach(
		callback: (value: unknown, key: string, parent: unknown) => void
	): void
}) => {
	const body: Record<string, unknown> = {}
	if (!form) return body

	const grouped = new Map<string, unknown[]>()
	form.forEach((value, key) => {
		const entries = grouped.get(key)
		if (entries) entries.push(value)
		else grouped.set(key, [value])
	})

	const budget = { remaining: MAX_ASSIGNMENTS }
	for (const [key, value] of grouped) {
		if (
			isDangerousKey(key) ||
			Object.prototype.hasOwnProperty.call(body, key)
		)
			continue

		const finalValue = normalizeFormValue(value)
		if (key.includes('.') || key.includes('['))
			setNestedValue(body, key, finalValue, budget)
		else if (spend(budget)) body[key] = finalValue
	}

	return body
}
