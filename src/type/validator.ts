import { Type } from 'typebox'
import {
	Compile,
	Build,
	type Validator as BaseTypeBoxValidator
} from 'typebox/schema'
import type {
	Static,
	StaticDecode,
	StaticEncode,
	TAny,
	TSchema
} from 'typebox/type'
import {
	Clean,
	Decode,
	DecodeUnsafe,
	Default,
	Encode,
	EncodeUnsafe,
	Errors,
	HasCodec
} from 'typebox/value'
import type { TLocalizedValidationError } from 'typebox/error'

import createMirror from 'exact-mirror'

import {
	applyCoercions,
	CoerceOption,
	deferCoercions,
	nonAdditionalProperties
} from './coerce'

import { ELYSIA_TYPES } from './constants'
import { Validator, type ValidatorOptions } from '../validator'
import { isAsyncFunction } from '../compile/utils'

import {
	Compiled,
	instantiateFrozenMirror,
	instantiateFrozenBoth,
	collectExternals,
	externalsMatch,
	reconstructCheck,
	captureValidator,
	captureMirror,
	captureMirrorUnions,
	isValidatorCapturing,
	type CheckBuildResult,
	type FrozenValidator
} from '../compile/aot'

import { hasProperty } from './utils'
import { collectFileTypeChecks, takeFileTypeChecks } from './elysia/file'
import { isBlob, nullObject } from '../utils'
import { ValidationError } from '../error'

import type { MaybePromise } from '../types'

const moduleCache = new WeakMap<
	Record<string, TSchema>,
	Record<string, TSchema>
>()

function schemaContainsRef(node: any, seen = new WeakSet()): boolean {
	if (!node || typeof node !== 'object' || seen.has(node)) return false
	seen.add(node)

	if (node.$ref) return true

	const props = node.properties
	if (props)
		for (const k in props)
			if (schemaContainsRef(props[k], seen)) return true

	const items = node.items
	if (Array.isArray(items)) {
		for (const it of items) if (schemaContainsRef(it, seen)) return true
	} else if (items && schemaContainsRef(items, seen)) return true

	for (const key of ['anyOf', 'allOf', 'oneOf'] as const) {
		const arr = node[key]
		if (Array.isArray(arr))
			for (const x of arr) if (schemaContainsRef(x, seen)) return true
	}

	if (
		node.additionalProperties &&
		typeof node.additionalProperties === 'object' &&
		schemaContainsRef(node.additionalProperties, seen)
	)
		return true

	if (node.not && schemaContainsRef(node.not, seen)) return true

	const pp = node.patternProperties
	if (pp) for (const k in pp) if (schemaContainsRef(pp[k], seen)) return true

	return false
}

let inlineRefId = 0

// Shared empty externals for frozen checks
const EMPTY_EXTERNALS = Object.freeze([]) as unknown as unknown[]

const isAsyncPredicate = (v: unknown) =>
	Array.isArray(v)
		? v.some((x) =>
				typeof x.check === 'function'
					? isAsyncFunction(x.check) || x.check === isBlob
					: false
			)
		: false

async function enforceFileTypeChecks(
	pending: Promise<true | string>[],
	type: string | undefined,
	value: unknown,
	schema: unknown
): Promise<void> {
	const results = await Promise.all(pending)

	for (let i = 0; i < results.length; i++)
		if (results[i] !== true)
			throw new ValidationError(
				type,
				value,
				[
					{
						instancePath: '',
						message: results[i],
						summary: results[i]
					}
				],
				schema
			)
}

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

	// Nested Object without its own default - see comment above.
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

// recursive merge precompute default
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

function sourceOnlyValidator(schema: TSchema): BaseTypeBoxValidator {
	const buildResult = Build(schema)
	let full: BaseTypeBoxValidator | undefined

	return new Proxy({} as unknown as BaseTypeBoxValidator, {
		get(_, prop) {
			if (prop === 'buildResult') return buildResult

			const f = (full ??= Compile(schema))
			const value = (f as any)[prop]

			return typeof value === 'function' ? value.bind(f) : value
		}
	})
}

export class TypeBoxValidator<
	const in out T extends TSchema = TAny
> extends Validator {
	// undefined is reconstruct via aot
	tb?: BaseTypeBoxValidator

	// build time check, bound eagerly from the frozen manifest at construction
	reconstructedCheck?: (value: unknown) => boolean

	schema: T

	hasCodec!: boolean
	isAsync!: boolean
	hasDefault!: boolean

	// default value
	precomputeSafe: boolean
	#precomputedDefault: unknown
	#precomputedObjectDefault: Record<string, unknown> | undefined

	#noValidate: boolean
	#isForm = false

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
			) as any as T

		const originalElyTyp = (schema as any)?.['~elyTyp']

		const frozen =
			options?.aot && options.slot
				? Compiled.getValidator(
						options.aot.method,
						options.aot.path,
						options.slot
					)
				: undefined

		let schemaHasRef = false
		if (name && options?.models) {
			const module = moduleCache.getOrInsertComputed(options.models, () =>
				Type.Module(options.models as Record<string, TSchema>)
			)

			schema = module[name] as T
		} else if (options?.models && typeof name !== 'string') {
			schemaHasRef = frozen ? frozen.r === 1 : schemaContainsRef(schema)
			if (schemaHasRef) {
				const id = `inline@${++inlineRefId}`
				const synthetic = Type.Module({
					...(options.models as Record<string, TSchema>),
					[id]: schema as TSchema
				})
				schema = synthetic[id as keyof typeof synthetic] as T
			}
		}

		const isFrozen = this.#reconstruct(options, frozen)

		// Precompiled validator know ahead of time whether coercions will be applied
		this.schema = (
			isFrozen && !this.hasCodec
				? schema
				: applyCoercions(schema, options?.coerces)
		) as T

		if (
			options?.normalize === false &&
			options.slot !== 'headers' &&
			options.slot !== 'cookie'
		)
			this.schema = nonAdditionalProperties(
				this.schema as any
			) as unknown as T

		if (!isFrozen) {
			const capturing = isValidatorCapturing()
			this.tb = capturing
				? sourceOnlyValidator(this.schema as TSchema)
				: Compile(this.schema as TSchema)
			this.hasCodec = HasCodec(this.schema)
			this.isAsync =
				// @ts-expect-error private property
				this.tb.buildResult.external.variables.some(isAsyncPredicate) ??
				false

			this.hasDefault = hasProperty('default', this.schema as any)

			if (capturing) this.#maybeCapture(options, schemaHasRef)
		}

		this.precomputeSafe =
			this.hasDefault && isPrecomputeSafe(this.schema as any)

		if (this.precomputeSafe) {
			this.#precomputedDefault = Default(this.schema, undefined)
			const obj = Default(this.schema, nullObject()) as unknown
			this.#precomputedObjectDefault =
				obj && typeof obj === 'object' && !Array.isArray(obj)
					? (Object.freeze(obj) as Record<string, unknown>)
					: undefined
		} else {
			this.#precomputedDefault = undefined
			this.#precomputedObjectDefault = undefined
		}

		this.#noValidate = originalElyTyp === ELYSIA_TYPES.NoValidate
		this.#isForm = originalElyTyp === ELYSIA_TYPES.Form

		if (isFrozen && frozen!.cm) {
			const both = instantiateFrozenBoth(frozen!, this.schema, schema)
			this.reconstructedCheck = both.check
			this.Clean = both.clean
		} else {
			if (isFrozen)
				this.reconstructedCheck = frozen!.c!(
					frozen!.e ? collectExternals(this.schema) : EMPTY_EXTERNALS
				)

			try {
				this.Clean =
					options?.normalize === false
						? undefined
						: options?.normalize === 'typebox'
							? (value) => Clean(this.schema, value)
							: this.#setupMirror(schema, options, frozen)
			} catch (error) {
				console.warn(
					'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
				)
				console.warn(schema)
				console.warn(error)

				// degrade to typebox Clean (slower, no sanitize) instead of
				// silently skipping normalization
				if (options?.normalize !== false)
					this.Clean = (value) => Clean(this.schema, value)
			}
		}
	}

	#setupMirror(
		schema: TSchema,
		options?: ValidatorOptions,
		frozen?: FrozenValidator
	): ((value: unknown) => unknown) | undefined {
		const aot = options?.aot
		const slot = options?.slot

		if (aot && slot) {
			if (frozen?.m) {
				const m = frozen.m
				let clean: ((value: unknown) => unknown) | undefined

				return (value: unknown) => {
					if (clean === undefined)
						try {
							clean = instantiateFrozenMirror(m, schema)
						} catch (error) {
							console.warn(
								'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
							)
							console.warn(schema)
							console.warn(error)
							clean = (v) => v
						}

					return clean(value)
				}
			}

			if (isValidatorCapturing())
				try {
					const emitted = createMirror(schema, {
						Compile,
						sanitize: options?.sanitize,
						emit: true
					}) as { source?: string; externals?: any }

					if (typeof emitted?.source === 'string') {
						const ext = emitted.externals

						if (!ext)
							captureMirror({
								method: aot.method,
								path: aot.path,
								slot,
								mirror: {
									source: emitted.source,
									hasExternals: false
								}
							})
						else if (ext.unions && !ext.hof) {
							const u = captureMirrorUnions(schema, ext.unions)

							if (u)
								captureMirror({
									method: aot.method,
									path: aot.path,
									slot,
									mirror: {
										source: emitted.source,
										hasExternals: true,
										u
									}
								})
						}
						// the rest is not freezable
					}
				} catch {}
		}

		return createMirror(schema, {
			Compile,
			sanitize: options?.sanitize
		}) as (value: unknown) => unknown
	}

	Check(value: Static<T>): boolean {
		return this.reconstructedCheck
			? this.reconstructedCheck(value)
			: this.tb!.Check(value)
	}

	#reconstruct(
		options?: ValidatorOptions,
		frozen?: FrozenValidator
	): boolean {
		if (!options?.aot || !options.slot || options.normalize === 'typebox')
			return false
		if (!frozen?.c && !frozen?.cm) return false

		this.isAsync = frozen.a === 1
		this.hasDefault = frozen.d === 1
		this.hasCodec = frozen.k === 1

		return true
	}

	#maybeCapture(
		options: ValidatorOptions | undefined,
		hasRef: boolean
	): void {
		const aot = options?.aot
		const slot = options?.slot
		if (!aot || !slot || !isValidatorCapturing()) return

		// @ts-expect-error private property
		const build = this.tb!.buildResult as CheckBuildResult
		if (!build?.functions?.length || !build.entry) return

		const variables = build.external.variables
		// externals not reconstructable, leave it to JIT
		if (!externalsMatch(collectExternals(this.schema), variables)) return

		const r = reconstructCheck(build)
		captureValidator({
			method: aot.method,
			path: aot.path,
			slot,
			identifier: build.external.identifier,
			checkDefs: r.defs,
			checkValue: r.value,
			// captured so the runtime skips the per-schema walks (collectExternals
			// when empty / isAsyncPredicate / hasProperty('default') / HasCodec /
			// schemaContainsRef)
			external: variables.length > 0,
			async: variables.some(isAsyncPredicate),
			hasDefault: this.hasDefault,
			hasCodec: this.hasCodec,
			hasRef
		})
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

	EncodeFrom(value: Static<T>, type?: string): StaticEncode<T> {
		if (this.#isForm) {
			if (!this.#noValidate && !this.Check(value))
				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)

			return value as any
		}

		if (!this.hasCodec) {
			if (!this.#noValidate && !this.Check(value))
				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)

			if (this.Clean) value = this.Clean(value) as Static<T>
			return value as any
		}

		try {
			const out = this.#noValidate
				? // @ts-ignore EncodeUnsafe returns unknown
					(EncodeUnsafe(nullObject(), this.schema, value) as any)
				: Encode(this.schema, value)
			return this.Clean ? (this.Clean(out) as any) : out
		} catch (e: any) {
			if (this.#noValidate)
				return this.Clean ? (this.Clean(value) as any) : (value as any)

			if (e instanceof ValidationError) throw e
			if (e?.error) throw e.error
			if (e?.status) throw e

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

	private optionalBypass(
		value: Static<T>
	): { bypass: true; value: Static<T> } | undefined {
		const schema = this.schema as any
		if (!schema?.['~optional']) return undefined

		if (value === undefined || value === null)
			return {
				bypass: true,
				value: (schema['~kind'] === 'Object'
					? nullObject()
					: value) as Static<T>
			}

		if (
			schema['~kind'] === 'Object' &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			Object.keys(value as object).length === 0
		)
			return { bypass: true, value: nullObject() as Static<T> }

		return undefined
	}

	async FromAsync(value: Static<T>, type?: string): Promise<Static<T>> {
		if (this.hasDefault) {
			if (this.precomputeSafe) {
				if (value === undefined || value === null)
					value = this.#precomputedDefault as any
				else if (
					this.#precomputedObjectDefault !== undefined &&
					typeof value === 'object' &&
					!Array.isArray(value)
				)
					value = applyPrecomputed(
						this.#precomputedObjectDefault,
						value as any
					) as any
			} else value = Default(this.schema, value) as any
		}

		const bypass = this.optionalBypass(value)
		if (bypass) return bypass.value

		if (this.hasCodec) {
			if (!this.#noValidate) {
				collectFileTypeChecks()
				const valid = this.Check(value)
				const pendingFile = takeFileTypeChecks()

				if (!valid)
					throw new ValidationError(
						type,
						value,
						this.Errors(value),
						this.schema
					)

				if (pendingFile)
					await enforceFileTypeChecks(
						pendingFile,
						type,
						value,
						this.schema
					)
			}
			try {
				// @ts-ignore
				value = DecodeUnsafe(nullObject(), this.schema, value)
			} catch (e: any) {
				if (e instanceof ValidationError) throw e
				if (e?.error) throw e.error
				if (e?.status) throw e

				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)
			}
		} else if (!this.#noValidate) {
			collectFileTypeChecks()
			const valid = this.Check(value)
			const pendingFile = takeFileTypeChecks()

			if (!valid)
				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)

			if (pendingFile)
				await enforceFileTypeChecks(
					pendingFile,
					type,
					value,
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
				if (value === undefined || value === null)
					value = this.#precomputedDefault as Static<T>
				else if (
					this.#precomputedObjectDefault !== undefined &&
					typeof value === 'object' &&
					!Array.isArray(value)
				)
					value = applyPrecomputed(
						this.#precomputedObjectDefault,
						value as any
					) as Static<T>
			} else value = Default(this.schema, value) as Static<T>
		}

		const bypass = this.optionalBypass(value)
		if (bypass) return bypass.value

		if (this.hasCodec) {
			// See FromAsync for the rationale on skipping `Convert`
			if (!this.#noValidate && !this.Check(value))
				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)
			try {
				value = DecodeUnsafe(
					nullObject() as {},
					this.schema,
					value
				) as Static<T>
			} catch (e: any) {
				if (e instanceof ValidationError) throw e
				if (e?.error) throw e.error
				if (e?.status) throw e

				throw new ValidationError(
					type,
					value,
					this.Errors(value),
					this.schema
				)
			}
		} else {
			if (!this.#noValidate && !this.Check(value))
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

	private static fnKey(fn: Function) {
		let id = TypeBoxValidatorCache.fnIds.get(fn)
		if (id === undefined) {
			id = ++TypeBoxValidatorCache.nextFnId
			TypeBoxValidatorCache.fnIds.set(fn, id)
		}

		return `<fn:${id}>`
	}

	static ignoreMeta(k: string, v: unknown) {
		if (TypeBoxValidatorCache.ignoreKeys.has(k)) return undefined
		if (typeof v === 'function')
			return TypeBoxValidatorCache.fnKey(v as Function)

		if (v && typeof v === 'object' && (v as any)['~optional'] === true) {
			const out = nullObject()
			for (const k in v) out[k] = (v as any)[k]
			out['~optional'] = true

			return out
		}

		return v
	}

	static #isOpaqueType(schema: any, seen = new WeakSet()): boolean {
		if (!schema || typeof schema !== 'object' || seen.has(schema))
			return false

		seen.add(schema)

		if (
			schema['~refine'] ||
			(schema as any)['~elyTyp'] === ELYSIA_TYPES.NoValidate
		)
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
		if (this.#referenceCache.has(schema)) {
			const coercionsCache = this.#referenceCache.get(schema)!
			if (coercionsCache.has(coercions))
				return coercionsCache.get(coercions)!
		}

		if (HasCodec(schema) || TypeBoxValidatorCache.#isOpaqueType(schema))
			return undefined

		const key = JSON.stringify(schema, TypeBoxValidatorCache.ignoreMeta)
		if (this.#cache.has(key)) {
			const coercionsCache = this.#cache.get(key)!

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
		if (HasCodec(schema) || TypeBoxValidatorCache.#isOpaqueType(schema)) {
			const cache = new WeakMap().set(coercions, validator)
			this.#referenceCache.set(schema, cache)
			return
		}

		const key = JSON.stringify(schema, TypeBoxValidatorCache.ignoreMeta)
		if (this.#cache.has(key)) {
			const cache = this.#cache.get(key)!.set(coercions, validator)

			if (this.#referenceCache.has(schema))
				this.#referenceCache.get(schema)!.set(coercions, validator)
			else this.#referenceCache.set(schema, cache)

			return
		}

		const cache = new WeakMap().set(coercions, validator)

		this.#cache.set(key, cache)
		this.#referenceCache.set(schema, cache)
	}

	clear() {
		this.#cache.clear()
		this.#referenceCache = new WeakMap()
		deferCoercions()
	}
}
