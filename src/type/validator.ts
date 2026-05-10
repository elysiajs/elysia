import { Type } from 'typebox'
import { Compile, type Validator as BaseTypeBoxValidator } from 'typebox/schema'
import type {
	Static,
	StaticDecode,
	StaticEncode,
	TAny,
	TSchema
} from 'typebox/type'
import {
	Clean,
	Convert,
	Decode,
	DecodeUnsafe,
	Default,
	Encode,
	EncodeUnsafe,
	Errors,
	HasCodec
} from 'typebox/value'
import { TLocalizedValidationError } from 'typebox/error'

import createMirror from 'exact-mirror'

import { applyCoercions, deferCoercions, type CoerceOption } from './coerce'
import { ELYSIA_TYPES } from './constants'
import { Validator, type ValidatorOptions } from '../validator'
import { isAsyncFunction } from '../compile/utils'
import { hasProperty } from './utils'
import { isBlob } from '../utils'
import { ValidationError } from '../error'

import type { MaybePromise } from '../types'

const moduleCache = new WeakMap<
	Record<string, TSchema>,
	Record<string, TSchema>
>()

const isAsyncPredicate = (v: unknown) =>
	Array.isArray(v)
		? v.some((x) =>
				typeof x.refine === 'function'
					? isAsyncFunction(x.refine) || x.refine === isBlob
					: false
			)
		: false

// Determines whether `Default(schema, {})` produces a snapshot that's safe to
// cache and merge against arbitrary inputs. Unsafe nodes:
//   - Union/Intersect: chosen default depends on the runtime value's branch.
//   - Codec (`~codec`): encode/decode applied via callback per-call.
//   - Refine (`~refine`): default filtered by predicate at runtime.
//   - Ref/Cyclic: schema body resolved elsewhere.
//   - Nested Object without its own `default`: TypeBox's `Default(schema,{})`
//     does NOT materialize nested objects unless the input has the key,
//     so the cached snapshot would be missing nested skeletons. Falling
//     back to runtime `Default()` for these is correct (and `Default` does
//     walk into nested objects when the input provides them).
function isPrecomputeSafe(schema: any, depth = 0): boolean {
	if (!schema || typeof schema !== 'object') return true

	const kind = schema['~kind']
	if (
		kind === 'Union' ||
		kind === 'Intersect' ||
		kind === 'Ref' ||
		kind === 'This' ||
		kind === 'Cyclic'
	)
		return false

	// Codec and Refine wrappers attach as `~codec` / `~refine` markers on
	// the underlying schema; `~kind` shows the wrapped type, not the wrapper.
	if (schema['~codec'] || schema['~refine']) return false

	// Nested Object without its own default — see comment above.
	if (
		depth > 0 &&
		(kind === 'Object' || schema.type === 'object') &&
		schema.default === undefined
	)
		return false

	if (schema.properties)
		for (const v of Object.values(schema.properties))
			if (!isPrecomputeSafe(v, depth + 1)) return false

	if (schema.items) {
		if (Array.isArray(schema.items)) {
			for (const v of schema.items)
				if (!isPrecomputeSafe(v, depth + 1)) return false
		} else if (!isPrecomputeSafe(schema.items, depth + 1)) return false
	}

	if (
		typeof schema.additionalProperties === 'object' &&
		!isPrecomputeSafe(schema.additionalProperties, depth + 1)
	)
		return false

	if (schema.patternProperties)
		for (const v of Object.values(schema.patternProperties))
			if (!isPrecomputeSafe(v, depth + 1)) return false

	return true
}

// Deep-merge user-supplied input into a clone of the precomputed defaults.
// Top-level keys come from `defaults`; user `value` keys override, recursing
// into nested plain objects so partial nested input still pulls leaf
// defaults from the snapshot. Tighter than the general `mergeDeep` in
// utils.ts (no cycle/skipKeys/freeze handling) — we know the inputs.
//
// Cycle safety: TypeBox schemas can't produce cyclic precomputed defaults
// (Cyclic/Ref schemas opt out via `isPrecomputeSafe`). Cyclic user input
// is user error and would also break TypeBox's own `Default()`; we don't
// guard against it.
function applyPrecomputed(
	defaults: Record<string, unknown>,
	value: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...defaults }
	for (const k in value) {
		const v = value[k]
		if (v === undefined) continue
		const d = out[k]
		if (
			v &&
			typeof v === 'object' &&
			!Array.isArray(v) &&
			d &&
			typeof d === 'object' &&
			!Array.isArray(d)
		)
			out[k] = applyPrecomputed(
				d as Record<string, unknown>,
				v as Record<string, unknown>
			)
		else out[k] = v
	}
	return out
}

export class TypeBoxValidator<
	const in out T extends TSchema = TAny
> extends Validator {
	tb: BaseTypeBoxValidator
	hasCodec: boolean
	schema: T
	isAsync: boolean
	hasDefault: boolean
	// Two precomputed snapshots used when the schema is safe (no Union /
	// Intersect / Codec / Refine at non-leaf). `precomputedDefault` is what
	// `Default(schema, undefined)` would return — the value to use when the
	// input is undefined/null (primitive schemas with a top-level default
	// resolve here). `precomputedObjectDefault` is `Default(schema, {})` —
	// the snapshot to deep-merge into object inputs so leaf defaults still
	// fill in. When both are unset the validator falls back to runtime
	// `Default()`. Skipping precompute is signalled by `precomputeSafe`.
	precomputeSafe: boolean
	precomputedDefault: unknown
	precomputedObjectDefault: Record<string, unknown> | undefined
	// `t.NoValidate(...)` opts the schema out of Check/Decode/Encode entirely
	// — From/EncodeFrom return the value as-is.
	noValidate: boolean

	constructor(
		schema: T,
		options?: ValidatorOptions,
		name?: string,
		isIntersectable?: boolean
	) {
		super()

		if (isIntersectable)
			schema = Type.Evaluate(
				Type.Intersect([schema, ...options!.schemas!])
			)

		if (name && options?.models) {
			const module = moduleCache.getOrInsertComputed(options.models, () =>
				Type.Module(options.models as Record<string, TSchema>)
			)

			schema = module[name] as T
		}

		this.schema = applyCoercions(schema, options?.coerces) as T

		this.tb = Compile(this.schema as TSchema)
		this.hasCodec = HasCodec(this.schema)
		this.isAsync =
			// @ts-expect-error private property
			this.tb.buildResult.external.variables.some(isAsyncPredicate) ??
			false
		this.hasDefault = hasProperty('default', this.schema as any)
		this.precomputeSafe =
			this.hasDefault && isPrecomputeSafe(this.schema as any)
		if (this.precomputeSafe) {
			// `Default(schema, undefined)` returns the default for primitive
			// schemas with a top-level default; for object schemas with only
			// leaf defaults it returns undefined.
			this.precomputedDefault = Default(this.schema, undefined)
			// `Default(schema, {})` walks leaf defaults so we can merge them
			// into a partial user object. Frozen so we never mutate the
			// shared snapshot — each call clones via `applyPrecomputed`.
			const obj = Default(this.schema, {}) as unknown
			this.precomputedObjectDefault =
				obj && typeof obj === 'object' && !Array.isArray(obj)
					? (Object.freeze(obj) as Record<string, unknown>)
					: undefined
		} else {
			this.precomputedDefault = undefined
			this.precomputedObjectDefault = undefined
		}
		this.noValidate =
			(this.schema as any)?.['~elyTyp'] === ELYSIA_TYPES.NoValidate

		try {
			this.Clean =
				!options?.normalize || options.normalize === 'exactMirror'
					? (createMirror(schema, {
							Compile,
							sanitize: options?.sanitize
						}) as any)
					: options.normalize === 'typebox'
						? (value) => Clean(this.tb!, value)
						: undefined
		} catch (error) {
			console.warn(
				'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
			)
			console.warn(schema)
			console.warn(error)
		}
	}

	Check(value: Static<T>): boolean {
		return this.tb.Check(value)
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		return Errors(this.schema, value)
	}

	Decode(value: Static<T>): StaticDecode<T> {
		return Decode(this.schema, value)
	}

	Encode(value: Static<T>): StaticEncode<T> {
		return this.hasCodec ? Encode(this.schema, value) : (value as any)
	}

	// Encode + Check, surfaced as ValidationError on failure. Used by the
	// response branch — mirrors src-old's `coerceTransformDecodeError`
	// wrapper for the encode direction.
	//
	// `noValidate` skips Check only — Default/Convert/Codec.Encode still run.
	// On the codec branch we route through `EncodeUnsafe` (callback only)
	// and skip the Assert step that the bundled `Encode` performs.
	EncodeFrom(value: Static<T>, type?: string): StaticEncode<T> {
		if (!this.hasCodec) {
			if (!this.noValidate && !this.Check(value))
				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)
			return value as any
		}
		try {
			return this.noValidate
				? // @ts-ignore EncodeUnsafe returns unknown
					(EncodeUnsafe({}, this.schema, value) as any)
				: Encode(this.schema, value)
		} catch (e: any) {
			if (e instanceof ValidationError) throw e
			if (e?.error) throw e.error
			throw new ValidationError(
				type,
				value,
				this.Errors(value),
				this.schema
			)
		}
	}

	From(value: Static<T>, type?: string): MaybePromise<Static<T>> {
		return this.isAsync
			? (this.FromAsync(value, type) as any)
			: this.FromSync(value, type)
	}

	async FromAsync(value: Static<T>, type?: string): Promise<Static<T>> {
		if (this.hasDefault) {
			if (this.precomputeSafe) {
				if (value === undefined || value === null) {
					value = this.precomputedDefault as any
				} else if (
					this.precomputedObjectDefault !== undefined &&
					typeof value === 'object' &&
					!Array.isArray(value)
				) {
					value = applyPrecomputed(
						this.precomputedObjectDefault,
						value as any
					) as any
				}
				// primitive non-undefined input: leave as-is (Default would
				// not overwrite an existing primitive)
			} else {
				value = Default(this.schema, value) as any
			}
		}
		if (this.hasCodec) {
			// Codec path: Convert (string→number/etc) → Check the wire-form
			// → run the codec callback. Mirrors TypeBox 1.0's standard
			// Decode order. Without this ordering, codec schemas like
			// `Codec(String).Decode(s => Date)` would Check a Date against
			// `t.String()` and fail with "must be string".
			// @ts-ignore
			value = Convert({}, this.schema, value)
			if (!this.noValidate && !this.Check(value))
				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)
			try {
				// @ts-ignore
				value = await DecodeUnsafe({}, this.schema, value)
			} catch (e: any) {
				// Mirror src-old's `coerceTransformDecodeError`: propagate
				// user-thrown errors (e.g. NotFoundError raised inside a
				// Decode callback) verbatim; otherwise surface as our
				// ValidationError so the route's error chain is uniform.
				if (e instanceof ValidationError) throw e
				if (e?.error) throw e.error
				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)
			}
		} else {
			// Non-codec path: pure Check, no coercion. Important for
			// response validation — we do NOT want a returned `1` to be
			// silently coerced into `'1'` against a `t.String()` response
			// schema; the test should fail.
			// @ts-ignore
			if (!this.noValidate && !(await this.Check(value)))
				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)
		}
		// @ts-ignore
		if (this.Clean) value = this.Clean(value)

		return value
	}

	FromSync(value: Static<T>, type?: string): Static<T> {
		if (this.hasDefault) {
			if (this.precomputeSafe) {
				if (value === undefined || value === null) {
					value = this.precomputedDefault as Static<T>
				} else if (
					this.precomputedObjectDefault !== undefined &&
					typeof value === 'object' &&
					!Array.isArray(value)
				) {
					value = applyPrecomputed(
						this.precomputedObjectDefault,
						value as any
					) as Static<T>
				}
			} else {
				value = Default(this.schema, value) as Static<T>
			}
		}
		if (this.hasCodec) {
			// @ts-ignore
			value = Convert({}, this.schema, value) as Static<T>
			if (!this.noValidate && !this.Check(value))
				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)
			try {
				value = DecodeUnsafe({}, this.schema, value) as Static<T>
			} catch (e: any) {
				if (e instanceof ValidationError) throw e
				if (e?.error) throw e.error
				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)
			}
		} else {
			if (!this.noValidate && !this.Check(value))
				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)
		}
		if (this.Clean) value = this.Clean(value) as Static<T>
		return value
	}
}

export class TypeBoxValidatorCache {
	private static EMPTY = {} as const
	// `error` is intentionally NOT in the ignore set: two schemas that
	// differ only in `error` produce different `customError` values when
	// validation fails, so caching them under the same key would return
	// the wrong custom message.
	private static ignoreKeys = new Set([
		'title',
		'description',
		'tags',
		'examples',
		'defaultValue'
	])

	// Stable per-process IDs for function values (e.g. `error` callbacks
	// produced by `validationDetail`). `JSON.stringify` drops functions by
	// default, which collapsed `t.Number({ error: fn })` and `t.Number()` to
	// the same cache key — a later test that built `t.Number()` would get
	// a validator carrying the prior test's schema, and `ValidationError`
	// would walk that stale schema for `customError`.
	private static fnIds = new WeakMap<Function, number>()
	private static nextFnId = 0
	private static fnKey(fn: Function) {
		let id = TypeBoxValidatorCache.fnIds.get(fn)
		if (id === undefined) {
			id = ++TypeBoxValidatorCache.nextFnId
			TypeBoxValidatorCache.fnIds.set(fn, id)
		}
		return `<fn:${id}>`
	}

	static ignoreMeta(k: string, v: unknown) {
		// `replacer` must return the value to keep it; returning undefined
		// drops the property. Previously this only checked the key and fell
		// off the end (returning undefined) for every property — collapsing
		// every schema to the same cache key.
		if (TypeBoxValidatorCache.ignoreKeys.has(k)) return undefined
		if (typeof v === 'function')
			return TypeBoxValidatorCache.fnKey(v as Function)
		return v
	}

	private cache = new Map<
		string,
		WeakMap<
			CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
			BaseTypeBoxValidator
		>
	>()
	private referenceCache = new WeakMap<
		TSchema,
		WeakMap<
			CoerceOption[] | typeof TypeBoxValidatorCache.EMPTY,
			BaseTypeBoxValidator
		>
	>()

	get(
		schema: TSchema,
		coercions:
			| CoerceOption[]
			| typeof TypeBoxValidatorCache.EMPTY = TypeBoxValidatorCache.EMPTY
	) {
		if (this.referenceCache.has(schema)) {
			const coercionsCache = this.referenceCache.get(schema)!
			if (coercionsCache.has(coercions))
				return coercionsCache.get(coercions)!
		}

		// Codec callbacks aren't JSON-serializable, so two distinct schemas
		// with identical JSON but different Decode/Encode callbacks would
		// collide on the same cache key and return the wrong compiled
		// validator. Skip the JSON cache for codec-bearing schemas; the
		// reference cache above still de-dupes when the user passes the
		// same schema object twice.
		if (HasCodec(schema)) return undefined

		const key = JSON.stringify(schema, TypeBoxValidatorCache.ignoreMeta)
		if (this.cache.has(key)) {
			const coercionsCache = this.cache.get(key)!

			if (coercionsCache.has(coercions))
				return coercionsCache.get(coercions)!
		}
	}

	set(
		schema: TSchema,
		coercions:
			| CoerceOption[]
			| typeof TypeBoxValidatorCache.EMPTY = TypeBoxValidatorCache.EMPTY,
		validator: BaseTypeBoxValidator
	) {
		// Codec-bearing schemas only go into the reference cache (keyed by
		// identity). Storing them in the JSON cache would bind the wrong
		// callbacks to a future schema with identical structure. See `get`.
		if (HasCodec(schema)) {
			const cache = new WeakMap().set(coercions, validator)
			this.referenceCache.set(schema, cache)
			return
		}

		const key = JSON.stringify(schema, TypeBoxValidatorCache.ignoreMeta)
		if (this.cache.has(key)) {
			const cache = this.cache.get(key)!.set(coercions, validator)

			if (this.referenceCache.has(schema))
				this.referenceCache.get(schema)!.set(coercions, validator)
			else this.referenceCache.set(schema, cache)

			return
		}

		const cache = new WeakMap().set(coercions, validator)

		this.cache.set(key, cache)
		this.referenceCache.set(schema, cache)
	}

	clear() {
		this.cache.clear()
		this.referenceCache = new WeakMap()
		deferCoercions()
	}
}
