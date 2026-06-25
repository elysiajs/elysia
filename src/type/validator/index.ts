import { Evaluate, Intersect, Module } from 'typebox/type'
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
	buildCoercedFromPlan,
	captureCoercePlan,
	nonAdditionalProperties
} from '../coerce'

import { ELYSIA_TYPES } from '../constants'
import { Validator, type ValidatorOptions } from '../../validator'
import { isAsyncFunction } from '../../compile/utils'

import {
	Compiled,
	instantiateFrozenMirror,
	instantiateFrozenDecodeMirror,
	instantiateFrozenBoth,
	collectExternals,
	EMPTY_EXTERNALS,
	Capture,
	type CheckBuildResult,
	type CapturedValidator,
	type FrozenValidator
} from '../../compile/aot'

import { hasProperty } from '../utils'
import {
	ASYNC_REFINE,
	collectFileTypeChecks,
	takeFileTypeChecks,
	type PendingFileTypeCheck
} from '../elysia/file'
import { nullObject } from '../../utils'
import { ValidationError } from '../../error'
import {
	applyPrecomputed,
	buildDefaultClonerSource,
	buildObjectDefaultMergeSource,
	createDefaultCloner,
	createObjectDefaultMerger,
	isPrecomputeSafe,
	verifyPreallocatableDefault
} from './default-precompute'
import { buildFrozenCheck } from './frozen-check'
import { buildFindCustomError, captureCustomErrors } from './custom-error'
import {
	captureStringCodecEntries,
	reconstructInnerCodecs
} from './string-codec-aot'
export { TypeBoxValidatorCache } from './validator-cache'

import type { MaybePromise } from '../../types'

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

// Fast path for the standalone-guard merge: when every member is a plain inline
// object (own keys ⊆ type/properties/required, no `~elyTyp`)
function divergesFromEvaluate(node: any, seen: WeakSet<object>) {
	if (!node || typeof node !== 'object' || seen.has(node)) return false
	seen.add(node)

	for (const k in node) {
		if (!Object.hasOwn(node, k)) return true
		const v = (node as any)[k]
		if (typeof v === 'object' && v && divergesFromEvaluate(v, seen))
			return true
	}

	return false
}

const SIMPLE_OBJECT_KEYS = new Set(['type', 'properties', 'required'])
export function shallowMergeObjects(members: any[]): TSchema | null {
	const properties: Record<string, unknown> = {}
	let required: string[] | undefined

	for (const m of members) {
		if (
			!m ||
			m['~kind'] !== 'Object' ||
			m['~elyTyp'] !== undefined ||
			!m.properties ||
			divergesFromEvaluate(m, new WeakSet())
		)
			return null

		for (const k of Object.keys(m))
			if (!SIMPLE_OBJECT_KEYS.has(k)) return null

		for (const k in m.properties) {
			if (k in properties) return null // Evaluate intersects overlaps
			properties[k] = m.properties[k]
		}

		if (Array.isArray(m.required) && m.required.length)
			(required ??= []).push(...m.required)
	}

	const out: any = { type: 'object', properties }
	if (required) out.required = required

	return Object.defineProperty(out, '~kind', {
		value: 'Object',
		enumerable: false
	}) as TSchema
}

let inlineRefId = 0

const isAsyncPredicate = (v: unknown) =>
	Array.isArray(v)
		? v.some((x) =>
				typeof x.check === 'function'
					? isAsyncFunction(x.check) || x.check[ASYNC_REFINE] === true
					: false
			)
		: false

async function enforceFileTypeChecks(
	pending: PendingFileTypeCheck[],
	type: string | undefined,
	value: unknown,
	schema: unknown
): Promise<void> {
	const results = await Promise.all(pending.map((x) => x.check))

	for (let i = 0; i < results.length; i++)
		if (results[i] !== true)
			throw new ValidationError(
				type,
				value,
				[
					{
						instancePath:
							findInstancePath(value, pending[i].file) ?? '',
						message: results[i]
					}
				],
				schema
			)
}

function findInstancePath(
	value: unknown,
	target: unknown,
	path = ''
): string | undefined {
	if (value === target) return path
	if (!value || typeof value !== 'object') return

	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const found = findInstancePath(value[i], target, `${path}/${i}`)
			if (found !== undefined) return found
		}

		return
	}

	for (const key in value) {
		const found = findInstancePath(
			(value as Record<string, unknown>)[key],
			target,
			`${path}/${key}`
		)
		if (found !== undefined) return found
	}
}

function externalsShape(schema: unknown) {
	let out = ''
	for (const e of collectExternals(schema))
		out += e instanceof RegExp ? 'r' : typeof e === 'function' ? 'f' : 'v'

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

interface DefaultFastPath {
	/** `Default(schema, undefined)`; cloned when object-like. */
	value: unknown
	/** Legacy parity: this precomputed default also applies to explicit `null`. */
	appliesToNull: boolean
	/** `Default(schema, {})`, used to merge child defaults into partial objects. */
	objectTemplate: Record<string, unknown> | undefined
	/** Generated object/array cloner for `value` when available. */
	clone?: () => unknown
	/** Generated partial-object merger for `objectTemplate` when available. */
	merge?: (value: Record<string, unknown>) => Record<string, unknown>
}

export class TypeBoxValidator<
	const in out T extends TSchema = TAny
> extends Validator {
	// AOT / frozen validator state
	// Undefined when the validator was reconstructed from the AOT manifest.
	tb?: BaseTypeBoxValidator

	// build time check, bound eagerly from the frozen manifest at construction
	reconstructedCheck?: (value: unknown) => boolean

	schema!: T

	hasCodec!: boolean
	isAsync!: boolean
	hasDefault!: boolean

	#decodeMirror?: (value: unknown) => unknown
	#encodeMirror?: (value: unknown) => unknown
	#findCustomError?: (
		value: unknown
	) => { instancePath: string; error: unknown } | undefined

	// Default fast path (AOT-baked when available, runtime-computed otherwise)
	// `precomputeSafe` is the public/debug indicator; #defaultFastPath is the
	// grouped runtime state used by FromSync/FromAsync.
	precomputeSafe = false
	#defaultFastPath?: DefaultFastPath

	#noValidate!: boolean
	#isForm = false
	#hasOptional = false

	constructor(
		schema: T,
		options?: ValidatorOptions,
		name?: string,
		isIntersectable?: boolean
	) {
		super()

		if (isIntersectable) {
			const members = [schema, ...options!.schemas!]
			// fast path because Evaluate(Intersect(...)) is deep clone
			schema = (shallowMergeObjects(members) ??
				Evaluate(Intersect(members as any))) as unknown as T
		}

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
		if (name && options?.models)
			schema = (
				moduleCache.getOrInsertComputed(options.models, () =>
					Module(options.models as Record<string, TSchema>)
				) as any
			)[name]
		else if (options?.models && typeof name !== 'string') {
			schemaHasRef = frozen ? frozen.r === 1 : schemaContainsRef(schema)
			if (schemaHasRef) {
				const id = `inline@${++inlineRefId}`
				schema = (
					Module({
						...options.models,
						[id]: schema
					} as Record<string, TSchema>) as any
				)[id]
			}
		}

		const isFrozen = this.#reconstruct(options, frozen)

		this.schema = (
			isFrozen && frozen!.cp
				? // bake: splice deduped frozen leaves into the live original
					// schema instead of re-walking (see coerce.ts captureCoercePlan)
					buildCoercedFromPlan(schema as any, frozen!.cp)
				: isFrozen && !this.hasCodec
					? schema
					: applyCoercions(schema as any, options?.coerces)
		) as T

		if (
			options?.normalize === false &&
			options.slot !== 'headers' &&
			options.slot !== 'cookie'
		)
			this.schema = nonAdditionalProperties(this.schema as any) as T

		if (!isFrozen) {
			const capturing = Capture.isCapturing()
			this.tb = capturing
				? sourceOnlyValidator(this.schema as TSchema)
				: Compile(this.schema as TSchema)
			this.hasCodec = HasCodec(this.schema)
			this.isAsync =
				// @ts-expect-error private property
				this.tb.buildResult.external.variables.some(isAsyncPredicate) ??
				false

			this.hasDefault = hasProperty('default', this.schema as any)

			if (capturing) this.#maybeCapture(options, schemaHasRef, schema)
			else this.#dropCompiledSource()
		}

		if (frozen?.ps === 1) {
			const objectTemplate =
				frozen.pod !== undefined
					? (Object.freeze(frozen.pod) as Record<string, unknown>)
					: undefined

			this.precomputeSafe = true
			this.#defaultFastPath = {
				value: frozen.pd,
				appliesToNull: frozen.pn === 1,
				objectTemplate,
				clone: frozen.dc,
				merge: frozen.pm
			}
		} else {
			this.precomputeSafe =
				this.hasDefault && isPrecomputeSafe(this.schema as any)

			if (this.precomputeSafe) {
				const defaultValue = Default(this.schema, undefined)
				const obj = Default(this.schema, nullObject()) as unknown
				const objectTemplate =
					obj && typeof obj === 'object' && !Array.isArray(obj)
						? (Object.freeze(obj) as Record<string, unknown>)
						: undefined

				this.#defaultFastPath = {
					value: defaultValue,
					appliesToNull: true,
					objectTemplate,
					clone: createDefaultCloner(defaultValue),
					merge:
						objectTemplate !== undefined
							? createObjectDefaultMerger(objectTemplate)
							: undefined
				}
			} else
				this.#defaultFastPath = undefined
		}

		this.#noValidate = originalElyTyp === ELYSIA_TYPES.NoValidate
		this.#isForm = originalElyTyp === ELYSIA_TYPES.Form
		this.#hasOptional = !!(this.schema as any)?.['~optional']

		if (frozen?.ic) reconstructInnerCodecs(frozen.ic, this.schema)

		if (isFrozen && frozen!.cm) {
			const both = instantiateFrozenBoth(frozen!, this.schema, schema)
			this.reconstructedCheck = both.check
			this.Clean = options?.normalize === false ? undefined : both.clean
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

				if (options?.normalize !== false)
					this.Clean = (value) => Clean(this.schema, value)
			}
		}

		if (
			this.hasCodec &&
			!this.#isForm &&
			!this.#noValidate &&
			!options?.slot?.startsWith('r') &&
			options?.normalize !== false &&
			options?.normalize !== 'typebox'
		)
			this.#decodeMirror = this.#setupCodecMirror(
				this.schema as TSchema,
				options,
				frozen,
				'decode'
			)

		if (
			this.hasCodec &&
			!this.#isForm &&
			!this.#noValidate &&
			options?.slot?.startsWith('r') &&
			options?.normalize !== false &&
			options?.normalize !== 'typebox'
		)
			this.#encodeMirror = this.#setupCodecMirror(
				this.schema as TSchema,
				options,
				frozen,
				'encode'
			)

		if (!this.#noValidate)
			this.#findCustomError = buildFindCustomError(this.schema, frozen)
	}

	#error(value: unknown, type?: string): ValidationError {
		return new ValidationError(
			type,
			value,
			() => this.Errors(value),
			this.schema,
			this.#findCustomError
		)
	}

	#setupMirror(
		schema: TSchema,
		options?: ValidatorOptions,
		frozen?: FrozenValidator
	): ((value: unknown) => unknown) | undefined {
		const aot = options?.aot
		const slot = options?.slot

		if (aot && slot && frozen?.m) {
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

		if (aot && slot) {
			if (Capture.isCapturing())
				try {
					const emitted = createMirror(schema, {
						Compile,
						sanitize: options?.sanitize,
						emit: true
					}) as { source?: string; externals?: any }

					if (typeof emitted?.source === 'string') {
						const ext = emitted.externals

						if (!ext)
							Capture.set(
								{ method: aot.method, path: aot.path, slot },
								{
									mirror: {
										source: emitted.source,
										hasExternals: false
									}
								}
							)
						else if (ext.unions && !ext.hof) {
							const u = Capture.mirrorUnions(schema, ext.unions)

							if (u)
								Capture.set(
									{
										method: aot.method,
										path: aot.path,
										slot
									},
									{
										mirror: {
											source: emitted.source,
											hasExternals: true,
											u
										}
									}
								)
						}
					}
				} catch {}
		}

		return createMirror(schema, {
			Compile,
			sanitize: options?.sanitize
		}) as (value: unknown) => unknown
	}

	// decode (request) / encode (response) codec mirror. Frozen → instantiate
	// lazily (with a JIT fallback when unsealed); else capture the emit + JIT.
	#setupCodecMirror(
		schema: TSchema,
		options: ValidatorOptions | undefined,
		frozen: FrozenValidator | undefined,
		dir: 'decode' | 'encode'
	): ((value: unknown) => unknown) | undefined {
		const aot = options?.aot
		const slot = options?.slot
		const frozenMirror = dir === 'decode' ? frozen?.dm : frozen?.em

		if (aot && slot && frozenMirror) {
			const m = frozenMirror
			let run: ((value: unknown) => unknown) | undefined

			return (value: unknown) => {
				if (run === undefined)
					try {
						run = instantiateFrozenDecodeMirror(m, schema, dir)
					} catch {
						run =
							dir === 'decode'
								? (v) => {
										// @ts-ignore
										const decoded = DecodeUnsafe(
											nullObject(),
											schema,
											v
										)
										return this.Clean
											? this.Clean(decoded)
											: decoded
									}
								: (v) => {
										const out = Encode(schema, v as any)
										return this.Clean
											? this.Clean(out)
											: out
									}
					}

				return run(value)
			}
		}

		const dirOpt = dir === 'decode' ? { decode: true } : { encode: true }

		// decode freezes non-response slots, encode freezes response slots
		const captureSlot =
			dir === 'decode'
				? !slot?.startsWith('response')
				: !!slot?.startsWith('response')

		if (aot && slot && Capture.isCapturing() && captureSlot)
			try {
				const emitted = createMirror(schema, {
					Compile,
					sanitize: options?.sanitize,
					...dirOpt,
					emit: true
				}) as { source?: string; externals?: any }

				if (typeof emitted?.source === 'string') {
					const ext = emitted.externals

					if (
						ext?.codecs &&
						!ext.hof &&
						Capture.mirrorCodecs(schema, ext.codecs, dir)
					) {
						let u:
							| { identifier: string; code: string }[][]
							| undefined
						let freezable = true

						if (ext.unions && ext.unions.length) {
							u = Capture.mirrorUnions(schema, ext.unions)
							if (!u) freezable = false
						}

						if (freezable) {
							const mirror = {
								source: emitted.source,
								hasExternals: true,
								u
							}
							Capture.set(
								{ method: aot.method, path: aot.path, slot },
								dir === 'decode'
									? { decodeMirror: mirror }
									: { encodeMirror: mirror }
							)
						}
					}
				}
			} catch {}

		try {
			return createMirror(schema, {
				Compile,
				sanitize: options?.sanitize,
				...dirOpt
			}) as (value: unknown) => unknown
		} catch {}
	}

	Check(value: Static<T>): boolean {
		if (this.reconstructedCheck) return this.reconstructedCheck(value)

		return this.tb!.Check(value)
	}

	#reconstruct(
		options: ValidatorOptions | undefined,
		frozen: FrozenValidator | undefined
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
		hasRef: boolean,
		originalSchema: TSchema
	): void {
		const aot = options?.aot
		const slot = options?.slot
		if (!aot || !slot || !Capture.isCapturing()) return

		if (
			this.hasCodec &&
			!hasRef &&
			options.coerces &&
			options.normalize !== false &&
			options.normalize !== 'typebox'
		) {
			const plan = captureCoercePlan(originalSchema, this.schema)
			if (
				plan &&
				externalsShape(buildCoercedFromPlan(originalSchema, plan)) ===
					externalsShape(this.schema)
			)
				Capture.set(
					{ method: aot.method, path: aot.path, slot },
					{ coercePlan: plan }
				)
		}

		const defaultFastPathCapture: Partial<CapturedValidator> = {
			precomputeSafe: undefined,
			precomputedDefault: undefined,
			precomputeNull: undefined,
			precomputedObjectDefault: undefined,
			defaultCloner: undefined,
			objectDefaultMerger: undefined
		}

		if (this.hasDefault) {
			const defaults = verifyPreallocatableDefault(this.schema as TSchema)
			if (defaults) {
				defaultFastPathCapture.precomputeSafe = true
				defaultFastPathCapture.precomputedDefault = defaults.pd
				defaultFastPathCapture.precomputeNull = defaults.pn
				defaultFastPathCapture.precomputedObjectDefault = defaults.pod
				defaultFastPathCapture.defaultCloner =
					defaults.pd !== undefined
						? buildDefaultClonerSource(defaults.pd)
						: undefined
				defaultFastPathCapture.objectDefaultMerger =
					defaults.pod !== undefined
						? buildObjectDefaultMergeSource(defaults.pod)
						: undefined
			}
		}

		Capture.set(
			{ method: aot.method, path: aot.path, slot },
			defaultFastPathCapture
		)

		const customErrors = captureCustomErrors(this.schema)
		if (customErrors)
			Capture.set(
				{ method: aot.method, path: aot.path, slot },
				{ customErrors }
			)

		const innerCodecs = captureStringCodecEntries(
			this.schema as TSchema,
			options?.sanitize
		)
		if (innerCodecs)
			Capture.set(
				{ method: aot.method, path: aot.path, slot },
				{ innerCodecs }
			)

		// @ts-expect-error private property
		const build = this.tb!.buildResult as CheckBuildResult
		const cf = buildFrozenCheck(build, this.schema)
		if (!cf) return

		Capture.set(
			{ method: aot.method, path: aot.path, slot },
			{
				...cf,
				async: build.external.variables.some(isAsyncPredicate),
				hasDefault: this.hasDefault,
				hasCodec: this.hasCodec,
				hasRef
			}
		)
	}

	#dropCompiledSource(): void {
		const tb = this.tb as any
		if (!tb) return
		if (tb.evaluateResult) tb.evaluateResult.code = undefined
		if (tb.buildResult) tb.buildResult.functions = undefined
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
				throw this.#error(value, type)

			return value as any
		}

		if (!this.hasCodec) {
			if (!this.#noValidate && !this.Check(value))
				throw this.#error(value, type)

			if (this.Clean) value = this.Clean(value) as Static<T>
			return value as any
		}

		try {
			if (this.#encodeMirror) {
				const out = this.#encodeMirror(value)

				if (!this.#noValidate && !this.Check(out as any))
					throw new ValidationError(
						type,
						out,
						() => this.Errors(out),
						this.schema
					)

				return out as any
			}

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
				() => this.Errors(value),
				this.schema
			)
		}
	}

	#markForm(value: unknown) {
		if (
			this.#isForm &&
			value !== null &&
			typeof value === 'object' &&
			!('~ely-form' in value)
		)
			Object.defineProperty(value, '~ely-form', {
				value: 1,
				configurable: true
			})
	}

	#unmarkForm(value: unknown) {
		if (
			this.#isForm &&
			value !== null &&
			typeof value === 'object' &&
			'~ely-form' in value &&
			Object.getOwnPropertyDescriptor(value, '~ely-form')?.configurable
		)
			delete (value as Record<string, unknown>)['~ely-form']
	}

	From(value: Static<T>, type?: string): MaybePromise<Static<T>> {
		return this.isAsync
			? this.FromAsync(value, type)
			: this.FromSync(value, type)
	}

	// Clone the shared whole-default template for absent input.
	#cloneSharedDefault() {
		const defaults = this.#defaultFastPath!
		const value = defaults.value
		if (value === null || typeof value !== 'object') return value

		// Always deep-clone: the shared template (baked `pd` or the runtime
		// snapshot) must yield an independent instance per request
		return defaults.clone
			? defaults.clone()
			: structuredClone(value)
	}

	#applyPrecomputedObjectDefault(value: Record<string, unknown>) {
		const defaults = this.#defaultFastPath!

		return defaults.merge
			? defaults.merge(value)
			: applyPrecomputed(defaults.objectTemplate!, value)
	}

	private optionalBypass(
		value: Static<T>
	): { bypass: true; value: Static<T> } | undefined {
		const schema = this.schema as any
		if (!schema?.['~optional']) return

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
	}

	async FromAsync(value: Static<T>, type?: string): Promise<Static<T>> {
		if (this.hasDefault) {
			const defaults = this.#defaultFastPath
			if (defaults) {
				if (
					value === undefined ||
					(value === null && defaults.appliesToNull)
				)
					value = this.#cloneSharedDefault() as any
				else if (
					defaults.objectTemplate !== undefined &&
					typeof value === 'object' &&
					!Array.isArray(value)
				)
					value = this.#applyPrecomputedObjectDefault(
						value as any
					) as any
			} else value = Default(this.schema, value) as any
		}

		if (this.#hasOptional) {
			const bypass = this.optionalBypass(value)
			if (bypass) return bypass.value
		}

		if (this.#isForm) this.#markForm(value)

		if (this.hasCodec) {
			if (!this.#noValidate) {
				collectFileTypeChecks()
				const valid = this.Check(value)
				const pendingFile = takeFileTypeChecks()

				if (!valid) throw this.#error(value, type)
				if (pendingFile)
					await enforceFileTypeChecks(
						pendingFile,
						type,
						value,
						this.schema
					)
			}

			if (this.#decodeMirror)
				value = this.#decodeMirror(value) as Static<T>
			else
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
						() => this.Errors(value),
						this.schema
					)
				}
		} else if (!this.#noValidate) {
			collectFileTypeChecks()
			const valid = this.Check(value)
			const pendingFile = takeFileTypeChecks()

			if (!valid) throw this.#error(value, type)
			if (pendingFile)
				await enforceFileTypeChecks(
					pendingFile,
					type,
					value,
					this.schema
				)
		}

		if (this.Clean && !this.#decodeMirror)
			value = this.Clean(value) as Static<T>

		if (this.#isForm) this.#unmarkForm(value)
		return value
	}

	FromSync(value: Static<T>, type?: string): Static<T> {
		if (this.hasDefault) {
			const defaults = this.#defaultFastPath
			if (defaults) {
				if (
					value === undefined ||
					(value === null && defaults.appliesToNull)
				)
					value = this.#cloneSharedDefault() as Static<T>
				else if (
					defaults.objectTemplate !== undefined &&
					typeof value === 'object' &&
					!Array.isArray(value)
				)
					value = this.#applyPrecomputedObjectDefault(
						value as any
					) as Static<T>
			} else value = Default(this.schema, value) as Static<T>
		}

		if (this.#hasOptional) {
			const bypass = this.optionalBypass(value)
			if (bypass) return bypass.value
		}

		if (this.#isForm) this.#markForm(value)

		if (this.hasCodec) {
			// See FromAsync for the rationale on skipping `Convert`
			if (!this.#noValidate && !this.Check(value))
				throw this.#error(value, type)

			if (this.#decodeMirror)
				value = this.#decodeMirror(value) as Static<T>
			else
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
						() => this.Errors(value),
						this.schema
					)
				}
		} else {
			if (!this.#noValidate && !this.Check(value))
				throw this.#error(value, type)
		}

		if (this.Clean && !this.#decodeMirror)
			value = this.Clean(value) as Static<T>

		if (this.#isForm) this.#unmarkForm(value)
		return value
	}
}
