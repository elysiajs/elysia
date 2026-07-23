import {
	isFrameworkQueryPlan,
	snapshotQueryPlan,
	type QueryPlan
} from '../parse-query'
import {
	VALIDATOR_SEMANTIC_MEMBERS,
	readValidatorSemanticSource,
	type ValidatorSemanticMemberSource
} from '../validator/semantic-channel'
import type { ValidationPlan } from '../validator/validation-plan'
import type { CapturedMirror, CapturedValidator, ValidatorSlot } from './aot'
import {
	canonicalPlanValue,
	type CanonicalValue,
	type ExternalBindingRole,
	type ValidatorSlotInput
} from './app-plan'

export const VALIDATOR_SEMANTICS_VERSION = 1 as const
export const QUERY_PLAN_VERSION = 1 as const
export type ValidatorSettlement = 'sync' | 'maybe'

export interface TypeBoxExecutionPolicy {
	readonly normalize: 'none' | 'exact' | 'typebox'
	readonly sanitize: boolean
	readonly direction: 'request' | 'response'
	readonly domain:
		| 'body'
		| 'headers'
		| 'params'
		| 'query'
		| 'cookie'
		| 'response'
	readonly settlement: ValidatorSettlement
	readonly clean: 'none' | 'captured' | 'runtime'
	readonly optional: 'none' | 'value' | 'object'
	readonly form: boolean
	readonly noValidate: boolean
	readonly diagnostics: 'compact' | 'locator'
}

export interface ComposedValidatorMemberInput {
	readonly semantics: CanonicalValue
	/** Effective post-member projection; null means identity. */
	readonly projection: CanonicalValue | null
}

export interface ValidatorExecutorBinding {
	readonly validator: object
	readonly queryPlan?: QueryPlan
}

export interface RuntimeTypeBoxSemanticTraits {
	readonly hasCodec: boolean
	readonly hasDefault: boolean
	readonly hasRef: boolean
	readonly codecDirection: 'none' | 'decode' | 'encode'
	readonly sanitize?: unknown
}

const mirror = (value: CapturedMirror | undefined) =>
	value && {
		source: value.source,
		externals: value.hasExternals,
		unions: value.u?.map((group) =>
			group.map(({ identifier, code }) => ({ identifier, code }))
		)
	}

/** Project the existing emitted recipe, never the schema that produced it. */
export function capturedValidatorSemantics(
	captured: CapturedValidator,
	policy: TypeBoxExecutionPolicy
): CanonicalValue {
	assertTypeBoxPolicy(policy)
	if (
		typeof captured.identifier !== 'string' ||
		typeof captured.checkDefs !== 'string' ||
		typeof captured.checkValue !== 'string'
	)
		throw new Error('incomplete captured validator semantics')
	if (policy.clean === 'captured' && captured.mirror === undefined)
		throw new Error('captured validator is missing its cleaner')
	if (captured.async && policy.settlement !== 'maybe')
		throw new Error('async captured validator must use maybe settlement')

	return canonicalPlanValue(
		withoutUndefined({
			kind: 'typebox',
			policy,
			image: {
				check: {
					identifier: captured.identifier,
					definitions: captured.checkDefs,
					value: captured.checkValue,
					externals: !!captured.external
				},
				async: !!captured.async,
				hasDefault: !!captured.hasDefault,
				hasCodec: !!captured.hasCodec,
				hasRef: !!captured.hasRef,
				mirror: mirror(captured.mirror),
				decodeMirror: mirror(captured.decodeMirror),
				encodeMirror: mirror(captured.encodeMirror),
				precomputed:
					captured.precomputeSafe === true
						? {
								value: semanticValue(
									captured.precomputedDefault
								),
								null: !!captured.precomputeNull,
								object:
									captured.precomputedObjectDefault ===
									undefined
										? undefined
										: semanticValue(
												captured.precomputedObjectDefault
											),
								cloner: captured.defaultCloner,
								merger: captured.objectDefaultMerger
							}
						: undefined,
				customErrors: captured.customErrors?.map((entry) => ({
					path: entry.path,
					identifier: entry.identifier,
					definitions: entry.checkDefs,
					value: entry.checkValue,
					externals: entry.external
				})),
				innerCodecs: captured.innerCodecs?.map((entry) => ({
					open: entry.open,
					identifier: entry.identifier,
					definitions: entry.checkDefs,
					value: entry.checkValue,
					externals: entry.external,
					decode: mirror(entry.decode)
				})),
				coercePlan: captured.coercePlan
			}
		}),
		'validator semantics'
	)
}

/** Project the existing validation-plan IR without retaining its Sets/RegExps. */
export function validationPlanSemantics(
	plan: ValidationPlan,
	policy: TypeBoxExecutionPolicy
): CanonicalValue {
	assertTypeBoxPolicy(policy)
	return canonicalPlanValue(
		{
			kind: 'validation-plan',
			policy,
			image: {
				encode: !!plan.encode,
				coerced: plan.coerced,
				hasDefault: plan.hasDefault,
				root: validationNode(plan.root)
			}
		},
		'validator semantics'
	)
}

/**
 * Snapshot the already-effective schema while the validator program is being
 * constructed. Functions remain external by position; the schema itself is
 * never retained.
 */
export function runtimeTypeBoxValidatorSemantics(
	schema: unknown,
	policy: TypeBoxExecutionPolicy,
	traits: RuntimeTypeBoxSemanticTraits
): CanonicalValue {
	assertTypeBoxPolicy(policy)
	return canonicalPlanValue(
		{
			kind: 'typebox',
			policy,
			image: {
				format: 'effective-schema-json-v1',
				hasCodec: traits.hasCodec,
				hasDefault: traits.hasDefault,
				hasRef: traits.hasRef,
				codecDirection: traits.codecDirection,
				sanitize: JSON.stringify(semanticGraph(traits.sanitize)),
				graph: JSON.stringify(semanticGraph(schema))
			}
		},
		'validator semantics'
	)
}

/** Read Standard Schema metadata and its callback once during the seal. */
export function captureStandardValidatorSemantics(schema: unknown): {
	readonly semantics: CanonicalValue
	readonly validate: Function
} {
	const standard = (schema as any)?.['~standard']
	if (!standard || typeof standard !== 'object')
		throw new Error('invalid Standard Schema validator semantics')
	const { version, vendor, validate } = standard
	if (
		version !== 1 ||
		typeof vendor !== 'string' ||
		!vendor ||
		typeof validate !== 'function'
	)
		throw new Error('invalid Standard Schema validator semantics')

	return Object.freeze({
		semantics: canonicalPlanValue(
			{
				kind: 'standard',
				standardVersion: 1,
				vendor,
				settlement: 'maybe'
			},
			'validator semantics'
		),
		validate
	})
}

/** Preserve legacy construction for malformed Standard-like objects. */
export function runtimeStandardValidatorSemantics(standard: unknown) {
	const version = (standard as any)?.version
	const vendor = (standard as any)?.vendor

	return canonicalPlanValue(
		{
			kind: 'standard',
			standardVersion: version === 1 ? version : semanticValue(version),
			vendor: typeof vendor === 'string' ? vendor : semanticValue(vendor),
			settlement: 'maybe'
		},
		'validator semantics'
	)
}

export function composedValidatorSemantics(
	merge: 'legacy' | 'validation-plan',
	members: readonly ComposedValidatorMemberInput[]
): CanonicalValue {
	if (!members.length) throw new Error('missing composed validator semantics')
	for (const member of members) assertValidatorSemantics(member.semantics)

	return canonicalPlanValue(
		{
			kind: 'multi',
			merge,
			mergeVersion: 1,
			settlement: members.some(
				({ semantics }) => validatorSettlement(semantics) === 'maybe'
			)
				? 'maybe'
				: 'sync',
			members: members.map(({ semantics, projection }) => ({
				semantics,
				projection
			}))
		},
		'validator semantics'
	)
}

export function validatorSemanticMembers(
	executor: object
): readonly ValidatorSemanticMemberSource[] {
	const read = (executor as any)[VALIDATOR_SEMANTIC_MEMBERS]
	if (typeof read !== 'function')
		throw new Error('validator executor is not a composition')
	return Object.freeze(
		(read.call(executor) as ValidatorSemanticMemberSource[]).map((member) =>
			Object.freeze({ ...member })
		)
	)
}

/** Authoritative construction-time semantics for a detached live executor. */
export function validatorSemantics(executor: object): CanonicalValue {
	const semantics = readValidatorSemanticSource(executor)
	if (!semantics) throw new Error('validator semantics were not captured')
	assertValidatorSemantics(semantics)
	return semantics
}

export function validatorSemanticsWithDiagnostics(
	semantics: CanonicalValue,
	diagnostics: TypeBoxExecutionPolicy['diagnostics']
): CanonicalValue {
	assertValidatorSemantics(semantics)
	if ((semantics as any).kind === 'standard') return semantics
	if ((semantics as any).kind === 'multi')
		throw new Error(
			'composed validator diagnostics must follow its members'
		)

	return canonicalPlanValue(
		{
			...(semantics as any),
			policy: { ...(semantics as any).policy, diagnostics }
		},
		'validator semantics'
	)
}

export function compositionProjectionSemantics(
	value: any
): CanonicalValue | null {
	if (!value) return null
	return canonicalPlanValue(
		{
			remove: value.remove ? [...value.remove].sort() : [],
			children: value.children
				? [...value.children]
						.sort(([left], [right]) =>
							left < right ? -1 : left > right ? 1 : 0
						)
						.map(([key, child]) => [
							key,
							compositionProjectionSemantics(child)
						])
				: []
		},
		'validator composition projection'
	)
}

export function queryPlanSemantics(plan: QueryPlan): CanonicalValue {
	if (!isFrameworkQueryPlan(plan))
		throw new Error('query plan is not planner-owned')
	if (!plan.fused)
		return canonicalPlanValue(
			{
				version: QUERY_PLAN_VERSION,
				kind: 'generic',
				array: Object.keys(plan.array ?? {}).sort(),
				object: Object.keys(plan.object ?? {}).sort()
			},
			'query plan semantics'
		)

	const root = plan.scalarRoot
	if (!root || !Array.isArray(root.keys) || !Array.isArray(root.properties))
		throw new Error('invalid fused query plan semantics')

	return canonicalPlanValue(
		{
			version: QUERY_PLAN_VERSION,
			kind: 'scalar',
			additional: root.additional,
			required: [...root.required].sort(),
			fields: root.keys.map((key: string, index: number) => {
				const node = root.properties[index]
				return withoutUndefined({
					key,
					kind: node.kind === 4 && node.integer ? 6 : node.kind,
					hasDefault: !!node.hasDefault,
					default: node.hasDefault
						? semanticValue(node.defaultValue)
						: undefined
				})
			})
		},
		'query plan semantics'
	)
}

export function createValidatorSlotInput(
	slot: ValidatorSlot,
	semantics: CanonicalValue,
	executor: ValidatorExecutorBinding
): ValidatorSlotInput {
	assertValidatorSemantics(semantics)
	assertSlotSemantics(slot, semantics)
	if (!executor?.validator || typeof executor.validator !== 'object')
		throw new Error(`missing validator executor for ${slot}`)
	if (
		'schema' in executor.validator &&
		(executor.validator as { schema?: unknown }).schema !== undefined
	)
		throw new Error(`validator executor for ${slot} is not detached`)
	if (slot === 'query' && !executor.queryPlan)
		throw new Error('query validator requires a query plan')
	if (slot !== 'query' && executor.queryPlan)
		throw new Error(`query plan cannot bind to ${slot}`)

	const role = `${
		slot.startsWith('response:') ? 'response' : slot
	}Validator` as ExternalBindingRole
	const query = executor.queryPlan && queryPlanSemantics(executor.queryPlan)
	const queryPlan =
		executor.queryPlan && snapshotQueryPlan(executor.queryPlan)
	const binding = Object.freeze({
		validator: Object.freeze(executor.validator),
		queryPlan
	})

	return Object.freeze({
		slot,
		version: VALIDATOR_SEMANTICS_VERSION,
		content: canonicalPlanValue(
			withoutUndefined({
				semantics,
				query
			}),
			`${slot} validator semantics`
		),
		bindings: Object.freeze([{ role, value: binding }])
	})
}

export function validatorSettlement(
	semantics: CanonicalValue
): ValidatorSettlement {
	assertValidatorSemantics(semantics)
	return (semantics as any).kind === 'multi'
		? (semantics as any).settlement
		: (semantics as any).kind === 'standard'
			? 'maybe'
			: (semantics as any).policy.settlement
}

export function validatorArtifactSettlement(
	artifact: CanonicalValue
): ValidatorSettlement {
	if (
		!artifact ||
		typeof artifact !== 'object' ||
		Array.isArray(artifact) ||
		!(artifact as any).semantics
	)
		throw new Error('invalid validator artifact')
	return validatorSettlement((artifact as any).semantics)
}

function assertValidatorSemantics(value: CanonicalValue) {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('invalid validator semantics')
	const kind = String((value as any).kind)
	if (!['typebox', 'validation-plan', 'standard', 'multi'].includes(kind))
		throw new Error('invalid validator semantics')
}

function assertSlotSemantics(
	slot: ValidatorSlot,
	semantics: CanonicalValue,
	codecDirection: 'decode' | 'encode' = slot.startsWith('response:')
		? 'encode'
		: 'decode'
) {
	if ((semantics as any).kind === 'multi') {
		const childDirection =
			codecDirection === 'encode' && (semantics as any).merge === 'legacy'
				? 'decode'
				: codecDirection
		for (const member of (semantics as any).members)
			assertSlotSemantics(slot, member.semantics, childDirection)
		return
	}
	if ((semantics as any).kind === 'standard') return

	const response = slot.startsWith('response:')
	const policy = (semantics as any).policy
	if (
		policy.direction !== (response ? 'response' : 'request') ||
		policy.domain !== (response ? 'response' : slot)
	)
		throw new Error(`validator policy does not match ${slot}`)
	if (
		(semantics as any).kind === 'typebox' &&
		(semantics as any).image.hasCodec &&
		(semantics as any).image.codecDirection !== undefined &&
		(semantics as any).image.codecDirection !== codecDirection
	)
		throw new Error(`validator codec operation does not match ${slot}`)
}

function assertTypeBoxPolicy(policy: TypeBoxExecutionPolicy) {
	if (
		!['none', 'exact', 'typebox'].includes(policy.normalize) ||
		typeof policy.sanitize !== 'boolean' ||
		!['request', 'response'].includes(policy.direction) ||
		!['body', 'headers', 'params', 'query', 'cookie', 'response'].includes(
			policy.domain
		) ||
		!['sync', 'maybe'].includes(policy.settlement) ||
		!['none', 'captured', 'runtime'].includes(policy.clean) ||
		!['none', 'value', 'object'].includes(policy.optional) ||
		typeof policy.form !== 'boolean' ||
		typeof policy.noValidate !== 'boolean' ||
		!['compact', 'locator'].includes(policy.diagnostics)
	)
		throw new Error('invalid TypeBox validator policy')
}

function validationNode(node: any): unknown {
	const base: Record<string, unknown> = {
		pc: node.pc,
		kind: node.kind,
		optional: !!node.optional,
		hasDefault: !!node.hasDefault
	}
	if (node.hasDefault) base.default = semanticValue(node.defaultValue)

	switch (node.kind) {
		case 1:
			return withoutUndefined({
				...base,
				keys: node.keys,
				known: [...node.known].sort(),
				required: [...node.required].sort(),
				additional: node.additional,
				min: node.min,
				max: node.max,
				string: node.string,
				properties: node.properties.map(validationNode)
			})
		case 2:
			return withoutUndefined({
				...base,
				items: validationNode(node.items),
				min: node.min,
				max: node.max,
				string: node.string
			})
		case 3:
			return withoutUndefined({
				...base,
				min: node.min,
				max: node.max,
				pattern: node.pattern && {
					source: node.pattern.source,
					flags: node.pattern.flags
				}
			})
		case 4:
			return withoutUndefined({
				...base,
				integer: node.integer,
				coerce: node.coerce,
				explicit: node.explicit,
				minimum: node.minimum,
				maximum: node.maximum,
				exclusiveMinimum: node.exclusiveMinimum,
				exclusiveMaximum: node.exclusiveMaximum,
				multipleOf: node.multipleOf
			})
		case 5:
			return {
				...base,
				coerce: node.coerce,
				explicit: node.explicit
			}
		case 7:
			return { ...base, value: node.value }
		default:
			return base
	}
}

function semanticValue(
	value: unknown,
	seen = new Set<object>()
): CanonicalValue {
	if (value === undefined) return { type: 'undefined' }
	if (value === null) return { type: 'null' }
	if (typeof value === 'boolean') return { type: 'boolean', value }
	if (typeof value === 'string') return { type: 'string', value }
	if (typeof value === 'bigint')
		return { type: 'bigint', value: value.toString() }
	if (typeof value === 'number')
		return {
			type: 'number',
			value: Number.isNaN(value)
				? 'nan'
				: value === Infinity
					? 'infinity'
					: value === -Infinity
						? '-infinity'
						: Object.is(value, -0)
							? '-0'
							: value
		}
	if (!value || typeof value !== 'object')
		throw new Error('validator semantic value is not serializable')
	if (seen.has(value))
		throw new Error('validator semantic value contains a cycle')

	seen.add(value)
	try {
		if (Array.isArray(value))
			return {
				type: 'array',
				length: value.length,
				entries: Object.keys(value).map((key) => ({
					index: Number(key),
					value: semanticValue(value[Number(key)], seen)
				}))
			}
		if (value instanceof Date)
			return { type: 'date', value: semanticValue(value.getTime()) }
		if (value instanceof RegExp)
			return {
				type: 'regexp',
				source: value.source,
				flags: value.flags
			}

		const prototype = Object.getPrototypeOf(value)
		if (prototype !== null && prototype !== Object.prototype)
			throw new Error('validator semantic value is not serializable')
		const entries: Record<string, CanonicalValue> = Object.create(null)
		for (const key of Object.keys(value).sort())
			entries[key] = semanticValue(
				(value as Record<string, unknown>)[key],
				seen
			)
		return { type: 'object', value: entries }
	} finally {
		seen.delete(value)
	}
}

function semanticGraph(root: unknown): CanonicalValue {
	const seen = new WeakMap<object, number>()
	const localSymbols = new Map<symbol, number>()
	let objectId = 0
	let external = 0

	const key = (value: PropertyKey): CanonicalValue => {
		if (typeof value === 'string') return { type: 'string', value }
		if (typeof value === 'number') return { type: 'number', value }
		const global = Symbol.keyFor(value)
		if (global !== undefined)
			return { type: 'symbol', scope: 'global', value: global }
		let ordinal = localSymbols.get(value)
		if (ordinal === undefined) {
			ordinal = localSymbols.size
			localSymbols.set(value, ordinal)
		}
		return {
			type: 'symbol',
			scope: 'local',
			ordinal,
			description: value.description ?? ''
		}
	}

	const visit = (value: unknown): CanonicalValue => {
		if (value === undefined) return { type: 'undefined' }
		if (value === null) return { type: 'null' }
		if (typeof value === 'boolean') return { type: 'boolean', value }
		if (typeof value === 'string') return { type: 'string', value }
		if (typeof value === 'bigint')
			return { type: 'bigint', value: value.toString() }
		if (typeof value === 'number') return semanticValue(value)
		if (typeof value === 'symbol') return key(value)
		if (typeof value === 'function')
			return { type: 'external', kind: 'function', ordinal: external++ }

		const object = value as object
		const reference = seen.get(object)
		if (reference !== undefined) return { type: 'reference', id: reference }
		const id = objectId++
		seen.set(object, id)

		if (value instanceof Date)
			return { id, type: 'date', value: visit(value.getTime()) }
		if (value instanceof RegExp)
			return {
				id,
				type: 'regexp',
				source: value.source,
				flags: value.flags
			}
		if (value instanceof Map)
			return {
				id,
				type: 'map',
				entries: [...value].map(([left, right]) => [
					visit(left),
					visit(right)
				])
			}
		if (value instanceof Set)
			return {
				id,
				type: 'set',
				entries: [...value].map(visit)
			}

		const entries: CanonicalValue[] = []
		for (const property of Reflect.ownKeys(object)) {
			if (Array.isArray(value) && property === 'length') continue
			const descriptor = Object.getOwnPropertyDescriptor(
				object,
				property
			)!
			const projected: CanonicalValue =
				'value' in descriptor
					? visit(descriptor.value)
					: {
							type: 'accessor',
							get: descriptor.get
								? {
										type: 'external',
										kind: 'getter',
										ordinal: external++
									}
								: { type: 'undefined' },
							set: descriptor.set
								? {
										type: 'external',
										kind: 'setter',
										ordinal: external++
									}
								: { type: 'undefined' }
						}
			entries.push({
				key: key(property),
				value: projected,
				enumerable: !!descriptor.enumerable,
				writable: 'writable' in descriptor && !!descriptor.writable
			})
		}

		const prototype = Object.getPrototypeOf(object)
		return {
			id,
			type: Array.isArray(value) ? 'array' : 'object',
			...(Array.isArray(value) ? { length: value.length } : {}),
			entries,
			prototype:
				prototype === Object.prototype || prototype === Array.prototype
					? 'intrinsic'
					: visit(prototype)
		}
	}

	return visit(root)
}

function withoutUndefined(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutUndefined)
	if (!value || typeof value !== 'object') return value
	const prototype = Object.getPrototypeOf(value)
	if (prototype !== null && prototype !== Object.prototype) return value

	const out: Record<string, unknown> = Object.create(null)
	for (const [key, child] of Object.entries(value))
		if (child !== undefined) out[key] = withoutUndefined(child)
	return out
}
