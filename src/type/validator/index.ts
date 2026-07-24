import { Evaluate, Intersect, Module } from 'typebox/type'
import { Compile, type Validator as BaseTypeBoxValidator } from 'typebox/schema'
import type {
	Static,
	StaticDecode,
	StaticEncode,
	TAny,
	TSchema
} from 'typebox/type'
import {
	Check,
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
	nonAdditionalProperties
} from '../coerce'

import { ELYSIA_TYPES } from '../constants'
import { Validator, type ValidatorOptions } from '../../validator'

import {
	Compiled,
	reconstruct,
	EMPTY_EXTERNALS,
	Capture,
	captureImpl,
	type FrozenValidator
} from '../../compile/aot'

import { hasProperty } from '../utils'
import {
	collectFileTypeChecks,
	takeFileTypeChecks,
	type PendingFileTypeCheck
} from '../elysia/file'
import { isAsyncPredicate } from '../elysia/file-type'
import { nullObject } from '../../utils'
import { ValidationError } from '../../error'
import {
	applyPrecomputed,
	createDefaultCloner,
	createMergerFromSource,
	createObjectDefaultMerger,
	verifyPreallocatableDefault
} from './default-precompute'
import { buildFindCustomError } from './custom-error'
export { TypeBoxValidatorCache } from './validator-cache'
import {
	isFullyClosedObject,
	schemaContainsRef,
	schemaHasDangerousProperties,
	schemaSome
} from './clean-safe'

import type { MaybePromise } from '../../types'

const moduleCache = new WeakMap<
	Record<string, TSchema>,
	Record<string, TSchema>
>()

interface Refinement {
	check: (value: unknown) => unknown
}

interface RefinementGroup {
	refinements: Refinement[]
	checks: Array<(value: unknown) => unknown>
}

interface RefineSlot {
	// bumped once per #validate
	epoch: number
	// bumped again before the failure-path Errors() walk
	replayEpoch: number
	occurrences: number
	// How many occurrence rows were recorded during this validation's recording pass
	recorded: number
	verdicts: boolean[][]
}

interface RefineValidation {
	slots: Map<RefinementGroup, RefineSlot>
	epoch: number
	replayEpoch: number
	replay: boolean
	active: boolean
	checking: boolean
}

let activeRefineValidation: RefineValidation | undefined
const refinementGroups = new WeakMap<object, RefinementGroup>()

// Slots seed at epoch 0 so the first #validate call (epoch 1) resets them.
const freshRefineValidation = (
	groups: Set<RefinementGroup>
): RefineValidation => {
	const slots = new Map<RefinementGroup, RefineSlot>()
	for (const group of groups)
		slots.set(group, {
			epoch: 0,
			replayEpoch: 0,
			occurrences: 0,
			recorded: 0,
			verdicts: []
		})

	return {
		slots,
		epoch: 0,
		replayEpoch: 0,
		replay: false,
		active: false,
		checking: false
	}
}

function collectRefinements(
	schema: any,
	out = new Set<RefinementGroup>(),
	seen = new WeakSet<object>()
) {
	if (!schema || typeof schema !== 'object' || seen.has(schema)) return out
	seen.add(schema)

	const refinements = schema['~refine']
	if (Array.isArray(refinements)) {
		let group = refinementGroups.get(refinements)
		if (!group) {
			const members = refinements.filter(
				(refinement): refinement is Refinement =>
					refinement &&
					typeof refinement === 'object' &&
					typeof refinement.check === 'function'
			)

			if (members.length) {
				group = {
					refinements: members,
					checks: members.map((refinement) => refinement.check)
				}
				refinementGroups.set(refinements, group)

				for (let index = 0; index < members.length; index++) {
					const refinement = members[index]
					refinement.check = function (value: unknown) {
						const validation = activeRefineValidation
						const slot = validation?.slots.get(group!)
						if (slot === undefined)
							return group!.checks[index].call(this, value)

						if (!validation!.replay) {
							if (slot.epoch !== validation!.epoch) {
								slot.epoch = validation!.epoch
								slot.occurrences = 0
								slot.recorded = 0
							}

							if (index === 0) {
								const occurrence = slot.occurrences++
								slot.recorded = slot.occurrences

								let results = slot.verdicts[occurrence]
								if (results === undefined)
									slot.verdicts[occurrence] = results = []

								const checks = group!.checks
								for (let i = 0; i < checks.length; i++)
									results[i] = Boolean(
										checks[i].call(this, value)
									)
							}

							return slot.verdicts[slot.occurrences - 1]![index]
						}

						if (slot.replayEpoch !== validation!.replayEpoch) {
							slot.replayEpoch = validation!.replayEpoch
							slot.occurrences = 0
						}

						if (index === 0) slot.occurrences++

						if (slot.occurrences > slot.recorded) return true

						return slot.verdicts[slot.occurrences - 1][index]
					}
				}
			}
		}

		if (group) out.add(group)
	}

	const maps = [
		schema.properties,
		schema.patternProperties,
		schema.dependentSchemas,
		schema.dependencies,
		schema.$defs,
		schema.definitions
	]
	for (const map of maps)
		if (map && typeof map === 'object' && !Array.isArray(map))
			for (const key of Object.keys(map))
				collectRefinements(map[key], out, seen)

	if (Array.isArray(schema.items))
		for (const item of schema.items) collectRefinements(item, out, seen)
	else collectRefinements(schema.items, out, seen)

	for (const key of [
		'additionalItems',
		'additionalProperties',
		'unevaluatedProperties',
		'propertyNames',
		'contains',
		'unevaluatedItems',
		'not',
		'if',
		'then',
		'else'
	])
		collectRefinements(schema[key], out, seen)

	for (const key of ['prefixItems', 'allOf', 'anyOf', 'oneOf'])
		if (Array.isArray(schema[key]))
			for (const child of schema[key])
				collectRefinements(child, out, seen)

	return out
}

const materializeModels = (models: Record<string, TSchema>) => {
	const out: Record<string, TSchema> = {}

	for (const name in models) {
		const schema = models[name]
		const value: Record<string, unknown> = {}
		let source = schema

		while (source && source !== Object.prototype) {
			for (const key of Object.getOwnPropertyNames(source))
				if (key !== '$id' && !Object.hasOwn(value, key))
					Object.defineProperty(
						value,
						key,
						Object.getOwnPropertyDescriptor(source, key)!
					)
			source = Object.getPrototypeOf(source)
		}

		out[name] = value as TSchema
	}

	return out
}

// Fast path for the standalone-guard merge when every member is plain object
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

const LAZY_JIT_THRESHOLD = 16

export function schemaMayHaveAsyncRefine(
	node: any,
	seen: WeakSet<object> = new WeakSet()
) {
	if (!node || typeof node !== 'object' || seen.has(node)) return false
	seen.add(node)

	if (isAsyncPredicate(node['~refine'])) return true

	for (const key of Object.keys(node)) {
		const value = node[key]
		if (isAsyncPredicate(value)) return true
		if (
			value &&
			typeof value === 'object' &&
			schemaMayHaveAsyncRefine(value, seen)
		)
			return true
	}

	return false
}

// Any custom-`error` node forces eager: `buildFindCustomError` Compiles union
// checks (custom-error.ts:188/:231) regardless of deferral, so deferring saves
// nothing and risks message parity (§4.3). `schemaSome` over-approximates the
// traversal in `collectCustomErrorNodes`, which is safe (force-eager).
const schemaHasCustomError = (schema: any): boolean =>
	schemaSome(schema, (node) => node.error !== undefined)

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

interface DefaultFastPath {
	/** `Default(schema, undefined)`; cloned when object-like. */
	value: unknown

	/** Legacy parity: this precomputed default also applies to explicit `null`. */
	appliesToNull: boolean

	/** `Default(schema, {})`, used to merge child defaults into partial objects. */
	objectTemplate: Record<string, unknown> | undefined

	/** Generated object/array cloner for `value` when available. */
	clone?: () => unknown

	/**
	 * Generated default merger for present input. Schema-driven when available
	 * (fills object keys and maps array element defaults); self-guards its input
	 * shape so a non-matching value passes through unchanged.
	 */
	merge?: (value: any) => any
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
	#refinements?: Set<RefinementGroup>
	// Pooled once per validator; #validate resets it via an epoch counter rather than re-allocating
	// Safe because #validate is synchronous and nesting only ever interleaves different validator
	#refineScratch?: RefineValidation
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
	#cleanRedundant = false

	// Lazy-JIT deferral state (design/lazy-jit-validator.md, as amended by the
	// implementation note below). While `#deferred`, `this.tb` is undefined and
	// `#rawCheck` uses the interpreted `Check` — byte-identical verdicts, no
	// `new Function` JIT retained. The validator materializes the compiled `tb`
	// once `#hits` reaches LAZY_JIT_THRESHOLD. Only the typebox `Compile` is
	// deferred; the exact-mirror Clean and codec mirrors are built eagerly (they
	// cost ~0 extra bytes measured, and the interpreted mirror cannot handle
	// Union/codec schemas), so nothing but `#rawCheck` differs across the swap
	// and Clean/Decode/Encode parity is guaranteed by construction. Post-
	// construction mutation of the public `schema` field is UNSUPPORTED (§10.6).
	#deferred = false
	#hits = 0

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
		// raw (uncoerced) schema, retained for the bridge-free marker
		const rawSchema: unknown = schema

		const frozen =
			options?.aot && options.slot
				? Compiled.getValidator(
						options.aot.method,
						options.aot.path,
						options.slot,
						options.app?.['~programId']
					)
				: undefined

		let schemaHasRef = false
		if (name && options?.models) {
			schema = (
				moduleCache.getOrInsertComputed(options.models, () =>
					Module(
						materializeModels(
							options.models as Record<string, TSchema>
						)
					)
				) as any
			)[name]

			if (isIntersectable) {
				const members = [schema, ...options!.schemas!]
				schema = (shallowMergeObjects(members) ??
					Evaluate(Intersect(members as any))) as unknown as T
			}
		} else if (options?.models && typeof name !== 'string') {
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
				? buildCoercedFromPlan(schema as any, frozen!.cp)
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

			this.hasCodec = HasCodec(this.schema)
			this.hasDefault = hasProperty('default', this.schema as any)

			// Deferrable when nothing forces eager JIT (§4 as amended by §10.3):
			// - capture reads `this.tb.buildResult` for the AOT manifest;
			// - precompile / `.compile()` request eager compilation (`eager`);
			// - an async refine needs the file-check queue AND the exact
			//   `isAsync` from Build (deferred is `isAsync === false` by proof);
			// - a custom-error node makes `buildFindCustomError` Compile union
			//   checks anyway, so deferring saves nothing and risks parity.
			const deferrable =
				!capturing &&
				!options?.eager &&
				!schemaMayHaveAsyncRefine(this.schema as any) &&
				!schemaHasCustomError(this.schema as any)

			if (deferrable) {
				this.#deferred = true
				this.isAsync = false
			} else {
				this.tb =
					capturing && captureImpl
						? captureImpl.sourceOnlyValidator(this.schema as TSchema)
						: Compile(this.schema as TSchema)

				this.isAsync =
					// @ts-expect-error private property
					this.tb.buildResult.external.variables.some(
						isAsyncPredicate
					) ?? false

				if (capturing && captureImpl && options?.aot && options.slot)
					captureImpl.maybeCapture({
						aot: options.aot,
						slot: options.slot,
						hasRef: schemaHasRef,
						originalSchema: schema,
						schema: this.schema,
						hasCodec: this.hasCodec,
						hasDefault: this.hasDefault,
						coerces: options.coerces,
						normalize: options.normalize,
						sanitize: options.sanitize,
						// @ts-expect-error private property
						buildResult: this.tb!.buildResult
					})
				else if (!capturing) this.#dropCompiledSource()
			}
		}

		if (!this.isAsync) {
			const refinements = collectRefinements(this.schema)
			if (refinements.size) this.#refinements = refinements
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
			const defaults = this.hasDefault
				? verifyPreallocatableDefault(
						this.schema as TSchema,
						Capture.isCapturing()
					)
				: undefined

			if (defaults) {
				this.precomputeSafe = true

				const objectTemplate =
					defaults.pod !== undefined
						? (Object.freeze(defaults.pod) as Record<
								string,
								unknown
							>)
						: undefined

				this.#defaultFastPath = {
					value: defaults.pd,
					appliesToNull: defaults.pn,
					objectTemplate,
					clone:
						defaults.pd !== undefined
							? createDefaultCloner(defaults.pd)
							: undefined,
					merge: defaults.ms
						? createMergerFromSource(defaults.ms)
						: objectTemplate !== undefined
							? createObjectDefaultMerger(objectTemplate)
							: undefined
				}
			} else {
				this.precomputeSafe = false
				this.#defaultFastPath = undefined
			}
		}

		this.#noValidate = originalElyTyp === ELYSIA_TYPES.NoValidate
		this.#isForm = originalElyTyp === ELYSIA_TYPES.Form
		this.#hasOptional = !!(this.schema as any)?.['~optional']

		if (frozen?.ic)
			reconstruct().reconstructInnerCodecs(frozen.ic, this.schema)

		if (isFrozen && frozen!.cm) {
			const both = reconstruct().instantiateFrozenBoth(
				frozen!,
				this.schema,
				schema
			)
			this.reconstructedCheck = both.check
			this.Clean =
				options?.normalize === false
					? undefined
					: schemaHasDangerousProperties(this.schema)
						? (value) => Clean(this.schema, value)
						: both.clean
		} else {
			if (isFrozen)
				this.reconstructedCheck = frozen!.c!(
					frozen!.e
						? reconstruct().collectExternals(this.schema)
						: EMPTY_EXTERNALS
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

		this.#cleanRedundant =
			!!this.Clean &&
			!options?.sanitize &&
			options?.normalize !== 'typebox' &&
			isFullyClosedObject(this.schema)

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

		if (
			options?.aot &&
			options.slot &&
			Capture.isCapturing() &&
			captureImpl
		)
			captureImpl.captureBridgeFree(options.aot, options.slot, rawSchema)
	}

	#error(
		value: unknown,
		type?: string,
		errors?: TLocalizedValidationError[]
	): ValidationError {
		return new ValidationError(
			type,
			value,
			errors ?? (() => this.Errors(value)),
			this.schema,
			this.#findCustomError
		)
	}

	#validate(value: unknown): TLocalizedValidationError[] | undefined {
		if (!this.#refinements)
			return this.Check(value as Static<T>) ? undefined : []

		const pool = (this.#refineScratch ??= freshRefineValidation(
			this.#refinements
		))

		const usingPool = !pool.active
		const validation = usingPool
			? pool
			: freshRefineValidation(this.#refinements)

		const previous = activeRefineValidation
		if (usingPool) pool.active = true
		validation.epoch++
		validation.replay = false
		activeRefineValidation = validation

		try {
			if (this.Check(value as Static<T>)) return

			validation.replay = true
			// Replay re-walks occurrences from zero without re-invoking
			// refines and without wiping the recorded verdict rows.
			validation.replayEpoch++
			return this.Errors(value)
		} finally {
			activeRefineValidation = previous
			if (usingPool) pool.active = false
		}
	}

	#setupMirror(
		schema: TSchema,
		options?: ValidatorOptions,
		frozen?: FrozenValidator
	): ((value: unknown) => unknown) | undefined {
		if (schemaHasDangerousProperties(this.schema))
			return (value) => Clean(this.schema, value)

		const aot = options?.aot
		const slot = options?.slot

		if (aot && slot && frozen?.m) {
			const m = frozen.m
			let clean: ((value: unknown) => unknown) | undefined

			return (value: unknown) => {
				if (clean === undefined)
					try {
						clean = reconstruct().instantiateFrozenMirror(m, schema)
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

		if (aot && slot && Capture.isCapturing() && captureImpl)
			captureImpl.captureMirror(schema, aot, slot, options?.sanitize)

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
		if (schemaHasDangerousProperties(this.schema)) return

		const aot = options?.aot
		const slot = options?.slot
		const frozenMirror = dir === 'decode' ? frozen?.dm : frozen?.em

		if (aot && slot && frozenMirror) {
			const m = frozenMirror
			let run: ((value: unknown) => unknown) | undefined

			return (value: unknown) => {
				if (run === undefined)
					try {
						run = reconstruct().instantiateFrozenDecodeMirror(
							m,
							schema,
							dir
						)
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

		if (aot && slot && Capture.isCapturing() && captureSlot && captureImpl)
			captureImpl.captureCodecMirror(
				schema,
				aot,
				slot,
				options?.sanitize,
				dir
			)

		try {
			return createMirror(schema, {
				Compile,
				sanitize: options?.sanitize,
				...dirOpt
			}) as (value: unknown) => unknown
		} catch {}
	}

	Check(value: Static<T>): boolean {
		// Every request-facing validation routes through Check (directly, or via
		// #validate from FromSync/FromAsync, or WS outbound response validation);
		// tick here so all of them count toward materialization (§10.4).
		this.#tick()

		const pool = this.#refineScratch
		if (pool?.active && this.#refinements) {
			if (pool.checking) {
				const previous = activeRefineValidation
				activeRefineValidation = undefined
				try {
					return this.#rawCheck(value)
				} finally {
					activeRefineValidation = previous
				}
			}

			pool.checking = true
			try {
				return this.#rawCheck(value)
			} finally {
				pool.checking = false
			}
		}

		return this.#rawCheck(value)
	}

	#rawCheck(value: Static<T>): boolean {
		if (this.reconstructedCheck) return this.reconstructedCheck(value)
		if (this.#deferred) return Check(this.schema as TSchema, value)

		return this.tb!.Check(value)
	}

	// Increment the hit counter and materialize once the threshold is crossed.
	// A no-op after materialization (`#deferred` is false).
	#tick(): void {
		if (this.#deferred && ++this.#hits >= LAZY_JIT_THRESHOLD)
			this.#materialize()
	}

	/**
	 * Promote a deferred validator to the compiled `Check` fast path. Runs
	 * synchronously inside a Check/EncodeFrom call; single-threaded, so no torn
	 * reads. Builds the compiled `tb` into a local and commits at the end, so a
	 * mid-materialize throw leaves the interpreted state fully intact. Only
	 * `#rawCheck`'s behaviour changes — Clean and codec mirrors were already
	 * built eagerly at construction, so their output is unchanged. `isAsync`
	 * stays false (proven at construction via `schemaMayHaveAsyncRefine`), so the
	 * descriptor's baked codegen remains correct across the swap.
	 */
	#materialize(): void {
		const tb = Compile(this.schema as TSchema)

		// Commit — only reached when Compile succeeded.
		this.tb = tb
		this.#dropCompiledSource()
		this.#deferred = false
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
		// The codec encode path (Encode → Clean) never touches Check, so tick
		// here too or a deferred response-codec validator would never materialize
		// (§10.4). Redundant with Check's tick on the non-codec path (harmless —
		// materialization is idempotent).
		this.#tick()

		if (this.#isForm) {
			const errors = this.#noValidate ? undefined : this.#validate(value)
			if (errors)
				throw this.#error(
					value,
					type,
					errors.length ? errors : undefined
				)

			return value as any
		}

		if (!this.hasCodec) {
			const errors = this.#noValidate ? undefined : this.#validate(value)
			if (errors)
				throw this.#error(
					value,
					type,
					errors.length ? errors : undefined
				)

			if (this.Clean) value = this.Clean(value) as Static<T>
			return value as any
		}

		try {
			if (this.#encodeMirror) {
				const out = this.#encodeMirror(value)

				const errors = this.#noValidate
					? undefined
					: this.#validate(out as any)
				if (errors)
					throw new ValidationError(
						type,
						out,
						errors.length ? errors : () => this.Errors(out),
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
		) {
			Object.defineProperty(value, '~ely-form', {
				value: 1,
				configurable: true
			})

			return true
		}

		return false
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
		return defaults.clone ? defaults.clone() : structuredClone(value)
	}

	#applyPrecomputedObjectDefault(value: Record<string, unknown>) {
		const defaults = this.#defaultFastPath!

		if (defaults.merge) return defaults.merge(value)
		if (Array.isArray(value)) return value

		return applyPrecomputed(defaults.objectTemplate!, value)
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
					value !== null &&
					typeof value === 'object' &&
					(defaults.merge !== undefined ||
						defaults.objectTemplate !== undefined)
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

		const markedValue = value
		const marked = this.#isForm ? this.#markForm(value) : false
		try {
			if (this.hasCodec) {
				if (!this.#noValidate) {
					collectFileTypeChecks()

					let errors: TLocalizedValidationError[] | undefined
					let pendingFile: ReturnType<typeof takeFileTypeChecks>
					try {
						errors = this.#validate(value)
					} finally {
						pendingFile = takeFileTypeChecks()
					}

					if (errors)
						throw this.#error(
							value,
							type,
							errors.length ? errors : undefined
						)
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
				// take() MUST run even if Check throws (type-elysia-2), see above.
				collectFileTypeChecks()
				let errors: TLocalizedValidationError[] | undefined
				let pendingFile: ReturnType<typeof takeFileTypeChecks>
				try {
					errors = this.#validate(value)
				} finally {
					pendingFile = takeFileTypeChecks()
				}

				if (errors)
					throw this.#error(
						value,
						type,
						errors.length ? errors : undefined
					)
				if (pendingFile)
					await enforceFileTypeChecks(
						pendingFile,
						type,
						value,
						this.schema
					)
			}

			if (this.Clean && !this.#decodeMirror && !this.#cleanRedundant)
				value = this.Clean(value) as Static<T>

			return value
		} finally {
			if (marked) this.#unmarkForm(markedValue)
		}
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
					value !== null &&
					typeof value === 'object' &&
					(defaults.merge !== undefined ||
						defaults.objectTemplate !== undefined)
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

		const markedValue = value
		const marked = this.#isForm ? this.#markForm(value) : false
		try {
			if (this.hasCodec) {
				// See FromAsync for the rationale on skipping `Convert`
				const errors = this.#noValidate
					? undefined
					: this.#validate(value)
				if (errors)
					throw this.#error(
						value,
						type,
						errors.length ? errors : undefined
					)

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
				const errors = this.#noValidate
					? undefined
					: this.#validate(value)
				if (errors)
					throw this.#error(
						value,
						type,
						errors.length ? errors : undefined
					)
			}

			if (this.Clean && !this.#decodeMirror && !this.#cleanRedundant)
				value = this.Clean(value) as Static<T>

			return value
		} finally {
			if (marked) this.#unmarkForm(markedValue)
		}
	}
}
