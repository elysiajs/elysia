/* eslint-disable sonarjs/public-static-readonly */
import { HasCodec } from 'typebox/value'
import type { TSchema } from 'typebox/type'
import type { Validator as BaseTypeBoxValidator } from 'typebox/schema'

import { deferCoercions, type CoerceOption } from '../coerce'
import { ELYSIA_TYPES } from '../constants'

import { nullObject } from '../../utils'
import { isCloudflareWorker } from '../../universal/constants'

const DEFAULT_CACHE_LIMIT = 1024
const DEFAULT_GC_TIME = 1 * 60 * 1000

export interface SchemaMeta {
	// A codec or an opaque node, eg. Refine function, may only be served by identity
	special: boolean
	hasRef: boolean
	hasFileType: boolean
	// Byte-identical to `JSON.stringify(schema, serializeKey)`
	key: string | undefined
}

const fnIds = new WeakMap<Function, number>()
let nextFnId = 0

export function fnKey(fn: Function) {
	let id = fnIds.get(fn)
	if (id === undefined) fnIds.set(fn, (id = ++nextFnId))

	return '<fn:' + id + '>'
}

// `mode` tracks whether a value sits on the structural path that isOpaque and
// hasRef are defined over — the same child set `schemaSome` descends:
//   NODE       a schema node; its flags count
//   CONTAINER  holds schema nodes as its members (`properties`, `anyOf`, …)
//   OFF        ordinary JSON data (`required`, `enum`, `$defs`, `default`, …)
const OFF = 0
const NODE = 1
const CONTAINER = 2

// eslint-disable-next-line no-control-regex
const needsEscape = /["\\\u0000-\u001f\ud800-\udfff]/

const quote = (value: string) =>
	needsEscape.test(value) ? JSON.stringify(value) : '"' + value + '"'

// `t.Cyclic` closes its loop through a `$ref` string, never an object edge
const MAX_DEPTH = 512

interface WalkState {
	isOpaque: boolean
	hasRef: boolean
	hasFileType: boolean
	buildKey: boolean
	forceKey: boolean
	depth: number
}

function childMode(key: string, value: unknown): number {
	switch (key) {
		case 'properties':
		case 'patternProperties':
			return CONTAINER

		case 'items':
			return Array.isArray(value) ? CONTAINER : NODE

		case 'anyOf':
		case 'allOf':
		case 'oneOf':
			return Array.isArray(value) ? CONTAINER : OFF

		case 'additionalProperties':
			return value && typeof value === 'object' ? NODE : OFF

		case 'not':
			return NODE

		default:
			return OFF
	}
}

function walk(
	value: any,
	key: string | number,
	mode: number,
	state: WalkState
) {
	if (value !== null && typeof value === 'object') {
		const elyTyp = value['~elyTyp']

		if (mode === NODE) {
			if (
				!state.isOpaque &&
				(value['~refine'] || elyTyp === ELYSIA_TYPES.NoValidate)
			) {
				state.isOpaque = true
				// the structural key is dead the moment the schema is opaque
				if (!state.forceKey) state.buildKey = false
			}

			if (!state.hasRef && value['$ref']) state.hasRef = true
		}

		if (
			!state.hasFileType &&
			(elyTyp === ELYSIA_TYPES.File || elyTyp === ELYSIA_TYPES.Files)
		)
			state.hasFileType = true

		const toJSON = value.toJSON
		if (typeof toJSON === 'function')
			value = toJSON.call(value, typeof key === 'number' ? '' + key : key)
	}

	if (typeof value === 'function')
		return state.buildKey ? quote(fnKey(value)) : ''

	if (value !== null && typeof value === 'object') {
		if (value instanceof Number) value = +value
		else if (value instanceof String) value = String(value)
		else if (value instanceof Boolean) value = value.valueOf()
		else {
			if (++state.depth > MAX_DEPTH)
				throw new TypeError('Converting circular structure to JSON')

			const serialized =
				value['~optional'] === true
					? walkOptional(value, mode, state)
					: Array.isArray(value)
						? walkArray(value, mode, state)
						: walkObject(value, mode, state)

			state.depth--

			return serialized
		}
	} else if (value === null) return 'null'

	switch (typeof value) {
		case 'string':
			return state.buildKey ? quote(value) : ''

		case 'number':
			return state.buildKey ? (isFinite(value) ? '' + value : 'null') : ''

		case 'boolean':
			return value ? 'true' : 'false'

		case 'bigint':
			return state.buildKey ? quote(value + 'n') : ''

		default:
			return
	}
}

// `Object.keys` is exactly `JSON.stringify`'s own-enumerable key order.
function walkObject(value: any, mode: number, state: WalkState): string {
	const keys = Object.keys(value)

	let serialized = '{'
	let first = true

	for (let i = 0; i < keys.length; i++) {
		const key = keys[i]!
		const child = value[key]

		const piece = walk(
			child,
			key,
			mode === CONTAINER
				? NODE
				: mode === NODE
					? childMode(key, child)
					: OFF,
			state
		)
		if (piece === undefined) continue

		if (state.buildKey) {
			if (first) first = false
			else serialized += ','

			serialized += quote(key) + ':' + piece
		}
	}

	return serialized + '}'
}

function walkOptional(value: any, mode: number, state: WalkState): string {
	let serialized = '{'
	let first = true
	let emittedOptional = false

	for (const key in value) {
		const child = value[key]

		const piece = walk(
			child,
			key,
			mode === CONTAINER
				? NODE
				: mode === NODE
					? childMode(key, child)
					: OFF,
			state
		)

		if (key === '~optional') emittedOptional = true
		if (piece === undefined) continue

		if (state.buildKey) {
			if (first) first = false
			else serialized += ','

			serialized += quote(key) + ':' + piece
		}
	}

	if (!emittedOptional && state.buildKey) {
		if (!first) serialized += ','
		serialized += '"~optional":true'
	}

	return serialized + '}'
}

function walkArray(value: any[], mode: number, state: WalkState): string {
	const elementMode = mode === CONTAINER ? NODE : OFF

	let serialized = '['

	for (let i = 0; i < value.length; i++) {
		const piece = walk(value[i], i, elementMode, state)

		if (state.buildKey) {
			if (i) serialized += ','
			serialized += piece === undefined ? 'null' : piece
		}
	}

	return serialized + ']'
}

function computeSchemaMeta(schema: TSchema, forceKey: boolean): SchemaMeta {
	const hasCodec = HasCodec(schema)

	const state: WalkState = {
		isOpaque: false,
		hasRef: false,
		hasFileType: false,
		forceKey,
		buildKey: forceKey || !hasCodec,
		depth: 0
	}

	const key = walk(schema, '', NODE, state)
	const special = hasCodec || state.isOpaque

	return {
		special,
		hasRef: state.hasRef,
		hasFileType: state.hasFileType,
		key: forceKey ? key : special ? '' : key
	}
}

export const schemaCacheKey = (schema: TSchema) =>
	computeSchemaMeta(schema, true).key

export const mayHaveFileType = (schema: object) =>
	!('~standard' in schema) &&
	TypeBoxValidatorCache.meta(schema as TSchema).hasFileType

export class TypeBoxValidatorCache {
	private static EMPTY = nullObject() as {}

	#cache = new Map<
		string,
		WeakMap<
			CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
			BaseTypeBoxValidator
		>
	>()

	#referenceCache = new WeakMap<
		TSchema,
		Map<
			string,
			WeakMap<
				CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
				BaseTypeBoxValidator
			>
		>
	>()

	#gc: ReturnType<typeof setTimeout> | undefined
	#gcTime: number

	static #modelsIds = new WeakMap<object, number>()
	static #nextModelsId = 0

	static #modelsToken(models: object | undefined, hasRef: boolean): string {
		if (!hasRef || !models) return ''

		let id = TypeBoxValidatorCache.#modelsIds.get(models)
		if (id === undefined) {
			id = ++TypeBoxValidatorCache.#nextModelsId
			TypeBoxValidatorCache.#modelsIds.set(models, id)
		}
		return '@m' + id
	}

	static #lastSchema: TSchema | undefined
	static #lastMeta: SchemaMeta | undefined

	static #metaCache = new WeakMap<TSchema, SchemaMeta>()

	static meta(schema: TSchema): SchemaMeta {
		if (
			TypeBoxValidatorCache.#lastSchema === schema &&
			TypeBoxValidatorCache.#lastMeta
		)
			return TypeBoxValidatorCache.#lastMeta

		let meta = TypeBoxValidatorCache.#metaCache.get(schema)
		if (!meta) {
			meta = computeSchemaMeta(schema, false)
			TypeBoxValidatorCache.#metaCache.set(schema, meta)
		}

		TypeBoxValidatorCache.#lastSchema = schema
		TypeBoxValidatorCache.#lastMeta = meta

		return meta
	}

	constructor(gcTime: number = DEFAULT_GC_TIME) {
		this.#gcTime = gcTime
	}

	#scheduleClear() {
		if (isCloudflareWorker) return

		if (this.#gc) clearTimeout(this.#gc)

		this.#gc = setTimeout(() => this.clear(), this.#gcTime)
		;(this.#gc as any).unref?.()
	}

	get(
		schema: TSchema,
		coercions:
			| CoerceOption[]
			| typeof TypeBoxValidatorCache.EMPTY = TypeBoxValidatorCache.EMPTY,
		normalize = '',
		models?: object
	) {
		const meta = TypeBoxValidatorCache.meta(schema)

		normalize += TypeBoxValidatorCache.#modelsToken(models, meta.hasRef)

		const refBucket = this.#referenceCache.get(schema)?.get(normalize)
		if (refBucket?.has(coercions)) return refBucket.get(coercions)

		if (meta.special) return

		const key = meta.key + '\0' + normalize
		const coercionsCache = this.#cache.get(key)

		if (coercionsCache) {
			this.#cache.delete(key)
			this.#cache.set(key, coercionsCache)

			if (coercionsCache.has(coercions))
				return coercionsCache.get(coercions)
		}
	}

	#refBucket(schema: TSchema) {
		let byNormalize = this.#referenceCache.get(schema)
		if (!byNormalize) {
			byNormalize = new Map()
			this.#referenceCache.set(schema, byNormalize)
		}

		return byNormalize
	}

	set(
		schema: TSchema,
		coercions:
			| CoerceOption[]
			| typeof TypeBoxValidatorCache.EMPTY = TypeBoxValidatorCache.EMPTY,
		validator?: BaseTypeBoxValidator,
		normalize = '',
		models?: object
	) {
		this.#scheduleClear()
		const meta = TypeBoxValidatorCache.meta(schema)

		normalize += TypeBoxValidatorCache.#modelsToken(models, meta.hasRef)

		if (meta.special) {
			const cache = new WeakMap().set(coercions, validator) as WeakMap<
				CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
				BaseTypeBoxValidator
			>
			this.#refBucket(schema).set(normalize, cache)

			return
		}

		const key = meta.key + '\0' + normalize
		if (this.#cache.has(key)) {
			const cache = this.#cache.get(key)!.set(coercions, validator!)
			const byNormalize = this.#refBucket(schema)

			if (byNormalize.has(normalize))
				byNormalize.get(normalize)!.set(coercions, validator!)
			else byNormalize.set(normalize, cache)

			return
		}

		if (this.#cache.size >= DEFAULT_CACHE_LIMIT) {
			const oldest = this.#cache.keys().next().value
			if (oldest !== undefined) this.#cache.delete(oldest)
		}

		const cache = new WeakMap().set(coercions, validator) as WeakMap<
			CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
			BaseTypeBoxValidator
		>
		this.#cache.set(key, cache)
		this.#refBucket(schema).set(normalize, cache)
	}

	clear() {
		if (this.#gc) {
			clearTimeout(this.#gc)
			this.#gc = undefined
		}

		this.#cache.clear()
		this.#referenceCache = new WeakMap()

		// the 1-slot fast path is process-wide now, so it has to be released here
		// or `clear()` will keep last schema alive on its own
		TypeBoxValidatorCache.#lastSchema = undefined
		TypeBoxValidatorCache.#lastMeta = undefined

		deferCoercions()
	}
}
