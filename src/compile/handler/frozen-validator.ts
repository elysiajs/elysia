// ! This module must be typebox free
import { isFullyClosedObject } from '../../type/validator/clean-safe'
import { StandardValidator } from '../../validator'
import { frozenRootOf } from '../../generation'
import { ValidationError } from '../../error'
import { nullObject } from '../../utils'
import { ELYSIA_TYPES } from '../../type/constants'

import {
	Compiled,
	EMPTY_EXTERNALS,
	reconstruct,
	type CapturedValidator,
	type FrozenValidator,
	type ValidatorSlot
} from '../aot'

import type { AnyLocalHook, HTTPMethod } from '../../types'
import type { AnyElysia } from '../../base'

export const isBridgeNotInitialized = (error: unknown) =>
	error instanceof Error &&
	error.message.startsWith("Typebox module isn't initialized")

function mirrorUnionsAligned(
	// `u` may be the runtime factory table (`FrozenCheckFactory[][]`) or the
	// captured source table (`{identifier, code}[][]`), only the dims matter
	u: readonly (readonly unknown[])[] | undefined,
	schema: unknown
) {
	if (!u) return true

	const branches = reconstruct().collectMirrorUnions(schema)
	if (branches.length !== u.length) return false

	for (let ui = 0; ui < u.length; ui++)
		if (branches[ui]!.length !== u[ui]!.length) return false

	return true
}

function isBridgeFreeComplete(
	f: FrozenValidator,
	schema: unknown,
	raw: unknown
) {
	if (!f.cm) return false

	if (
		f.k === 1 &&
		!!f.dm && // the baked decode transformation
		!f.em &&
		!f.ce &&
		f.a !== 1 &&
		!(f.d === 1 && f.ps !== 1) &&
		(f.ic?.length ?? 0) ===
			reconstruct().collectStringCodecNodes(schema).length &&
		mirrorUnionsAligned(f.u, raw) &&
		mirrorUnionsAligned(f.dm.u, schema)
	)
		return true

	if (
		f.e === 1 || // needs `collectExternals(coercedSchema)`
		f.u || // needs `buildUnions(coercedSchema)`
		f.dm || // request codec mirror needs the schema
		f.em || // response codec mirror needs the schema
		f.k === 1 || // codec decode/encode is not baked here
		f.ce || // custom-error rebuild falls back to live TypeBox `Compile`
		f.ic || // inner string codecs drag TypeBox at import
		f.a === 1 // async refinement (file-type)
	)
		return false

	// A default is fine only when it was preallocated (`ps`); otherwise `From`
	// would call the severed runtime `Default`.
	if (f.d === 1 && f.ps !== 1) return false

	if (isFullyClosedObject(schema)) return false

	return true
}

interface DefaultFastPath {
	value: unknown
	appliesToNull: boolean
	clone?: () => unknown
	merge?: (value: any) => any
}

interface CompactError {
	keyword: string
	schemaPath: string
	instancePath: string
	params: Record<string, unknown>
	message: string
}

const typeError = (
	schema: any,
	instancePath: string,
	schemaPath: string
): CompactError => ({
	keyword: 'type',
	schemaPath,
	instancePath,
	params: { type: schema.type },
	message: `must be ${schema.type}`
})

/**
 * Best-effort, TypeBox-free structural error walker for the bridge-free covered
 * subset (open objects / scalars / arrays / nesting = no unions, codecs,
 * or custom errors)
 **/
function walkCompactError(
	schema: any,
	value: unknown,
	instancePath: string,
	schemaPath: string
): CompactError | undefined {
	if (!schema || typeof schema !== 'object') return

	const elyTyp = schema['~elyTyp']
	if (
		schema.anyOf &&
		(elyTyp === ELYSIA_TYPES.ObjectString ||
			elyTyp === ELYSIA_TYPES.ArrayString)
	) {
		let decoded = value

		if (typeof value === 'string')
			try {
				decoded = JSON.parse(value)
			} catch {
				return
			}
		else if (value === undefined) return

		return walkCompactError(
			schema.anyOf[0],
			decoded,
			instancePath,
			`${schemaPath}/anyOf/0`
		)
	}

	const type = schema.type

	if (type === 'object') {
		if (typeof value !== 'object' || value === null || Array.isArray(value))
			return typeError(schema, instancePath, schemaPath)

		const required: string[] | undefined = schema.required
		if (Array.isArray(required)) {
			// every missing key lands in one error, like TypeBox reports it
			let missing: string[] | undefined

			for (const key of required)
				if (!(key in (value as object))) (missing ??= []).push(key)

			if (missing)
				return {
					keyword: 'required',
					schemaPath,
					instancePath,
					params: { requiredProperties: missing },
					message: `must have required properties ${missing.join(', ')}`
				}
		}

		const properties = schema.properties
		if (properties)
			for (const key in properties) {
				if (!(key in (value as object))) continue
				const child = walkCompactError(
					properties[key],
					(value as any)[key],
					`${instancePath}/${key}`,
					`${schemaPath}/properties/${key}`
				)
				if (child) return child
			}

		return
	}

	if (type === 'array') {
		if (!Array.isArray(value))
			return typeError(schema, instancePath, schemaPath)

		const items = schema.items
		if (items)
			for (let i = 0; i < value.length; i++) {
				const child = walkCompactError(
					items,
					value[i],
					`${instancePath}/${i}`,
					`${schemaPath}/items`
				)
				if (child) return child
			}

		return
	}

	const matches =
		type === 'string' || type === 'number' || type === 'boolean'
			? typeof value === type
			: type === 'integer'
				? Number.isInteger(value)
				: type !== 'null' || value === null

	if (!matches) return typeError(schema, instancePath, schemaPath)
}

export function isCompactWalkable(schema: any, lookThrough = true): boolean {
	if (!schema || typeof schema !== 'object') return false

	const elyTyp = schema['~elyTyp']
	if (
		lookThrough &&
		schema.anyOf &&
		(elyTyp === ELYSIA_TYPES.ObjectString ||
			elyTyp === ELYSIA_TYPES.ArrayString)
	)
		return isCompactWalkable(schema.anyOf[0])

	if (schema.anyOf || schema.oneOf || schema.allOf) return false

	const type = schema.type

	if (type === 'object') {
		const properties = schema.properties
		if (properties)
			for (const key in properties)
				if (!isCompactWalkable(properties[key], lookThrough))
					return false

		return true
	}

	if (type === 'array') return isCompactWalkable(schema.items, lookThrough)

	return (
		type === 'string' ||
		type === 'number' ||
		type === 'integer' ||
		type === 'boolean' ||
		type === 'null'
	)
}

class FrozenSlotValidator {
	isAsync = false
	hasCodec = false

	#check: (value: unknown) => boolean
	#clean?: (value: unknown) => unknown
	#decode?: (value: unknown) => unknown
	schema: unknown

	#defaultFastPath?: DefaultFastPath

	#hasOptional: boolean
	#noValidate: boolean

	constructor(
		frozen: FrozenValidator,
		// coerced slot schema from `buildFrozenRouteValidator`
		schema: unknown,
		raw: unknown,
		normalize: boolean | 'exactMirror' | 'typebox' | undefined
	) {
		this.schema = schema
		this.hasCodec = frozen.k === 1

		if (frozen.ic) reconstruct().reconstructInnerCodecs(frozen.ic, schema)

		if (frozen.k === 1 && frozen.dm) {
			const both = reconstruct().instantiateFrozenBoth(
				frozen,
				schema,
				raw
			)
			this.#check = both.check!
			if (normalize !== false) {
				this.#clean = both.clean
				this.#decode = reconstruct().instantiateFrozenDecodeMirror(
					frozen.dm,
					schema
				)
			}
		} else {
			// non-codec covered slot: `e`/`u` are refused, so no externals/unions
			const both = frozen.cm!(EMPTY_EXTERNALS, undefined)
			this.#check = both.check!
			if (normalize !== false) this.#clean = both.clean
		}

		this.#hasOptional = !!(schema as any)?.['~optional']
		this.#noValidate =
			(schema as any)?.['~elyTyp'] === ELYSIA_TYPES.NoValidate

		if (frozen.ps === 1)
			this.#defaultFastPath = {
				value: frozen.pd,
				appliesToNull: frozen.pn === 1,
				clone: frozen.dc,
				merge: frozen.pm
			}
	}

	Check(value: unknown): boolean {
		return this.#check(value)
	}

	Errors(value: unknown): unknown[] {
		const hit = walkCompactError(this.schema, value, '', '#')
		if (hit) return [hit]

		const schema = this.schema as any
		let error: CompactError | undefined

		if (
			schema?.type === 'object' &&
			typeof value === 'object' &&
			value !== null &&
			!Array.isArray(value) &&
			schema.properties
		)
			for (const key in schema.properties) {
				if (!(key in (value as object))) continue
				if (isCompactWalkable(schema.properties[key], false)) continue

				error = {
					keyword: 'type',
					schemaPath: `#/properties/${key}`,
					instancePath: `/${key}`,
					params: {},
					message: `must match ${schema.properties[key]?.['~kind'] ?? 'schema'}`
				}
				break
			}

		if (!error)
			error = {
				keyword: 'type',
				schemaPath: '#',
				instancePath: '',
				params: {},
				message: `must match ${schema?.['~kind'] ?? 'schema'}`
			}

		return [error]
	}

	#error(value: unknown, type?: string): ValidationError {
		return new ValidationError(
			type,
			value,
			() => this.Errors(value),
			this.schema
		)
	}

	#cloneSharedDefault() {
		const defaults = this.#defaultFastPath!
		const value = defaults.value
		if (value === null || typeof value !== 'object') return value

		return defaults.clone ? defaults.clone() : structuredClone(value)
	}

	From(value: unknown, type?: string): unknown {
		const defaults = this.#defaultFastPath
		if (defaults) {
			if (
				value === undefined ||
				(value === null && defaults.appliesToNull)
			)
				value = this.#cloneSharedDefault()
			else if (
				value !== null &&
				typeof value === 'object' &&
				defaults.merge !== undefined
			)
				value = defaults.merge(value)
		}

		if (this.#hasOptional) {
			const schema = this.schema as any

			if (value === undefined || value === null)
				return schema['~kind'] === 'Object' ? nullObject() : value

			if (
				schema['~kind'] === 'Object' &&
				typeof value === 'object' &&
				!Array.isArray(value) &&
				Object.keys(value as object).length === 0
			)
				return nullObject()
		}

		if (!this.#noValidate && !this.#check(value))
			throw this.#error(value, type)

		if (this.#decode) return this.#decode(value)

		return this.#clean ? this.#clean(value) : value
	}

	EncodeFrom(value: unknown, type?: string): unknown {
		if (!this.#noValidate && !this.#check(value))
			throw this.#error(value, type)
		return this.#clean ? this.#clean(value) : value
	}
}

interface FrozenRouteValidatorShape {
	body?: FrozenSlotValidator
	headers?: FrozenSlotValidator
	query?: FrozenSlotValidator
	params?: FrozenSlotValidator
	cookie?: FrozenSlotValidator
	response?: Record<number, FrozenSlotValidator>
}

export const REQUEST_SLOTS = [
	'body',
	'headers',
	'query',
	'params',
	'cookie'
] as const

export const isStandardSchema = (schema: unknown) =>
	schema != null && typeof schema === 'object' && '~standard' in schema

export function mergeSchemasAllStandard(
	schemas: Array<Record<string, unknown>> | undefined
) {
	if (!schemas || schemas.length === 0) return true

	for (const entry of schemas)
		for (const key in entry) {
			const value = entry[key]
			if (value && !isStandardSchema(value)) return false
		}

	return true
}

export function resolveModelRef(schema: unknown, root: AnyElysia): unknown {
	if (typeof schema !== 'string') return schema

	const models = frozenRootOf(root)['~ext']?.models as
		| Record<string, unknown>
		| undefined
	if (models && schema in models) return models[schema]

	return undefined
}

export function buildFrozenRouteValidator(
	hook: AnyLocalHook,
	root: AnyElysia,
	method: HTTPMethod,
	path: string
): FrozenRouteValidatorShape | undefined {
	const frozenRoot = frozenRootOf(root)
	if (frozenRoot['~config']?.normalize === 'typebox') return undefined
	if (hook?.schemas) return undefined

	const normalize = frozenRoot['~config']?.normalize
	const out: FrozenRouteValidatorShape = {}

	for (const slot of REQUEST_SLOTS) {
		const raw = hook?.[slot]
		if (!raw) continue

		const schema = resolveModelRef(raw, root)
		if (!schema) return undefined

		if (isStandardSchema(schema)) {
			out[slot] = new StandardValidator(schema as any) as any

			continue
		}

		const frozen = Compiled.getValidator(
			method,
			path,
			slot,
			root['~programId']
		)
		if (!frozen) return undefined

		let coerced = schema
		if (frozen.cp) {
			const rebuild = Compiled.getPlanRebuilder(root['~programId'])
			if (!rebuild) return undefined
			coerced = rebuild(schema, frozen.cp)
		}

		if (!isBridgeFreeComplete(frozen, coerced, schema)) return undefined

		out[slot] = new FrozenSlotValidator(frozen, coerced, schema, normalize)
	}

	const response = hook?.response
	if (response) {
		const resolved = resolveModelRef(response, root)
		if (!resolved) return undefined

		const statuses = isResponseMap(resolved) ? resolved : { 200: resolved }

		const responseOut: Record<number, FrozenSlotValidator> = {}

		for (const status in statuses) {
			const raw = (statuses as Record<string, unknown>)[status]
			if (!raw) continue

			const schema = resolveModelRef(raw, root)
			if (!schema) return undefined

			if (isStandardSchema(schema)) {
				responseOut[status as unknown as number] =
					new StandardValidator(schema as any) as any

				continue
			}

			const frozen = Compiled.getValidator(
				method,
				path,
				`response:${status}` as ValidatorSlot,
				root['~programId']
			)
			// response slots never capture `cp`: raw IS the coerced schema
			if (!frozen || !isBridgeFreeComplete(frozen, schema, schema))
				return undefined

			responseOut[status as unknown as number] = new FrozenSlotValidator(
				frozen,
				schema,
				schema,
				normalize
			)
		}

		out.response = responseOut
	}

	return out
}

export const isResponseMap = (
	schema: unknown
): schema is Record<string, unknown> =>
	schema !== null &&
	typeof schema === 'object' &&
	!('~kind' in schema || '~elyAcl' in schema || '~standard' in schema)

// truthy `cm` stand-in: the adapter below only feeds the acceptance gate,
// which reads `cm` for presence and never instantiates it
const capturedBothMarker = (() => ({})) as unknown as NonNullable<
	FrozenValidator['cm']
>

export function isCapturedBridgeFree(
	c: CapturedValidator,
	schema: unknown,
	coerced: unknown = schema
) {
	if (typeof schema === 'string') return false

	/**
	 * A captured `cm` entry is one that froze BOTH check and mirror
	 * `checkValue && mirror` at emit
	 *
	 * @see plugin/aot/source.ts `entryParts`
	 */
	if (!(c.checkValue && c.mirror)) return false

	return isBridgeFreeComplete(
		{
			cm: capturedBothMarker,
			e: c.external ? 1 : undefined,
			u: c.mirror.u as any,
			dm: c.decodeMirror as any,
			em: c.encodeMirror as any,
			k: c.hasCodec ? 1 : undefined,
			ce: c.customErrors?.length ? (c.customErrors as any) : undefined,
			ic: c.innerCodecs?.length ? (c.innerCodecs as any) : undefined,
			a: c.async ? 1 : undefined,
			d: c.hasDefault ? 1 : undefined,
			ps: c.precomputeSafe ? 1 : undefined
		},
		coerced,
		schema
	)
}
