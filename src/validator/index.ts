import type { TSchema } from 'typebox/type'
import type { TLocalizedValidationError } from 'typebox/error'
import { ValidationError } from '../error'
import { type AnySchema, type StandardSchemaV1Like } from '../type'

import type { ElysiaConfig, MaybePromise } from '../types'
import type { CoerceOption } from '../type/coerce'
import { clearCoerceLeafCache } from '../type/coerce'
import {
	Capture,
	type FrozenValidator,
	type ProgramId,
	type ValidatorSlot
} from '../compile/aot'

import {
	Clone,
	Compile,
	TypeBoxValidator,
	TypeBoxValidatorCache,
	Intersect
} from '../type/bridge'
import { isAsyncFunction } from '../compile/utils'
import { clearSharedReferenceCaches } from '../type/elysia/utils'
import { VALIDATION_PLAN_BUILTIN } from '../type/constants'
import type { ValidationPlanExtension } from '../experimental/validation-plan'
import {
	attachValidatorSemanticSource,
	VALIDATOR_SEMANTIC_MEMBERS,
	type ValidatorSemanticMemberSource,
	type ValidatorSemanticProjection
} from './semantic-channel'
import {
	composedValidatorSemantics,
	runtimeStandardValidatorSemantics,
	validatorSemantics
} from '../compile/validator-semantics'

export {
	VALIDATOR_SEMANTIC_MEMBERS,
	VALIDATOR_SEMANTIC_SOURCE,
	readValidatorSemanticSource,
	type ValidatorSemanticMemberSource,
	type ValidatorSemanticProjection
} from './semantic-channel'

export interface ValidatorOptions {
	app?: {
		['~programId']?: ProgramId
		['~config']?: {
			experimental?: { validationPlan?: ValidationPlanExtension }
		}
	}
	models?: Record<keyof any, AnySchema>
	schemas?: AnySchema[]
	coerces?: CoerceOption[]
	normalize?: boolean | 'exactMirror' | 'typebox'
	sanitize?: ElysiaConfig<any, any>['sanitize']
	aot?: { method: string; path: string }
	slot?: ValidatorSlot
	/** @internal identity slot when runtime slot behavior must remain unchanged. */
	semanticSlot?: ValidatorSlot
	/** @internal actual codec lane used by legacy composition. */
	semanticCodecDirection?: 'decode' | 'encode'
	/** @internal Exact AppPlan-bound image; never selected by method/path. */
	frozen?: FrozenValidator
	/** @internal Route-level exact images indexed by planner slot. */
	frozenSlots?: Partial<Record<ValidatorSlot, FrozenValidator>>
	validationPlan?: ValidationPlanExtension
}

export interface ResponseValidatorOptions extends Omit<
	ValidatorOptions,
	'schemas'
> {
	schemas?: Record<number, AnySchema>[]
}

function createTypeBoxOracleFactory(
	schema: TSchema,
	coerces: CoerceOption[] | undefined,
	normalize: ValidatorOptions['normalize'],
	slot: ValidatorSlot | undefined
) {
	return () =>
		// Keep these dependencies aligned with ValidationPlan's fail-closed admission.
		// @ts-expect-error TypeBox bridge exposes an instance-shaped class type
		new TypeBoxValidator(schema, { coerces, normalize, slot })
}

export type ToSubTypeValidator<T> = T extends AnySchema
	? T extends TSchema
		? TypeBoxValidator<T>
		: StandardValidator
	: never

export abstract class Validator {
	isAsync: boolean = true
	mayReturnPromise = false

	abstract Check(value: unknown): boolean
	abstract Errors(value: unknown): TLocalizedValidationError[]

	static reference(
		schema: string | TSchema | StandardSchemaV1Like,
		models: Record<keyof any, AnySchema> | undefined
	): AnySchema {
		if (typeof schema !== 'string') return schema as unknown as AnySchema
		if (models && schema in models) return models[schema]

		throw new Error(`Schema reference "${schema}" not found in models`)
	}

	From?(
		value: unknown,
		type?: string,
		allowAsync?: boolean
	): MaybePromise<unknown>

	Clean: ((value: unknown) => unknown) | undefined

	seal(_introspect: boolean): void {}

	static create<const Schema extends TSchema>(
		schema: Schema,
		options?: ValidatorOptions
	): TypeBoxValidator<Schema>

	static create<const Schema extends StandardSchemaV1Like>(
		schema: Schema,
		options?: ValidatorOptions
	): StandardValidator

	static create(
		schema: undefined | null,
		options?: ValidatorOptions
	): Validator | undefined

	static create(
		name: AnySchema | string | undefined | null,
		options?: ValidatorOptions
	) {
		if (name == null) {
			if (!options?.schemas?.length) return

			name = options.schemas[0]
			options = { ...options, schemas: options.schemas.slice(1) }
		}

		const schema = Validator.reference(name, options?.models)

		if (options?.schemas?.some((v) => typeof v === 'string')) {
			const models = options.models
			options = {
				...options,
				schemas: options.schemas.map((v) =>
					Validator.reference(v as any, models)
				)
			}
		}

		if (isCompiledSchema(schema)) {
			const message =
				'[Elysia] Compiled schema detected. Please pass t.Schema instead.'

			if (Capture.isCapturing())
				throw new Error(
					`${message} build plugin cannot serialize a pre-compiled schema.`
				)

			console.warn(message)
		}

		let isIntersectable = false

		if (options?.schemas?.length) {
			const candidate =
				options.app?.['~config']?.experimental?.validationPlan
			const composed = candidate?.compose?.(schema, options)

			if (composed) return composed as any

			if (
				'~kind' in schema &&
				options.schemas.every((v) => '~kind' in v || '~elyAcl' in v)
			)
				isIntersectable = true
			else return new LegacyMultiValidator(schema, options) as any
		}

		if ('~kind' in schema || '~elyAcl' in schema) {
			const skipCache =
				options?.normalize === false || !!options?.sanitize
			const aot = options?.aot
			const slot = options?.slot

			const normalizeKey =
				(options?.normalize === 'typebox' ? 'typebox' : '') +
				(slot?.startsWith('response') ? '\0r' : '') +
				'\0s:' +
				(options?.semanticSlot?.startsWith('response:')
					? 'response'
					: (options?.semanticSlot ?? slot ?? 'unknown'))

			const appHasFrozen = !!options?.frozen

			const appSpecific = appHasFrozen || Capture.isCapturing()
			const app = options?.app

			const isResponseSlot =
				options?.slot?.startsWith('response') === true

			if (
				options?.validationPlan &&
				!isIntersectable &&
				!appHasFrozen &&
				!Capture.isCapturing() &&
				!options.sanitize &&
				options.normalize !== false &&
				options.normalize !== 'typebox' &&
				typeof name !== 'string'
			) {
				const domain = isResponseSlot
					? 'encode'
					: options.slot === 'body'
						? 'json'
						: options.slot === 'query' ||
							  options.slot === 'headers' ||
							  options.slot === 'cookie'
							? 'string'
							: undefined
				const planKey = options.slot ?? domain ?? ''
				const cachedPlan = app
					? validationPlanCaches.get(app)?.get(schema)?.get(planKey)
					: undefined
				const validator =
					domain &&
					!(
						domain === 'json' &&
						(options.validationPlan as any)[
							VALIDATION_PLAN_BUILTIN
						] === true
					)
						? options.validationPlan.create?.(
								schema as TSchema,
								domain,
								createTypeBoxOracleFactory(
									schema as TSchema,
									options.coerces,
									options.normalize,
									options.slot
								),
								options.slot === 'query',
								options,
								cachedPlan
							)
						: undefined

				if (validator) {
					if (app) {
						let bySchema = validationPlanCaches.get(app)
						if (!bySchema)
							validationPlanCaches.set(
								app,
								(bySchema = new WeakMap())
							)
						let bySlot = bySchema.get(schema)
						if (!bySlot) bySchema.set(schema, (bySlot = new Map()))
						bySlot.set(planKey, validator)
					}

					return validator as any
				}
			}

			const bypassCache =
				(!!aot && !!slot && Capture.isCapturing()) ||
				(appHasFrozen && options?.normalize !== 'typebox') ||
				(appSpecific && !app)

			let cache = appSpecific
				? app
					? tbCaches.get(app)
					: undefined
				: tbCache

			if (!isIntersectable && !skipCache && !bypassCache && cache) {
				const cached = cache.get(
					schema,
					options?.coerces,
					normalizeKey,
					options?.models
				)
				if (cached) return cached
			} else if (!cache && !bypassCache) {
				// @ts-expect-error
				const created = new TypeBoxValidatorCache()
				cache = created
				if (appSpecific && app) tbCaches.set(app, created)
				else tbCache = created
			}

			// @ts-expect-error
			const validator = new TypeBoxValidator(
				schema,
				options,
				typeof name === 'string' ? name : undefined,
				isIntersectable
			) as any

			if (!isIntersectable && !skipCache && !bypassCache)
				cache!.set(
					schema,
					options?.coerces,
					validator,
					normalizeKey,
					options?.models
				)
			return validator
		}

		if ('~standard' in schema) {
			return new StandardValidator(schema) as any
		}

		throw new Error(
			'Elysia Validator support only TypeBox and Standard Schema'
		)
	}

	static response(
		schema:
			| TSchema
			| StandardSchemaV1Like
			| Record<number, TSchema | StandardSchemaV1Like>
			| undefined
			| null,
		options?: ResponseValidatorOptions
	): Record<number, Validator> | undefined {
		if (schema == null) {
			if (!options?.schemas?.length) return

			schema = options.schemas[0]
			options = { ...options, schemas: options.schemas.slice(1) }
		}

		schema = Validator.reference(schema, options?.models)

		const responseSlot = (status: number | string) =>
			options?.aot ? (`response:${status}` as ValidatorSlot) : undefined
		const responseSemanticSlot = (status: number | string) =>
			`response:${status}` as ValidatorSlot

		if (isSingleSchema(schema))
			return {
				200: Validator.create(
					schema as TSchema | StandardSchemaV1Like,
					{
							...options,
							slot: responseSlot(200),
							frozen: options?.frozenSlots?.['response:200'],
						semanticSlot: responseSemanticSlot(200),
						schemas: options?.schemas
							?.map((s) => toStatusBased(s)[200])
							?.filter(Boolean)
					}
				)
			}

		const entries = Object.entries(schema)

		return Object.fromEntries(
			entries.map(([k, v]) => [
				k,
				v instanceof Validator
					? v
					: Validator.create(v, {
								...options,
								slot: responseSlot(k),
								frozen:
									options?.frozenSlots?.[
										`response:${k}` as ValidatorSlot
									],
							semanticSlot: responseSemanticSlot(k),
							schemas: options?.schemas
								?.map((s) => toStatusBased(s)[k as any])
								?.filter(Boolean)
						})
			])
		)
	}

	static clear() {
		tbCache?.clear()
		tbCaches = new WeakMap()
		clearCoerceLeafCache()
		clearSharedReferenceCaches()
		validationPlanCaches = new WeakMap()
	}
}

interface SealableValidator {
	seal(introspect: boolean): void
}

const rootValidators = new WeakMap<object, Set<SealableValidator>>()

export function trackValidatorCompiler(
	root: object | undefined,
	validator: unknown
) {
	if (!root || !validator) return

	let validators = rootValidators.get(root)
	if (!validators) rootValidators.set(root, (validators = new Set()))

	if (
		validator instanceof Validator ||
		(typeof validator === 'object' &&
			typeof (validator as SealableValidator).seal === 'function')
	)
		validators.add(validator as SealableValidator)
	else if (typeof validator === 'object')
		for (const value of Object.values(validator))
			trackValidatorCompiler(root, value)
}

export function detachValidatorCompiler(root: object, introspect = false) {
	const validators = rootValidators.get(root)
	if (validators) {
		for (const validator of validators) validator.seal(introspect)
		rootValidators.delete(root)
	}

	tbCaches.get(root)?.clear()
	tbCaches.delete(root)
	validationPlanCaches.delete(root)
	tbCache?.clear()
	tbCache = undefined
}

const isCompiledSchema = (schema: any) =>
	schema != null &&
	typeof schema.Check === 'function' &&
	'buildResult' in schema

// a single TypeBox / Standard / Acl schema vs a `Record<status, schema>` map
const isSingleSchema = (schema: any): boolean =>
	'~kind' in schema || '~elyAcl' in schema || '~standard' in schema

const toStatusBased = (
	schema:
		| TSchema
		| StandardSchemaV1Like
		| Record<number, TSchema | StandardSchemaV1Like>
): Record<number, AnySchema> =>
	isSingleSchema(schema)
		? { 200: schema as unknown as AnySchema }
		: (schema as Record<number, AnySchema>)

const isAsyncStandardSchema = (schema: StandardSchemaV1Like) =>
	isAsyncFunction((schema['~standard'] as any).validate)

export const asyncStandardSchemaError = () =>
	new Error(
		'[Elysia] An asynchronous Standard Schema was used where only synchronous validation is supported.'
	)

export class StandardValidator extends Validator {
	override mayReturnPromise = true

	#validate: (
		value: unknown
	) =>
		| { value: unknown }
		| { issues: unknown[] }
		| Promise<{ value: unknown } | { issues: unknown[] }>

	constructor(schema: StandardSchemaV1Like) {
		super()

		// Snapshot the same first record whose callback the executor retains.
		const standard = schema['~standard'] as any
		this.#validate = standard.validate
		attachValidatorSemanticSource(
			this,
			runtimeStandardValidatorSemantics(standard)
		)
		// Preserve the legacy second property read used by async classification.
		this.isAsync = isAsyncStandardSchema(schema)
	}

	#sync(value: unknown) {
		const q = this.#validate(value)

		if (typeof (q as any)?.then === 'function')
			throw asyncStandardSchemaError()

		return q
	}

	Check(value: unknown): boolean {
		return 'value' in this.#sync(value)
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		// @ts-expect-error
		return this.#sync(value).issues ?? []
	}

	EncodeFrom(value: unknown) {
		return this.From(value)
	}

	From(value: unknown, type?: string, allowAsync = this.isAsync): unknown {
		const q = this.#validate(value)

		if (typeof (q as any)?.then === 'function') {
			if (!allowAsync) throw asyncStandardSchemaError()

			return Promise.resolve(q).then((resolved) => {
				if ('issues' in resolved)
					throw new ValidationError(type, value, resolved.issues)

				return resolved.value
			})
		}

		// @ts-expect-error
		if (q.issues) throw new ValidationError(type, value, q.issues)

		// @ts-expect-error
		return q.value
	}
}

class LegacyMultiValidator extends Validator {
	override isAsync = false

	#members: (TypeBoxValidator | StandardValidator)[]

	constructor(
		schema: TSchema | StandardSchemaV1Like,
		options: ValidatorOptions
	) {
		super()

		let typeboxObjects: TSchema[] | undefined
		const schemas = [schema, ...options.schemas!] as (
			| TSchema
			| StandardSchemaV1Like
		)[]

		const compileMember = (
			rawSchema: TSchema,
			legacyIntersected = false
		) => {
			// @ts-expect-error TypeBox bridge exposes an instance-shaped class type
			const validator = new TypeBoxValidator(rawSchema, {
				coerces: options.coerces,
				normalize: options.normalize,
				models: options.models,
				sanitize: options.sanitize,
				semanticSlot: options.semanticSlot ?? options.slot,
				semanticCodecDirection: 'decode'
			})
			const diagnostics = Compile(validator.schema as TSchema)
			validator.diagnosticErrors = (value: unknown) => {
				const errors = diagnostics.Errors(value)
				if (legacyIntersected)
					for (const issue of errors)
						if (typeof issue?.schemaPath === 'string')
							issue.schemaPath =
								'#/allOf/0' + issue.schemaPath.slice(1)
				return errors
			}

			return validator
		}

		for (let i = 0; i < schemas.length; i++) {
			const member = schemas[i]
			const isTypeBox = '~kind' in member

			if (!isTypeBox && !('~standard' in member))
				throw new Error(
					'Elysia Validator support only TypeBox and Standard Schema'
				)

			if (isTypeBox) {
				if (member['~kind'] === 'Object') {
					typeboxObjects ??= []
					typeboxObjects.push(member as TSchema)
					schemas.splice(i, 1)
					i--
				} else schemas[i] = compileMember(member as TSchema) as any
			} else {
				this.mayReturnPromise = true
				const validator = new StandardValidator(member)
				if (validator.isAsync) this.isAsync = true
				schemas[i] = validator as any
			}
		}

		if (typeboxObjects) {
			const validator = compileMember(
				typeboxObjects.length === 1
					? typeboxObjects[0]
					: (Intersect(typeboxObjects) as TSchema),
				true
			)
			schemas.push(validator as any)
		}

		this.#members = schemas as (TypeBoxValidator | StandardValidator)[]
		for (const member of this.#members)
			if (member.isAsync) this.isAsync = true
		this.#captureSemantics()
	}

	override seal(introspect: boolean) {
		for (const member of this.#members) member.seal(introspect)
		this.#captureSemantics()
	}

	#captureSemantics() {
		attachValidatorSemanticSource(
			this,
			composedValidatorSemantics(
				'legacy',
				this.#members.map((validator) => ({
					semantics: validatorSemantics(validator),
					projection: null
				}))
			)
		)
	}

	[VALIDATOR_SEMANTIC_MEMBERS](): readonly ValidatorSemanticMemberSource[] {
		return this.#members.map((validator) => ({
			validator,
			typebox: !(validator instanceof StandardValidator),
			projection: null
		}))
	}

	static #merge(
		snapshot: Record<string, unknown> | unknown[] | undefined,
		result: any
	): Record<string, unknown> | unknown[] {
		if (snapshot === undefined) return result
		if (Array.isArray(snapshot) && Array.isArray(result)) {
			snapshot.push(...result)
			return snapshot
		}

		if (typeof snapshot === 'object' && typeof result === 'object')
			return Object.assign(snapshot, result)

		throw new Error('Unable to merged value with different type')
	}

	Check(value: unknown): boolean {
		for (const validator of this.#members)
			if ((validator as any).hasCodec)
				try {
					;(validator as TypeBoxValidator).FromSync(
						this.#cloneForMember(value) as any
					)
				} catch {
					return false
				}
			else if (!validator.Check(value)) return false

		return true
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		const errors: TLocalizedValidationError[] = []

		for (const validator of this.#members)
			errors.push(...validator.Errors(value))

		return errors
	}

	#cloneForMember(value: unknown) {
		return this.#members.length > 1 &&
			value !== null &&
			typeof value === 'object'
			? Clone(value)
			: value
	}

	EncodeFrom(value: unknown) {
		return this.From(value)
	}

	From(
		value: unknown,
		type?: string,
		allowAsync = this.isAsync
	): MaybePromise<unknown> {
		return this.#fromLoop(value, 0, undefined, type, allowAsync)
	}

	#fromLoop(
		value: unknown,
		start: number,
		snapshot: Record<string, unknown> | unknown[] | undefined,
		type?: string,
		allowAsync = this.isAsync
	): MaybePromise<unknown> {
		for (let i = start; i < this.#members.length; i++) {
			const validator = this.#members[i]
			const input =
				validator instanceof StandardValidator
					? value
					: this.#cloneForMember(value)
			const result: MaybePromise<unknown> =
				validator instanceof StandardValidator
					? validator.From(input, type, allowAsync)
					: validator.isAsync
						? allowAsync
							? validator.FromAsync(input as any, type)
							: (() => {
									throw asyncStandardSchemaError()
								})()
						: validator.FromSync(input as any, type)

			if (typeof (result as any)?.then === 'function')
				return Promise.resolve(result).then((resolved) =>
					this.#fromLoop(
						value,
						i + 1,
						LegacyMultiValidator.#merge(snapshot, resolved),
						type,
						allowAsync
					)
				)

			snapshot = LegacyMultiValidator.#merge(snapshot, result)
		}

		return snapshot!
	}
}

export { LegacyMultiValidator as MultiValidator }

let tbCache: typeof TypeBoxValidatorCache | undefined
let tbCaches = new WeakMap<object, typeof TypeBoxValidatorCache>()
let validationPlanCaches = new WeakMap<
	object,
	WeakMap<object, Map<string, Validator>>
>()
