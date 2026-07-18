import type { TSchema } from 'typebox/type'
import type { TLocalizedValidationError } from 'typebox/error'

import type { AnySchema, StandardSchemaV1Like } from '../type'
import type { MaybePromise } from '../types'
import { Capture } from '../compile/aot'
import { StandardValidator, Validator, type ValidatorOptions } from './index'

const asyncStandardSchemaError = () =>
	new Error(
		'[Elysia] An asynchronous Standard Schema was used where only synchronous validation is supported.'
	)

const anySibling = Object.freeze(
	Object.defineProperty({}, '~kind', { value: 'Any' })
) as TSchema

const isTypeBoxSchema = (schema: any): schema is TSchema =>
	!!schema &&
	typeof schema === 'object' &&
	('~kind' in schema || '~elyAcl' in schema)

function acceptsProperty(schema: TSchema, key: string) {
	if (Object.hasOwn((schema as any).properties ?? {}, key)) return true

	const patterns = (schema as any).patternProperties
	if (!patterns) return false

	for (const pattern of Object.keys(patterns))
		try {
			if (new RegExp(pattern).test(key)) return true
		} catch {
			// Invalid patterns remain the schema compiler's error to report.
		}

	return false
}

interface Projection {
	remove?: Set<string>
	children?: Map<string, Projection>
}

function prepareCompositionMember(
	schema: TSchema,
	peers: TSchema[],
	closeObjects: boolean
): { schema: TSchema; projection?: Projection; changed: boolean } {
	if ((schema as any)['~kind'] !== 'Object') return { schema, changed: false }

	const objectPeers = peers.filter(
		(peer) => (peer as any)['~kind'] === 'Object'
	)
	if (!objectPeers.length) return { schema, changed: false }

	const properties = Object.assign(
		Object.create(null),
		(schema as any).properties
	)
	const keys = new Set<string>()
	for (const peer of objectPeers)
		for (const key of Object.keys((peer as any).properties ?? {}))
			keys.add(key)

	let changed = false
	let remove: Set<string> | undefined
	let children: Map<string, Projection> | undefined
	const additional = (schema as any).additionalProperties
	const restrictive =
		closeObjects || (additional !== undefined && additional !== true)

	for (const key of keys) {
		const propertyMap = (schema as any).properties
		const own =
			propertyMap && Object.hasOwn(propertyMap, key)
				? (propertyMap[key] as TSchema)
				: undefined

		if (!own) {
			if (!restrictive || acceptsProperty(schema, key)) continue

			Object.defineProperty(properties, key, {
				value: anySibling,
				enumerable: true,
				configurable: true,
				writable: true
			})
			;(remove ??= new Set()).add(key)
			changed = true

			continue
		}

		const childPeers = objectPeers
			.map((peer) => {
				const peerProperties = (peer as any).properties
				return peerProperties && Object.hasOwn(peerProperties, key)
					? peerProperties[key]
					: undefined
			})
			.filter(isTypeBoxSchema)

		const prepared = prepareCompositionMember(own, childPeers, closeObjects)
		if (prepared.changed) {
			properties[key] = prepared.schema
			changed = true
		}

		if (prepared.projection)
			(children ??= new Map()).set(key, prepared.projection)
	}

	if (!changed) return { schema, changed: false }

	const descriptors = Object.getOwnPropertyDescriptors(schema)
	descriptors.properties = {
		...descriptors.properties,
		value: properties,
		enumerable: true,
		configurable: true,
		writable: true
	}

	return {
		schema: Object.defineProperties(
			Object.create(Object.getPrototypeOf(schema)),
			descriptors
		) as TSchema,
		projection: remove || children ? { remove, children } : undefined,
		changed: true
	}
}

interface CompositionMember {
	validator: Validator
	typebox: boolean
	projection?: Projection
}

export class ValidationPlanMultiValidator extends Validator {
	override isAsync = false
	hasCodec = false

	#members: CompositionMember[]

	static #isPlainRecord(value: unknown): value is Record<keyof any, unknown> {
		if (!value || typeof value !== 'object' || Array.isArray(value))
			return false

		const prototype = Object.getPrototypeOf(value)
		return prototype === Object.prototype || prototype === null
	}

	static #cloneAccumulator(
		value: any,
		seen = new WeakMap<object, any>()
	): any {
		if (value === null || typeof value !== 'object') return value
		const cached = seen.get(value)
		if (cached) return cached

		if (value instanceof Date) {
			const output = new Date(value.getTime())
			seen.set(value, output)
			return output
		}
		if (value instanceof Map) {
			const output = new Map()
			seen.set(value, output)
			for (const [key, entry] of value)
				output.set(
					ValidationPlanMultiValidator.#cloneAccumulator(key, seen),
					ValidationPlanMultiValidator.#cloneAccumulator(entry, seen)
				)
			return output
		}
		if (value instanceof Set) {
			const output = new Set()
			seen.set(value, output)
			for (const entry of value)
				output.add(
					ValidationPlanMultiValidator.#cloneAccumulator(entry, seen)
				)
			return output
		}

		const array = Array.isArray(value)
		if (!array && !ValidationPlanMultiValidator.#isPlainRecord(value))
			return value

		const output = array ? [] : Object.create(Object.getPrototypeOf(value))
		seen.set(value, output)

		for (const key of Reflect.ownKeys(value)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key)

			if (!descriptor) continue
			if ('value' in descriptor)
				descriptor.value =
					ValidationPlanMultiValidator.#cloneAccumulator(
						descriptor.value,
						seen
					)
			if (key !== 'length') descriptor.configurable = true
			if ('writable' in descriptor) descriptor.writable = true

			Object.defineProperty(output, key, descriptor)
		}

		return output
	}

	constructor(
		schema: TSchema | StandardSchemaV1Like,
		options: ValidatorOptions
	) {
		super()

		const schemas = [schema, ...options.schemas!] as AnySchema[]
		const typeboxSchemas = schemas.filter(isTypeBoxSchema)

		if (options.aot && options.slot && Capture.isCapturing())
			Capture.set(
				{
					method: options.aot.method,
					path: options.aot.path,
					slot: options.slot
				},
				{ bridgeFree: false }
			)

		const memberOptions: ValidatorOptions = {
			...options,
			schemas: undefined,
			aot: undefined,
			slot: undefined
		}

		this.#members = schemas.map((raw) => {
			if (isTypeBoxSchema(raw)) {
				const prepared = prepareCompositionMember(
					raw,
					typeboxSchemas,
					options.normalize === false
				)
				const validator = Validator.create(
					prepared.schema,
					memberOptions
				)!
				if (validator.isAsync) this.isAsync = true
				if ((validator as any).hasCodec) this.hasCodec = true

				return {
					validator,
					typebox: true,
					projection: prepared.projection
				}
			}

			if ('~standard' in raw) {
				this.mayReturnPromise = true
				const validator = new StandardValidator(raw)
				if (validator.isAsync) this.isAsync = true

				return {
					validator,
					typebox: false
				}
			}

			throw new Error(
				'Elysia Validator support only TypeBox and Standard Schema'
			)
		})
	}

	static #merge(
		snapshot: any,
		result: any,
		topLevel = true,
		pairs = new WeakMap<object, WeakSet<object>>()
	): any {
		if (snapshot === undefined)
			return result !== null && typeof result === 'object'
				? ValidationPlanMultiValidator.#cloneAccumulator(result)
				: result
		if (topLevel && Array.isArray(snapshot) && Array.isArray(result)) {
			snapshot.push(
				...ValidationPlanMultiValidator.#cloneAccumulator(result)
			)
			return snapshot
		}

		if (
			ValidationPlanMultiValidator.#isPlainRecord(snapshot) &&
			ValidationPlanMultiValidator.#isPlainRecord(result)
		) {
			let targets = pairs.get(result)
			if (targets?.has(snapshot)) return snapshot
			if (!targets) pairs.set(result, (targets = new WeakSet()))
			targets.add(snapshot)

			for (const key of Reflect.ownKeys(result)) {
				const descriptor = Object.getOwnPropertyDescriptor(result, key)
				if (!descriptor?.enumerable) continue

				const previous = Object.hasOwn(snapshot, key)
					? snapshot[key]
					: undefined
				const next = (result as any)[key]
				const value =
					ValidationPlanMultiValidator.#isPlainRecord(previous) &&
					ValidationPlanMultiValidator.#isPlainRecord(next)
						? ValidationPlanMultiValidator.#merge(
								previous,
								next,
								false,
								pairs
							)
						: ValidationPlanMultiValidator.#cloneAccumulator(next)

				Object.defineProperty(snapshot, key, {
					value,
					enumerable: true,
					configurable: true,
					writable: true
				})
			}
			return snapshot
		}

		return ValidationPlanMultiValidator.#cloneAccumulator(result)
	}

	Check(value: unknown): boolean {
		for (const { validator, typebox } of this.#members) {
			if (typebox && (validator as any).hasCodec)
				try {
					;(validator as any).Decode(this.#cloneForMember(value))
				} catch {
					return false
				}
			else if (!validator.Check(value)) return false
		}

		return true
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		const errors: TLocalizedValidationError[] = []
		for (const { validator } of this.#members)
			errors.push(...validator.Errors(value))

		return errors
	}

	#cloneForMember(value: unknown) {
		return value !== null && typeof value === 'object'
			? ValidationPlanMultiValidator.#cloneAccumulator(value)
			: value
	}

	#project(result: unknown, projection: Projection | undefined): unknown {
		if (!projection || !result || typeof result !== 'object') return result

		const projected = Array.isArray(result)
			? []
			: Object.create(Object.getPrototypeOf(result))
		for (const key of Reflect.ownKeys(result)) {
			if (typeof key === 'string' && projection.remove?.has(key)) continue

			const descriptor = Object.getOwnPropertyDescriptor(result, key)
			if (!descriptor) continue

			const child =
				typeof key === 'string'
					? projection.children?.get(key)
					: undefined
			if (child && 'value' in descriptor)
				descriptor.value = this.#project(descriptor.value, child)

			Object.defineProperty(projected, key, descriptor)
		}

		return projected
	}

	EncodeFrom(value: unknown, type?: string): MaybePromise<unknown> {
		return this.#fromLoop(value, 0, undefined, type, true, this.isAsync)
	}

	From(
		value: unknown,
		type?: string,
		allowAsync = this.isAsync
	): MaybePromise<unknown> {
		return this.#fromLoop(
			value,
			0,
			undefined,
			type,
			type === 'response',
			allowAsync
		)
	}

	#fromLoop(
		value: unknown,
		start: number,
		snapshot: unknown,
		type: string | undefined,
		encode: boolean,
		allowAsync: boolean
	): MaybePromise<unknown> {
		for (let i = start; i < this.#members.length; i++) {
			const member = this.#members[i]
			const input = this.#cloneForMember(value)
			const result =
				encode && member.typebox
					? (member.validator as any).EncodeFrom(input, type)
					: member.validator.From!(input, type, allowAsync)

			if (typeof (result as any)?.then === 'function') {
				if (!allowAsync) throw asyncStandardSchemaError()

				// eslint-disable-next-line sonarjs/function-inside-loop
				return Promise.resolve(result).then((resolved) =>
					this.#fromLoop(
						value,
						i + 1,
						ValidationPlanMultiValidator.#merge(
							snapshot,
							this.#project(resolved, member.projection)
						),
						type,
						encode,
						allowAsync
					)
				)
			}

			snapshot = ValidationPlanMultiValidator.#merge(
				snapshot,
				this.#project(result, member.projection)
			)
		}

		return snapshot
	}
}
