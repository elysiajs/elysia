// This module must stay TypeBox-free
//
// COVERAGE — what actually reconstructs bridge-free (precise, because it decides
// where a future `setupTypebox`-stub can safely apply):
//   COVERED (non-codec): a slot whose compiled `cm` check needs NO codec — a
//     plain `t.Object`/`t.Array` with non-codec leaves (`t.String`, `t.Number`,
//     `t.Boolean`, nested plain objects/arrays), plus preallocated defaults
//     (`ps`), root `~optional` bypass, and `t.NoValidate`. In a BODY slot a
//     `t.Number()` leaf arrives as a real number (JSON), so no coercion codec is
//     attached and the object rides the covered `cm` path.
//   COVERED (slot coercion): a query/headers/params/cookie object whose leaves
//     are the standard SCALAR coercion codecs the user wrote EXPLICITLY —
//     `t.Numeric()`, `t.IntegerString()`, `t.BooleanString()`, `t.Date()`, and
//     `t.Optional(...)` of those, plus plain scalars alongside them. These carry
//     `k` (hasCodec) + `dm` (baked decode mirror) + `u` (the Number|Codec-String
//     union each coercion leaf expands to) + `e` (the Refine predicate closures),
//     ALL reconstructable from the raw schema by the TypeBox-free `aot.ts`
//     helpers (`instantiateFrozenBoth` for check+clean unions, `collectExternals`
//     for the Refine closures, `instantiateFrozenDecodeMirror` for the string→
//     typed decode + Clean). The decode leaves (`+value`, `new Date(value)`, …)
//     and Refine predicates are pure closures already frozen into the schema, so
//     nothing here touches TypeBox. This is gated on the raw schema BEING the
//     coerced schema (no `cp`); see `codecCoercionBridgeFree`.
//   REFUSED (bail to the wired path):
//       (1) any codec slot carrying a coerce PLAN (`cp`): the user wrote a plain
//           `t.Number()`/`t.Boolean()` in a query and `coerceQuery` rewrote it to
//           `Numeric`/`BooleanString`. Reconstructing the coerced schema needs
//           `buildCoercedFromPlan` from `type/coerce.ts`, which statically pulls
//           `typebox/type` + `typebox/value` (measured: 654 typebox inputs) —
//           importing it would defeat the sealed bundle. So a codec slot is only
//           bridge-free when the raw schema already IS the coerced schema.
//       (2) inner string codecs (`ic`): `t.ObjectString`/`t.ArrayString` (incl.
//           `t.Array(t.Numeric())` at a query slot, which becomes `ArrayString`).
//     Also refused: encode mirrors (`em`, response codec), custom errors (`ce`),
//     async refinement (`a`), non-preallocated defaults, and fully-closed objects
//     (Clean-skip parity).
import { ValidationError } from '../../error'
import { nullObject } from '../../utils'
import { ELYSIA_TYPES } from '../../type/constants'

import {
	Compiled,
	EMPTY_EXTERNALS,
	instantiateFrozenBoth,
	instantiateFrozenDecodeMirror,
	type CapturedValidator,
	type FrozenValidator,
	type ValidatorSlot
} from '../aot'

import type { AnyLocalHook, HTTPMethod } from '../../types'
import type { AnyElysia } from '../../base'

export const isBridgeNotInitialized = (error: unknown): boolean =>
	error instanceof Error &&
	error.message.startsWith("Typebox module isn't initialized")

/**
 * A codec (`k`) slot is bridge-free ONLY when it is a slot-level SCALAR coercion
 * schema whose coerced form equals the raw hook schema — i.e. the user wrote the
 * coercion type explicitly (`t.Numeric()`/`t.IntegerString()`/`t.BooleanString()`
 * /`t.Date()`, optionally `t.Optional(...)`), so no coerce PLAN (`cp`) was baked.
 *
 * The reconstruction consumes only TypeBox-free `aot.ts` helpers off the raw
 * schema: `instantiateFrozenBoth` (check + Clean, wiring `e`/`u` from the schema),
 * `instantiateFrozenDecodeMirror` (the string→typed decode + Clean, `dm`). The
 * decode leaves and Refine predicates are pure closures already frozen into the
 * schema, so nothing here touches TypeBox.
 *
 * Refuses the cases the frozen `From` cannot serve bridge-free:
 *  - `cp`: needs `buildCoercedFromPlan` (drags TypeBox) to rebuild the schema.
 *  - `ic`: `t.ObjectString`/`t.ArrayString` inner codecs (JSON-in-string).
 *  - `em`: response-side encode mirror (request codec slots don't set it, but
 *    refuse defensively — the frozen `From` only wires the decode direction).
 *  - `ce`/`a`: custom errors / async refinement — the non-codec path refuses
 *    these too.
 *  - defaults not preallocated (`d` && !`ps`): would call the severed `Default`.
 */
function codecCoercionBridgeFree(f: FrozenValidator): boolean {
	return (
		f.k === 1 &&
		!!f.dm && // the baked decode transformation
		!f.cp && // raw schema must already BE the coerced schema
		!f.ic &&
		!f.em &&
		!f.ce &&
		f.a !== 1 &&
		!(f.d === 1 && f.ps !== 1)
	)
}

function isBridgeFreeComplete(f: FrozenValidator, schema: unknown) {
	if (!f.cm) return false

	// Slot-level scalar coercion (query/headers/params/cookie explicit codec
	// leaves): reconstructable from the raw schema without TypeBox.
	if (codecCoercionBridgeFree(f)) return true

	if (
		f.e === 1 || // needs `collectExternals(coercedSchema)`
		f.u || // needs `buildUnions(coercedSchema)`
		f.dm || // request codec mirror needs the schema
		f.em || // response codec mirror needs the schema
		f.k === 1 || // codec decode/encode is not baked here
		f.ce || // custom-error rebuild falls back to live TypeBox `Compile`
		f.ic || // inner string codecs drag TypeBox at import
		f.a === 1 // async refinement (file-type) — keep on the wired path
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

// `visiting` = nodes on the current recursion stack (a revisit is a genuine
// structural cycle → not clean-safe). `clean` = nodes already fully validated
// (a revisit is a benign DAG share, e.g. two properties reusing the same cached
// `t.String()` singleton → clean-safe). Conflating the two (a single `seen`
// set) wrongly rejected shared leaves as cycles, which let a closed object with
// repeated leaf schemas slip past `isFullyClosedObject` and build bridge-free
// while the wired path (whose schema is deep-cloned, so leaves are distinct)
// skipped Clean via `#cleanRedundant` — a key-order divergence.
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

	#check: (value: unknown) => boolean
	#clean?: (value: unknown) => unknown
	// slot-level scalar coercion: string→typed decode (+ Clean), reconstructed
	// from the raw schema's frozen codec/union closures. When present it REPLACES
	// `#clean` in `From` (the decode mirror already cleans), exactly like the
	// wired `FromSync` skips `Clean` when `#decodeMirror` exists.
	#decode?: (value: unknown) => unknown
	schema: unknown

	// preallocated default fast path (baked `ps`/`pd`/`pod`/`dc`/`pm`)
	#hasDefault: boolean
	#defaultFastPath?: DefaultFastPath

	// root `~optional` schemas short-circuit before Check (parity with
	// `TypeBoxValidator.optionalBypass`).
	#hasOptional: boolean

	// `t.NoValidate(...)` slots skip Check entirely (parity with
	// `TypeBoxValidator.#noValidate`): the wired `FromSync`/`EncodeFrom` gate
	// every `Check` behind `!this.#noValidate` but still apply defaults,
	// optionalBypass, and Clean. Within the bridge-free covered subset (no
	// codec/union/custom-error/etc.) `#noValidate` gates NOTHING ELSE, so
	// skipping the `#check` call reproduces the wired semantics exactly.
	#noValidate: boolean

	constructor(
		frozen: FrozenValidator,
		schema: unknown,
		normalize: boolean | 'exactMirror' | 'typebox' | undefined
	) {
		this.schema = schema

		// A codec-coercion slot needs its check/Clean wired with the schema's
		// externals (`e`, the Refine predicate closures) and unions (`u`, the
		// Number|Codec-String branches each coercion leaf expands to), plus the
		// decode mirror (`dm`) that turns strings into typed values. All rebuilt
		// off the raw schema by TypeBox-free `aot.ts` helpers.
		//
		// `codecCoercionBridgeFree` gated this slot in — so `frozen.dm` is set and
		// the raw schema IS the coerced schema (no `cp`).
		if (frozen.k === 1 && frozen.dm) {
			const both = instantiateFrozenBoth(frozen, schema, schema)
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

		// Codec-coercion slot: the decode mirror does string→typed + Clean in one
		// pass (parity with wired `FromSync`, which skips `Clean` when
		// `#decodeMirror` is set). `#decode` is only built when `normalize !== false`.
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

/**
 * Resolve a slot schema to the concrete TypeBox schema the wired path validates.
 *
 * A slot can be a STRING model reference (`.post(path, { body: 'myModel' })`);
 * the wired path resolves it via `Validator.reference(schema, models)` before
 * building anything, so its closed-object / coverage checks and Clean see the
 * resolved object. The bridge-free path receives the RAW hook schema (the bare
 * string), so it must resolve the same way BEFORE any check — otherwise a closed
 * model ref (`type` is a string, not an object) dodges `isFullyClosedObject` and
 * builds bridge-free, diverging from the wired `#cleanRedundant` Clean-skip.
 *
 * Mirrors `Validator.reference` semantics without importing it (that module
 * statically pulls the TypeBox bridge this module must stay free of): non-string
 * passes through; a string that names a registered model resolves; a string that
 * names nothing returns `undefined` so the caller bails and the wired path
 * surfaces the "not found" error loudly instead of silently diverging.
 */
function resolveModelRef(schema: unknown, root: AnyElysia): unknown {
	if (typeof schema !== 'string') return schema

	const models = root['~ext']?.models as Record<string, unknown> | undefined
	if (models && schema in models) return models[schema]

	return undefined
}

/**
 * Attempt to build an entire route validator bridge-free.
 *
 * Returns `undefined` (caller falls back to the wired `RouteValidator`) unless
 * EVERY declared slot — request and response — is bridge-free-complete. All or
 * nothing per route: a partial mix would still drag the bridge for one slot,
 * defeating the point, and the handler factory expects one uniform validator.
 */
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
		if (!frozen || !isBridgeFreeComplete(frozen, schema)) return undefined

		out[slot] = new FrozenSlotValidator(frozen, schema, normalize)
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
			if (!frozen || !isBridgeFreeComplete(frozen, schema))
				return undefined

			responseOut[status as unknown as number] = new FrozenSlotValidator(
				frozen,
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

/**
 * Build-time twin of `isBridgeFreeComplete`, operating on the captured entry +
 * its schema. The build plugin can aggregate this across every slot to decide
 * whether a manifest is "fully bridge-free"
 */
export function isCapturedBridgeFree(c: CapturedValidator, schema: unknown) {
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
		!c.coercePlan &&
		!c.innerCodecs?.length &&
		!c.encodeMirror &&
		!c.customErrors?.length &&
		!c.async &&
		!(c.hasDefault && !c.precomputeSafe)
	)
		return true

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
