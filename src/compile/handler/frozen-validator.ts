// ! This module must be typebox free
import { ValidationError } from '../../error'
import { nullObject } from '../../utils'
import { ELYSIA_TYPES } from '../../type/constants'

import {
	Compiled,
	EMPTY_EXTERNALS,
	collectMirrorUnions,
	collectStringCodecNodes,
	instantiateFrozenBoth,
	instantiateFrozenDecodeMirror,
	reconstructInnerCodecs,
	type CapturedValidator,
	type FrozenValidator,
	type ValidatorSlot
} from '../aot'

import type { AnyLocalHook, HTTPMethod } from '../../types'
import type { AnyElysia } from '../../base'

export const isBridgeNotInitialized = (error: unknown): boolean =>
	error instanceof Error &&
	error.message.startsWith("Typebox module isn't initialized")

function codecCoercionBridgeFree(
	f: FrozenValidator,
	coerced: unknown,
	raw: unknown
) {
	return (
		f.k === 1 &&
		!!f.dm && // the baked decode transformation
		!f.em &&
		!f.ce &&
		f.a !== 1 &&
		!(f.d === 1 && f.ps !== 1) &&
		innerCodecsAligned(f.ic?.length, coerced) &&
		mirrorUnionsAligned(f.u, raw) &&
		mirrorUnionsAligned(f.dm.u, coerced)
	)
}

const innerCodecsAligned = (icLength: number | undefined, coerced: unknown) =>
	collectStringCodecNodes(coerced).length === (icLength ?? 0)

function mirrorUnionsAligned(
	// `u` may be the runtime factory table (`FrozenCheckFactory[][]`) or the
	// captured source table (`{identifier, code}[][]`), only the dims matter
	u: readonly (readonly unknown[])[] | undefined,
	schema: unknown
) {
	if (!u) return true

	const branches = collectMirrorUnions(schema)
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

	if (codecCoercionBridgeFree(f, schema, raw)) return true

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

function isCleanSafeNode(
	node: any,
	visiting: WeakSet<object>,
	clean: WeakSet<object>
): boolean {
	if (!node || typeof node !== 'object') return true
	if (clean.has(node)) return true
	if (visiting.has(node)) return false

	visiting.add(node)

	const safe = checkCleanSafeNode(node, visiting, clean)

	visiting.delete(node)
	if (safe) clean.add(node)

	return safe
}

function checkCleanSafeNode(
	node: any,
	visiting: WeakSet<object>,
	clean: WeakSet<object>
): boolean {
	if (node['~codec'] || node['~refine'] || node['~elyTyp'] !== undefined)
		return false

	const kind = node['~kind']
	if (
		kind === 'Union' ||
		kind === 'Intersect' ||
		kind === 'Ref' ||
		kind === 'This' ||
		kind === 'Cyclic' ||
		node.$ref !== undefined ||
		Array.isArray(node.anyOf) ||
		Array.isArray(node.allOf) ||
		Array.isArray(node.oneOf) ||
		node.not !== undefined ||
		node.if !== undefined ||
		node.patternProperties !== undefined
	)
		return false

	const isObject = kind === 'Object' || node.type === 'object'
	if (isObject) {
		if (node.additionalProperties !== false) return false

		if (node.properties)
			for (const k in node.properties)
				if (
					Object.hasOwn(node.properties, k) &&
					!isCleanSafeNode(node.properties[k], visiting, clean)
				)
					return false

		return true
	}

	if (kind === 'Array' || node.type === 'array') {
		const items = node.items
		if (Array.isArray(items) || items === undefined) return false
		return isCleanSafeNode(items, visiting, clean)
	}

	return true
}

function isFullyClosedObject(schema: any): boolean {
	if (!schema || typeof schema !== 'object') return false
	const kind = schema['~kind']
	if (kind !== 'Object' && schema.type !== 'object') return false
	return isCleanSafeNode(schema, new WeakSet(), new WeakSet())
}

class FrozenSlotValidator {
	isAsync = false
	// WS message/upgrade validation branches on `hasCodec` to pick `From`
	// over bare `Check` (ws/route.ts `validateMessageBody`)
	hasCodec = false

	#check: (value: unknown) => boolean
	#clean?: (value: unknown) => unknown
	#decode?: (value: unknown) => unknown
	schema: unknown

	#hasDefault: boolean
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

		if (frozen.ic) reconstructInnerCodecs(frozen.ic, schema)

		this.hasCodec = frozen.k === 1

		if (frozen.k === 1 && frozen.dm) {
			const both = instantiateFrozenBoth(frozen, schema, raw)
			this.#check = both.check!
			this.#clean = normalize === false ? undefined : both.clean
			this.#decode =
				normalize === false
					? undefined
					: instantiateFrozenDecodeMirror(frozen.dm, schema)
		} else {
			// non-codec covered slot: `e`/`u` are refused, so no externals/unions
			const both = frozen.cm!(EMPTY_EXTERNALS, undefined)
			this.#check = both.check!
			this.#clean = normalize === false ? undefined : both.clean
		}

		this.#hasOptional = !!(schema as any)?.['~optional']
		this.#noValidate =
			(schema as any)?.['~elyTyp'] === ELYSIA_TYPES.NoValidate

		this.#hasDefault = frozen.d === 1
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

	Errors(): unknown[] {
		return []
	}

	#error(value: unknown, type?: string): ValidationError {
		return new ValidationError(
			type,
			value,
			() => this.Errors(),
			this.schema
		)
	}

	#cloneSharedDefault() {
		const defaults = this.#defaultFastPath!
		const value = defaults.value
		if (value === null || typeof value !== 'object') return value

		return defaults.clone ? defaults.clone() : structuredClone(value)
	}

	#applyDefault(value: any) {
		return this.#defaultFastPath!.merge!(value)
	}

	#optionalBypass(value: unknown): { value: unknown } | undefined {
		const schema = this.schema as any

		if (value === undefined || value === null)
			return {
				value: schema['~kind'] === 'Object' ? nullObject() : value
			}

		if (
			schema['~kind'] === 'Object' &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			Object.keys(value as object).length === 0
		)
			return { value: nullObject() }
	}

	From(value: unknown, type?: string): unknown {
		if (this.#hasDefault) {
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
					value = this.#applyDefault(value)
			}
		}

		if (this.#hasOptional) {
			const bypass = this.#optionalBypass(value)
			if (bypass) return bypass.value
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

const REQUEST_SLOTS = ['body', 'headers', 'query', 'params', 'cookie'] as const

function resolveModelRef(schema: unknown, root: AnyElysia): unknown {
	if (typeof schema !== 'string') return schema

	const models = root['~ext']?.models as Record<string, unknown> | undefined
	if (models && schema in models) return models[schema]

	return undefined
}

export function buildFrozenRouteValidator(
	hook: AnyLocalHook,
	root: AnyElysia,
	method: HTTPMethod,
	path: string
): FrozenRouteValidatorShape | undefined {
	if (root['~config']?.normalize === 'typebox') return undefined
	if (hook?.schemas) return undefined

	const normalize = root['~config']?.normalize
	const out: FrozenRouteValidatorShape = {}

	for (const slot of REQUEST_SLOTS) {
		const raw = hook?.[slot]
		if (!raw) continue

		const schema = resolveModelRef(raw, root)
		if (!schema) return undefined

		const frozen = Compiled.getValidator(method, path, slot)
		if (!frozen) return undefined

		let coerced = schema
		if (frozen.cp) {
			const rebuild = Compiled.planRebuilder
			if (!rebuild) return undefined
			coerced = rebuild(schema, frozen.cp)
		}

		if (!isBridgeFreeComplete(frozen, coerced, schema)) return undefined

		out[slot] = new FrozenSlotValidator(frozen, coerced, schema, normalize)
	}

	const response = hook?.response
	if (response) {
		const statuses = isResponseMap(response) ? response : { 200: response }

		const responseOut: Record<number, FrozenSlotValidator> = {}

		for (const status in statuses) {
			const raw = (statuses as Record<string, unknown>)[status]
			if (!raw) continue

			const schema = resolveModelRef(raw, root)
			if (!schema) return undefined

			const frozen = Compiled.getValidator(
				method,
				path,
				`response:${status}` as ValidatorSlot
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

const isResponseMap = (schema: any): boolean =>
	!('~kind' in schema || '~elyAcl' in schema || '~standard' in schema)

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
	 * @see plugin/source.ts `entryParts`
	 */
	if (!(c.checkValue && c.mirror)) return false

	if (
		c.hasCodec &&
		!!c.decodeMirror &&
		!c.encodeMirror &&
		!c.customErrors?.length &&
		!c.async &&
		!(c.hasDefault && !c.precomputeSafe)
	) {
		return (
			innerCodecsAligned(c.innerCodecs?.length, coerced) &&
			mirrorUnionsAligned(c.mirror.u, schema) &&
			mirrorUnionsAligned(c.decodeMirror.u, coerced)
		)
	}

	if (
		c.external || // e
		c.mirror.u || // u
		c.decodeMirror || // dm
		c.encodeMirror || // em
		c.hasCodec || // k
		c.customErrors?.length || // ce
		c.innerCodecs?.length || // ic
		c.async // a
	)
		return false

	if (c.hasDefault && !c.precomputeSafe) return false
	if (isFullyClosedObject(schema)) return false

	return true
}
