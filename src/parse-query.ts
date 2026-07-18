import { decodeComponent } from 'deuri'

import {
	ELYSIA_TYPES,
	VALIDATION_PLAN_FUSED_QUERY,
	VALIDATION_PLAN_ORACLE,
	VALIDATION_PLAN_QUERY
} from './type/constants'

// bit flags
const KEY_HAS_PLUS = 1
const KEY_NEEDS_DECODE = 2
const VALUE_HAS_PLUS = 4
const VALUE_NEEDS_DECODE = 8

function splitRawParts(raw: string, flags: number) {
	const parts = raw.split(',')
	if (flags & VALUE_NEEDS_DECODE)
		for (let i = 0; i < parts.length; i++)
			parts[i] = decodeComponent(parts[i]) ?? parts[i]

	return parts
}

// Parse query without array
export function parseQueryFromURL(
	input: string,
	startIndex = input.indexOf('?', 11),
	array?: Readonly<Record<string, 1>>,
	object?: Readonly<Record<string, 1>>
): Record<string, string> {
	const result = Object.create(null)
	if (startIndex === -1) return result

	let flags = 0

	const inputLength = input.length
	let startingIndex = startIndex
	let equalityIndex = startingIndex

	for (let i = startIndex + 1; i < inputLength; i++)
		switch (input.charCodeAt(i)) {
			// '&'
			case 38:
				processKeyValuePair(input, i)

				// Reset state variables
				startingIndex = i
				equalityIndex = i
				flags = 0

				break

			// '='
			case 61:
				if (equalityIndex <= startingIndex) equalityIndex = i
				// If '=' character occurs again, we should decode the input
				else flags |= VALUE_NEEDS_DECODE

				break

			// '+'
			case 43:
				if (equalityIndex > startingIndex) flags |= VALUE_HAS_PLUS
				else flags |= KEY_HAS_PLUS

				break

			// '%'
			case 37:
				if (equalityIndex > startingIndex) flags |= VALUE_NEEDS_DECODE
				else flags |= KEY_NEEDS_DECODE

				break
		}

	// Process the last pair if needed
	if (startingIndex < inputLength) processKeyValuePair(input, inputLength)

	return result

	function processKeyValuePair(input: string, endIndex: number) {
		const hasBothKeyValuePair = equalityIndex > startingIndex
		const effectiveEqualityIndex = hasBothKeyValuePair
			? equalityIndex
			: endIndex

		const keySlice = input.slice(startingIndex + 1, effectiveEqualityIndex)

		// Skip processing if key is empty
		if (!hasBothKeyValuePair && keySlice.length === 0) return

		let finalKey = keySlice
		if (flags & KEY_HAS_PLUS) finalKey = finalKey.replace(/\+/g, ' ')
		if (flags & KEY_NEEDS_DECODE)
			finalKey = decodeComponent(finalKey) || finalKey

		let finalValue = ''
		if (hasBothKeyValuePair) {
			let valueSlice = input.slice(equalityIndex + 1, endIndex)
			if (flags & VALUE_HAS_PLUS)
				valueSlice = valueSlice.replace(/\+/g, ' ')
			if (flags & VALUE_NEEDS_DECODE)
				valueSlice = decodeComponent(valueSlice) || valueSlice
			finalValue = valueSlice
		}

		const currentValue = result[finalKey]

		if (array && array?.[finalKey]) {
			let rawValue = hasBothKeyValuePair
				? input.slice(equalityIndex + 1, endIndex)
				: ''

			if (flags & VALUE_HAS_PLUS) rawValue = rawValue.replace(/\+/g, ' ')

			const rawBracket =
				rawValue.charCodeAt(0) === 91 &&
				rawValue.charCodeAt(rawValue.length - 1) === 93
			const decodedBracket =
				!rawBracket &&
				finalValue.charCodeAt(0) === 91 &&
				(finalValue as string).charCodeAt(
					(finalValue as string).length - 1
				) === 93

			if (rawBracket || decodedBracket) {
				// 'ids=[]' is an explicit empty array, not ['']
				let toBracketArray: any
				if (rawBracket)
					toBracketArray =
						rawValue.length === 2
							? []
							: splitRawParts(rawValue.slice(1, -1), flags)
				else {
					const inner = (finalValue as string).slice(1, -1)
					toBracketArray = inner === '' ? [] : inner.split(',')
				}

				if (object && object?.[finalKey])
					try {
						finalValue = JSON.parse(finalValue) as any
					} catch {
						finalValue = toBracketArray
					}
				else finalValue = toBracketArray

				if (currentValue === undefined) result[finalKey] = finalValue
				else if (Array.isArray(currentValue))
					for (let i = 0; i < finalValue.length; i++)
						currentValue.push(finalValue[i])
				else {
					result[finalKey] = finalValue
					result[finalKey].unshift(currentValue)
				}
			} else {
				if (
					object &&
					object?.[finalKey] &&
					finalValue.charCodeAt(0) === 123
				) {
					try {
						finalValue = JSON.parse(finalValue) as any
					} catch {}
				} else if (
					currentValue === undefined &&
					!(object && object?.[finalKey]) &&
					rawValue.indexOf(',') !== -1
				)
					finalValue = splitRawParts(rawValue, flags) as any

				if (currentValue === undefined) {
					result[finalKey] = Array.isArray(finalValue)
						? finalValue
						: [finalValue]
				} else if (Array.isArray(currentValue))
					currentValue.push(finalValue)
				else result[finalKey] = [currentValue, finalValue]
			}
		} else if (object?.[finalKey] && finalValue.charCodeAt(0) === 123) {
			try {
				result[finalKey] = JSON.parse(finalValue)
			} catch {
				result[finalKey] = finalValue
			}
		} else {
			result[finalKey] = finalValue
		}
	}
}

export interface QueryPlan {
	readonly parse: typeof parseQueryFromURL
	readonly array?: Readonly<Record<string, 1>>
	readonly object?: Readonly<Record<string, 1>>
	readonly fused?: true
	readonly fromURL?: (
		this: QueryPlan,
		input: string,
		startIndex: number
	) => Record<string, unknown>
	readonly validate?: (
		this: QueryPlan,
		value: Record<string, unknown>,
		oracle: QueryOracle
	) => Record<string, unknown>
	readonly scalarRoot?: any
	readonly scalarIndex?: Readonly<Record<string, number>>
}

type QueryOracle = {
	From(value: unknown, type?: string): unknown
	[VALIDATION_PLAN_ORACLE](value: unknown, type?: string): unknown
}

type ScalarKind = 3 | 4 | 5 | 6

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/
const integer = /^[+-]?\d+$/
const invalidScalar = Symbol('elysia.query.invalid')
const invalidFusedQueries = new WeakSet<Record<string, unknown>>()
const scalarQueryPlans = new WeakMap<object, QueryPlan>()

function scalarQueryPlan(
	validator: any,
	exactBuiltIn: boolean
): QueryPlan | undefined {
	if (
		!exactBuiltIn ||
		validator?.[VALIDATION_PLAN_FUSED_QUERY] !== true ||
		validator.isAsync !== false ||
		validator.mayReturnPromise !== false ||
		typeof validator.From !== 'function' ||
		typeof validator[VALIDATION_PLAN_ORACLE] !== 'function'
	)
		return

	const cached = scalarQueryPlans.get(validator)
	if (cached) return cached

	const root = validator?.plan?.root
	if (
		root?.kind !== 1 ||
		root.optional ||
		root.string ||
		root.min !== undefined ||
		root.max !== undefined ||
		(root.additional !== 0 && root.additional !== 2) ||
		!Array.isArray(root.keys) ||
		!Array.isArray(root.properties) ||
		root.keys.length !== root.properties.length ||
		root.keys.length > 8 ||
		!(root.required instanceof Set)
	)
		return

	const index: Record<string, number> = Object.create(null)
	for (let i = 0; i < root.keys.length; i++) {
		const key = root.keys[i]
		const node = root.properties[i]
		if (
			typeof key !== 'string' ||
			key === '__proto__' ||
			key === 'constructor' ||
			key === 'prototype' ||
			!node
		)
			return

		let kind: ScalarKind
		if (node.kind === 3) {
			if (
				node.min !== undefined ||
				node.max !== undefined ||
				node.pattern !== undefined
			)
				return
			kind = 3
		} else if (node.kind === 4) {
			if (
				(node.coerce !== 1 && node.coerce !== 2) ||
				node.explicit ||
				node.minimum !== undefined ||
				node.maximum !== undefined ||
				node.exclusiveMinimum !== undefined ||
				node.exclusiveMaximum !== undefined ||
				node.multipleOf !== undefined
			)
				return
			kind = node.integer ? 6 : 4
		} else if (node.kind === 5 && node.coerce === 3 && !node.explicit)
			kind = 5
		else return

		if (node.hasDefault) {
			const defaultValue = coerceScalar(kind, node.defaultValue)
			if (defaultValue === invalidScalar) return
		}
		index[key] = i
	}
	Object.freeze(index)

	const plan: QueryPlan = Object.freeze({
		parse: parseQueryFromURL,
		fused: true as const,
		fromURL: parseScalarQueryFromURL,
		validate: validateScalarQuery,
		scalarRoot: root,
		scalarIndex: index
	})
	scalarQueryPlans.set(validator, plan)

	return plan
}

function coerceScalar(kind: ScalarKind, value: unknown) {
	if (kind === 3) return typeof value === 'string' ? value : invalidScalar
	if (kind === 5) {
		if (value === 'true') return true
		if (value === 'false') return false
		return typeof value === 'boolean' ? value : invalidScalar
	}
	if (typeof value === 'number')
		return Number.isFinite(value) && (kind !== 6 || Number.isInteger(value))
			? value
			: invalidScalar
	if (
		typeof value !== 'string' ||
		!(kind === 6 ? integer : decimal).test(value)
	)
		return invalidScalar
	const numeric = +value
	return Number.isFinite(numeric) && (kind !== 6 || Number.isInteger(numeric))
		? numeric
		: invalidScalar
}

function parseScalarQueryFromURL(
	this: QueryPlan,
	input: string,
	startIndex: number
) {
	const root = this.scalarRoot!
	const index = this.scalarIndex!
	const result: Record<string, unknown> = Object.create(null)
	let invalid = false
	let reorder = false
	let lastOrder = -1
	let seen = 0
	let flags = 0
	let startingIndex = startIndex
	let equalityIndex = startIndex

	if (startIndex !== -1) {
		for (let i = startIndex + 1; i < input.length; i++)
			switch (input.charCodeAt(i)) {
				case 38:
					processPair(i)
					startingIndex = i
					equalityIndex = i
					flags = 0
					break
				case 61:
					if (equalityIndex <= startingIndex) equalityIndex = i
					else flags |= VALUE_NEEDS_DECODE
					break
				case 43:
					if (equalityIndex > startingIndex) flags |= VALUE_HAS_PLUS
					else flags |= KEY_HAS_PLUS
					break
				case 37:
					if (equalityIndex > startingIndex)
						flags |= VALUE_NEEDS_DECODE
					else flags |= KEY_NEEDS_DECODE
					break
			}

		if (startingIndex < input.length) processPair(input.length)
	}

	for (let i = 0; i < root.keys.length; i++) {
		const bit = 1 << i
		const node = root.properties[i]
		if (seen & bit) {
			if (result[root.keys[i]!] === invalidScalar) invalid = true
		} else if (node.hasDefault) {
			if (i < lastOrder) reorder = true
			lastOrder = i
			seen |= bit
			result[root.keys[i]!] = coerceScalar(
				node.kind === 4 && node.integer ? 6 : node.kind,
				node.defaultValue
			)
		} else if (root.required.has(root.keys[i])) invalid = true
	}
	if (!invalid && reorder) reorderResult()

	if (!invalid) return result

	const raw = parseQueryFromURL(input, startIndex)
	invalidFusedQueries.add(raw)
	return raw

	function processPair(endIndex: number) {
		const hasValue = equalityIndex > startingIndex
		const equal = hasValue ? equalityIndex : endIndex
		let key = input.slice(startingIndex + 1, equal)
		if (!hasValue && key.length === 0) return
		if (flags & KEY_HAS_PLUS) key = key.replace(/\+/g, ' ')
		if (flags & KEY_NEEDS_DECODE) key = decodeComponent(key) || key

		const order = index[key]
		if (order === undefined) {
			if (root.additional === 2) invalid = true
			return
		}
		const bit = 1 << order
		if (!(seen & bit)) {
			if (order < lastOrder) reorder = true
			lastOrder = order
			seen |= bit
		}

		let value = hasValue ? input.slice(equalityIndex + 1, endIndex) : ''
		if (flags & VALUE_HAS_PLUS) value = value.replace(/\+/g, ' ')
		if (flags & VALUE_NEEDS_DECODE) value = decodeComponent(value) || value
		const node = root.properties[order]
		result[key] = coerceScalar(
			node.kind === 4 && node.integer ? 6 : node.kind,
			value
		)
	}

	function reorderResult() {
		const values = new Array(root.keys.length)
		for (let i = 0; i < root.keys.length; i++) {
			if (!(seen & (1 << i))) continue
			const key = root.keys[i]!
			values[i] = result[key]
			delete result[key]
		}
		for (let i = 0; i < root.keys.length; i++)
			if (seen & (1 << i)) result[root.keys[i]!] = values[i]
	}
}

function validateScalarQuery(
	this: QueryPlan,
	value: Record<string, unknown>,
	oracle: QueryOracle
) {
	if (!invalidFusedQueries.delete(value)) return value
	return oracle[VALIDATION_PLAN_ORACLE](value, 'query') as Record<
		string,
		unknown
	>
}

function arrayItemSchema(value: any, seen = new WeakSet<object>()): any {
	if (!value || typeof value !== 'object' || seen.has(value)) return
	seen.add(value)
	if (value.type === 'array' || value['~kind'] === 'Array') return value.items
	if (Array.isArray(value.anyOf))
		for (const member of value.anyOf) {
			const item = arrayItemSchema(member, seen)
			if (item) return item
		}
}

function containsObjectSchema(value: any, seen = new WeakSet<object>()) {
	if (!value || typeof value !== 'object' || seen.has(value)) return false
	seen.add(value)
	if (value.type === 'object' || value['~kind'] === 'Object') return true
	if (Array.isArray(value.anyOf))
		return value.anyOf.some((member: any) =>
			containsObjectSchema(member, seen)
		)

	return false
}

function containsArray(value: any, seen?: WeakSet<object>) {
	if (!value || typeof value !== 'object') return false
	if (seen?.has(value)) return false

	if (value.type === 'array' || value['~kind'] === 'Array') return true
	if (value['~elyTyp'] === ELYSIA_TYPES.ArrayString) return true

	for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
		const members = value[key]
		if (Array.isArray(members)) {
			seen ??= new WeakSet<object>()
			seen.add(value)
			for (const member of members)
				if (containsArray(member, seen)) return true
		}
	}

	return false
}

function collectQueryPlan(
	node: any,
	seen: WeakSet<object>,
	state: {
		array?: Record<string, 1>
		object?: Record<string, 1>
	}
) {
	if (!node || typeof node !== 'object' || seen.has(node)) return
	seen.add(node)

	const properties = node.properties
	const validationPlan = node[VALIDATION_PLAN_QUERY] === true
	if (properties)
		for (const key in properties) {
			const value = properties[key]
			const isArray = containsArray(value)

			if (isArray) (state.array ??= Object.create(null))[key] = 1
			if (
				(isArray && containsObjectSchema(arrayItemSchema(value))) ||
				value?.['~elyTyp'] === ELYSIA_TYPES.ObjectString ||
				(validationPlan && containsObjectSchema(value))
			)
				(state.object ??= Object.create(null))[key] = 1
		}

	for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
		const members = node[key]
		if (Array.isArray(members))
			for (const member of members) collectQueryPlan(member, seen, state)
	}
}

const emptyQueryPlan: QueryPlan = Object.freeze({ parse: parseQueryFromURL })
export function createQueryPlan(
	querySchema: any,
	validator?: any,
	exactBuiltIn = false
): QueryPlan {
	if (!querySchema || typeof querySchema !== 'object') return emptyQueryPlan
	const fused = scalarQueryPlan(validator, exactBuiltIn)
	if (fused) return fused

	const state: {
		array?: Record<string, 1>
		object?: Record<string, 1>
	} = {}
	collectQueryPlan(querySchema, new WeakSet(), state)
	if (!state.array && !state.object) return emptyQueryPlan

	return Object.freeze({
		parse: parseQueryFromURL,
		array: state.array ? Object.freeze(state.array) : undefined,
		object: state.object ? Object.freeze(state.object) : undefined
	})
}

export function getQueryParseChannels(querySchema: any) {
	const plan = createQueryPlan(querySchema)
	if (plan.array || plan.object) return plan
}

/**
 * @callback parse
 * @param {string} input
 */
export function parseQuery(input: string) {
	const result = Object.create(null) as Record<string, string | string[]>

	let flags = 0

	const inputLength = input.length
	let startingIndex = -1
	let equalityIndex = -1

	for (let i = 0; i < inputLength; i++)
		switch (input.charCodeAt(i)) {
			// '&'
			case 38:
				processKeyValuePair(input, i)

				// Reset state variables
				startingIndex = i
				equalityIndex = i
				flags = 0

				break

			// '='
			case 61:
				if (equalityIndex <= startingIndex) equalityIndex = i
				// If '=' character occurs again, we should decode the input
				else flags |= VALUE_NEEDS_DECODE

				break

			// '+'
			case 43:
				if (equalityIndex > startingIndex) flags |= VALUE_HAS_PLUS
				else flags |= KEY_HAS_PLUS

				break

			// '%'
			case 37:
				if (equalityIndex > startingIndex) flags |= VALUE_NEEDS_DECODE
				else flags |= KEY_NEEDS_DECODE

				break
		}

	// Process the last pair if needed
	if (startingIndex < inputLength) processKeyValuePair(input, inputLength)

	return result

	function processKeyValuePair(input: string, endIndex: number) {
		const hasBothKeyValuePair = equalityIndex > startingIndex
		const effectiveEqualityIndex = hasBothKeyValuePair
			? equalityIndex
			: endIndex

		const keySlice = input.slice(startingIndex + 1, effectiveEqualityIndex)

		// Skip processing if key is empty
		if (!hasBothKeyValuePair && keySlice.length === 0) return

		let finalKey = keySlice
		if (flags & KEY_HAS_PLUS) finalKey = finalKey.replace(/\+/g, ' ')
		if (flags & KEY_NEEDS_DECODE)
			finalKey = decodeComponent(finalKey) || finalKey

		let finalValue = ''
		if (hasBothKeyValuePair) {
			let valueSlice = input.slice(equalityIndex + 1, endIndex)
			if (flags & VALUE_HAS_PLUS)
				valueSlice = valueSlice.replace(/\+/g, ' ')
			if (flags & VALUE_NEEDS_DECODE)
				valueSlice = decodeComponent(valueSlice) || valueSlice
			finalValue = valueSlice
		}

		const currentValue = result[finalKey]
		if (currentValue === undefined) result[finalKey] = finalValue
		else if (Array.isArray(currentValue)) currentValue.push(finalValue)
		else result[finalKey] = [currentValue, finalValue]
	}
}
