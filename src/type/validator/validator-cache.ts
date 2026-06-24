import { HasCodec } from 'typebox/value'
import type { TSchema } from 'typebox/type'
import type { Validator as BaseTypeBoxValidator } from 'typebox/schema'

import { CoerceOption, deferCoercions } from '../coerce'
import { ELYSIA_TYPES } from '../constants'

import { nullObject } from '../../utils'
import { isCloudflareWorker } from '../../universal/constants'

const DEFAULT_CACHE_LIMIT = 1024
const DEFAULT_GC_TIME = 1 * 60 * 1000

export class TypeBoxValidatorCache {
	private static EMPTY = nullObject() as {}
	private static ignoreKeys = new Set([
		'title',
		'description',
		'tags',
		'examples',
		'defaultValue'
	])
	private static fnIds = new WeakMap<Function, number>()
	private static nextFnId = 0

	private static fnKey(fn: Function): string {
		let id = TypeBoxValidatorCache.fnIds.get(fn)
		if (id === undefined) {
			id = ++TypeBoxValidatorCache.nextFnId
			TypeBoxValidatorCache.fnIds.set(fn, id)
		}
		return `<fn:${id}>`
	}

	static ignoreMeta(k: string, v: unknown): any {
		if (TypeBoxValidatorCache.ignoreKeys.has(k)) return

		if (typeof v === 'function') return TypeBoxValidatorCache.fnKey(v)

		if (v && typeof v === 'object' && (v as any)['~optional'] === true) {
			const out = nullObject() as Record<string, unknown>
			for (const key in v as Record<string, unknown>)
				out[key] = (v as Record<string, unknown>)[key]

			out['~optional'] = true
			return out
		}

		return v
	}

	static #isOpaqueType(schema: any, seen = new WeakSet()): boolean {
		if (!schema || typeof schema !== 'object' || seen.has(schema))
			return false
		seen.add(schema)

		if (schema['~refine'] || schema['~elyTyp'] === ELYSIA_TYPES.NoValidate)
			return true

		const props = schema.properties
		if (props)
			for (const k in props)
				if (TypeBoxValidatorCache.#isOpaqueType(props[k], seen))
					return true

		const items = schema.items
		if (Array.isArray(items)) {
			for (const it of items)
				if (TypeBoxValidatorCache.#isOpaqueType(it, seen)) return true
		} else if (items && TypeBoxValidatorCache.#isOpaqueType(items, seen))
			return true

		for (const k of ['anyOf', 'allOf', 'oneOf'] as const) {
			const arr = schema[k]
			if (Array.isArray(arr))
				for (const x of arr)
					if (TypeBoxValidatorCache.#isOpaqueType(x, seen))
						return true
		}

		if (
			schema.additionalProperties &&
			typeof schema.additionalProperties === 'object' &&
			TypeBoxValidatorCache.#isOpaqueType(
				schema.additionalProperties,
				seen
			)
		)
			return true

		if (schema.not && TypeBoxValidatorCache.#isOpaqueType(schema.not, seen))
			return true

		const pp = schema.patternProperties
		if (pp)
			for (const k in pp)
				if (TypeBoxValidatorCache.#isOpaqueType(pp[k], seen))
					return true

		return false
	}

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

	#lastSchema: TSchema | undefined
	#lastMeta: { special: boolean; key: string } | undefined

	#meta(schema: TSchema): { special: boolean; key: string } {
		if (this.#lastSchema === schema && this.#lastMeta) return this.#lastMeta

		const special =
			HasCodec(schema) || TypeBoxValidatorCache.#isOpaqueType(schema)

		const meta = {
			special,
			key: special
				? ''
				: JSON.stringify(schema, TypeBoxValidatorCache.ignoreMeta)
		}

		this.#lastSchema = schema
		this.#lastMeta = meta

		return meta
	}

	constructor(gcTime: number) {
		this.#gcTime = gcTime
	}

	#scheduleClear() {
		if (isCloudflareWorker) return

		if (this.#gc) clearTimeout(this.#gc)

		this.#gc = setTimeout(
			() => this.clear(),
			this.#gcTime ?? DEFAULT_GC_TIME
		)
		;(this.#gc as any).unref?.()
	}

	get(
		schema: TSchema,
		coercions:
			| CoerceOption[]
			| typeof TypeBoxValidatorCache.EMPTY = TypeBoxValidatorCache.EMPTY,
		normalize = ''
	) {
		const refBucket = this.#referenceCache.get(schema)?.get(normalize)
		if (refBucket?.has(coercions)) return refBucket.get(coercions)

		const meta = this.#meta(schema)
		if (meta.special) return

		const key = meta.key + '\0' + normalize
		if (this.#cache.has(key)) {
			const coercionsCache = this.#cache.get(key)!
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
		normalize = ''
	) {
		this.#scheduleClear()
		const meta = this.#meta(schema)

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
		deferCoercions()
	}
}
