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
	Decode,
	DecodeUnsafe,
	Clone,
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
	isAsyncPredicate,
	takeFileTypeChecks,
	type PendingFileTypeCheck
} from '../elysia/file-type'
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
	schemaHasDangerousProperties
} from './clean-safe'
import { createCleanPlan } from './clean-plan'
import { createDecodePlan, createEncodePlan } from './codec-plan'
import { createConvertPlan } from './convert-plan'
import { createDefaultPlan } from './default-plan'

import type { MaybePromise } from '../../types'
import {
	createCompactErrorLocator,
	compactDiagnosticSchema,
	compactErrors,
	type CompactErrorLocator
} from '../../validator/compact-errors'

const moduleCache = new WeakMap<
	Record<string, TSchema>,
	Record<string, TSchema>
>()

interface Refinement {
	check: (value: unknown) => unknown
}

interface RefinementGroup {
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
	// Legacy composition supplies its historical lazy diagnostic enumerator.
	// It is authoring-only and is discarded by seal().
	diagnosticErrors?: (value: unknown) => TLocalizedValidationError[]

	schema!: T

	hasCodec!: boolean
	isAsync!: boolean
	hasDefault!: boolean

	#decodeMirror?: (value: unknown) => unknown
	#decodeOperation?: (value: unknown) => unknown
	#encodeMirror?: (value: unknown) => unknown
	#encodeOperation?: (value: unknown) => unknown
	#encodeDefaultOperation?: (value: unknown) => unknown
	#encodeConvertOperation?: (value: unknown) => unknown
	#encodeCleanOperation?: (value: unknown) => unknown
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
	#defaultFallback?: (value: unknown) => unknown

	#noValidate!: boolean
	#isForm = false
	#hasOptional = false
	#cleanRedundant = false
	#optionalObject = false
	#detachedCheck?: (value: unknown) => boolean
	#compactSchema?: unknown
	#errorLocator?: CompactErrorLocator

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
			this.tb =
				capturing && captureImpl
					? captureImpl.sourceOnlyValidator(this.schema as TSchema)
					: Compile(this.schema as TSchema)

			this.hasCodec = HasCodec(this.schema)
			this.isAsync =
				// @ts-expect-error private property
				this.tb.buildResult.external.variables.some(isAsyncPredicate) ??
				false

			this.hasDefault = hasProperty('default', this.schema as any)

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
				if (this.hasDefault)
					this.#defaultFallback = createDefaultPlan(this.schema)
			}
		}

		this.#noValidate = originalElyTyp === ELYSIA_TYPES.NoValidate
		this.#isForm = originalElyTyp === ELYSIA_TYPES.Form
		this.#hasOptional = !!(this.schema as any)?.['~optional']
		this.#optionalObject = (this.schema as any)?.['~kind'] === 'Object'

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
						? createCleanPlan(this.schema)
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
							? createCleanPlan(this.schema)
							: this.#setupMirror(schema, options, frozen)
			} catch (error) {
				console.warn(
					'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
				)
				console.warn(schema)
				console.warn(error)

				if (options?.normalize !== false) {
					this.Clean = createCleanPlan(this.schema)
				}
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
			!options?.slot?.startsWith('r') &&
			!this.#decodeMirror
		)
			this.#decodeOperation = createDecodePlan(this.schema)

		if (this.hasCodec && !this.#isForm && options?.slot?.startsWith('r'))
			this.#encodeMirror = this.#setupCodecMirror(
				this.schema as TSchema,
				options,
				frozen,
				'encode'
			)
		if (
			this.hasCodec &&
			!this.#isForm &&
			options?.slot?.startsWith('r') &&
			!this.#encodeMirror
		) {
			this.#encodeOperation = createEncodePlan(this.schema)
			this.#encodeDefaultOperation = createDefaultPlan(this.schema)
			this.#encodeConvertOperation = createConvertPlan(this.schema)
			this.#encodeCleanOperation = createCleanPlan(this.schema)
		}

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

	override seal(introspect: boolean) {
		if (this.#detachedCheck) return
		this.#dropCompiledSource()

		if (this.hasDefault && !this.#defaultFastPath && !this.#defaultFallback)
			throw new Error(
				'[Elysia] Validator cannot be detached because its default operation is unavailable.'
			)
		if (
			this.hasCodec &&
			!this.#isForm &&
			!this.#decodeMirror &&
			!this.#decodeOperation &&
			!this.#encodeMirror &&
			!this.#encodeOperation
		)
			throw new Error(
				'[Elysia] Validator cannot be detached because its codec mirror is unavailable.'
			)

		this.#detachedCheck =
			this.reconstructedCheck ?? (this.tb as any)?.evaluateResult?.check
		if (!this.#detachedCheck)
			throw new Error(
				'[Elysia] Validator cannot be detached because its executable check is unavailable.'
			)

		this.#compactSchema = introspect
			? compactDiagnosticSchema(this.schema)
			: undefined
		this.#errorLocator = createCompactErrorLocator(this.schema)
		this.tb = undefined
		this.reconstructedCheck = undefined
		this.diagnosticErrors = undefined
		;(this as any).schema = undefined
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
		if (schemaHasDangerousProperties(this.schema)) {
			return createCleanPlan(this.schema)
		}

		const aot = options?.aot
		const slot = options?.slot

		if (aot && slot && frozen?.m) {
			try {
				return reconstruct().instantiateFrozenMirror(frozen.m, schema)
			} catch (error) {
				console.warn(
					'Failed to create exactMirror. Please report the following code to https://github.com/elysiajs/elysia/issues'
				)
				console.warn(schema)
				console.warn(error)
				return (value) => value
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
			try {
				return reconstruct().instantiateFrozenDecodeMirror(
					frozenMirror,
					schema,
					dir
				)
			} catch {
				return
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
		if (this.#detachedCheck) return this.#detachedCheck(value)
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

	#dropCompiledSource(): void {
		const tb = this.tb as any
		if (!tb) return
		if (tb.evaluateResult) tb.evaluateResult.code = undefined
		if (tb.buildResult) tb.buildResult.functions = undefined
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		return this.diagnosticErrors
			? this.diagnosticErrors(value)
			: this.schema
				? Errors(this.schema, value)
				: this.#compactSchema
					? (compactErrors(
							this.#compactSchema,
							value
						) as TLocalizedValidationError[])
					: (this.#errorLocator?.(
							value
						) as TLocalizedValidationError[])
	}

	Decode(value: Static<T>): StaticDecode<T> {
		return (
			this.#decodeMirror
				? this.#decodeMirror(value)
				: this.#decodeOperation
					? this.#decodeOperation(value)
					: this.schema
						? Decode(this.schema, value)
						: value
		) as StaticDecode<T>
	}

	#encodeWithOperation(value: unknown): unknown {
		let out = this.#encodeOperation!(Clone(value))
		if (this.#encodeDefaultOperation)
			out = this.#encodeDefaultOperation(out)
		if (this.#encodeConvertOperation)
			out = this.#encodeConvertOperation(out)
		if (this.#encodeCleanOperation) out = this.#encodeCleanOperation(out)
		return out
	}

	Encode(value: Static<T>): StaticEncode<T> {
		return (
			this.hasCodec
				? this.#encodeMirror
					? this.#encodeMirror(value)
					: this.#encodeOperation
						? this.#encodeWithOperation(value)
						: this.schema
							? Encode(this.schema, value)
							: value
				: value
		) as StaticEncode<T>
	}

	EncodeFrom(value: Static<T>, type?: string): StaticEncode<T> {
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

			if (this.#encodeOperation) {
				if (this.#noValidate) {
					const out = this.#encodeOperation(value)
					return this.Clean ? (this.Clean(out) as any) : (out as any)
				}

				const out = this.#encodeWithOperation(value)

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
		if (!this.#hasOptional) return

		if (value === undefined || value === null)
			return {
				bypass: true,
				value: (this.#optionalObject
					? nullObject()
					: value) as Static<T>
			}

		if (
			this.#optionalObject &&
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
			} else
				value = (
					this.#defaultFallback
						? this.#defaultFallback(value)
						: Default(this.schema, value)
				) as any
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
				else if (this.#decodeOperation)
					value = this.#decodeOperation(value) as Static<T>
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
			} else
				value = (
					this.#defaultFallback
						? this.#defaultFallback(value)
						: Default(this.schema, value)
				) as Static<T>
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
				else if (this.#decodeOperation)
					value = this.#decodeOperation(value) as Static<T>
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
