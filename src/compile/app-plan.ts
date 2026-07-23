import {
	AOT_ABI,
	createProgramId,
	type ProgramId,
	type ValidatorSlot
} from './aot'
import type { WSRoutePlan } from '../ws/runtime'
import type { CompactBeforeHandlePrefix } from '../utils'

export const APP_PLAN_VERSION = 2 as const
const APPLICATION_NODE_ID = 0

export type CanonicalValue =
	| null
	| boolean
	| number
	| string
	| CanonicalArray
	| CanonicalObject
export interface CanonicalArray extends ReadonlyArray<CanonicalValue> {}
export interface CanonicalObject {
	readonly [key: string]: CanonicalValue
}

export const EXTERNAL_BINDING_ROLES = [
	'request',
	'hoc',
	'handler',
	'response',
	'staticValue',
	'mount',
	'parser',
	'transform',
	'derive',
	'resolve',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse',
	'error',
	'tracer',
	'bodyValidator',
	'headersValidator',
	'paramsValidator',
	'queryValidator',
	'cookieValidator',
	'responseValidator',
	'cookieCryptoProvider',
	'routeErrorFinalizer',
	'adapterParse',
	'adapterMap',
	'adapterCompact',
	'decorator',
	'store',
	'server',
	'wsOpen',
	'wsMessage',
	'wsDrain',
	'wsClose',
	'wsPing',
	'wsPong',
	'wsUpgrade'
] as const
export type ExternalBindingRole = (typeof EXTERNAL_BINDING_ROLES)[number]

export interface ExternalBindingInput {
	readonly role: ExternalBindingRole
	readonly value: unknown
}
export interface ExternalBindingDescriptor {
	readonly nodeId: number
	readonly role: ExternalBindingRole
	readonly ordinal: number
}

export const LIFECYCLE_PHASES = [
	'transform',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse',
	'error'
] as const
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number]
export type LifecycleBindingRole =
	| 'transform'
	| 'derive'
	| 'resolve'
	| 'beforeHandle'
	| 'afterHandle'
	| 'mapResponse'
	| 'afterResponse'
	| 'error'
export interface LifecycleBindingInput {
	readonly role: LifecycleBindingRole
	readonly value: unknown
}
export interface LifecycleSequenceInput {
	readonly phase: LifecyclePhase
	readonly prefix?: CompactBeforeHandlePrefix
	readonly bindings?: readonly LifecycleBindingInput[]
}
export interface LifecycleSegmentDescriptor {
	readonly id: number
	readonly parent: number | null
	readonly length: number
	readonly role: LifecycleBindingRole
	readonly name: string
	readonly bindingIndex: number
}
export interface LifecycleSegmentReference {
	readonly phase: LifecyclePhase
	readonly segmentId: number
	readonly start: 0
	readonly end: number
}

export interface VersionedPlanInput {
	readonly version: number
	readonly content: unknown
	readonly bindings?: readonly ExternalBindingInput[]
}
export interface ProgramIdentity {
	readonly version: number
	readonly content: CanonicalValue
	readonly bindingIndices: readonly number[]
}
export interface ValidatorSlotInput extends VersionedPlanInput {
	readonly slot: ValidatorSlot
}
export interface ValidatorSlotDescriptor {
	readonly slot: ValidatorSlot
	readonly version: number
	readonly artifact: CanonicalValue
	readonly bindingIndices: readonly number[]
}

export interface HttpRoutePlanInput {
	/** Owner and macro-root semantics must already be resolved; roots are never retained. */
	readonly method: string
	readonly path: string
	readonly handlerForm: HttpHandlerForm
	readonly program: VersionedPlanInput
	readonly validators?: readonly ValidatorSlotInput[]
	readonly bindings?: readonly ExternalBindingInput[]
	readonly lifecycle?: readonly LifecycleSequenceInput[]
}
export interface HttpRoutePlan {
	readonly id: number
	readonly nodeId: number
	readonly method: string
	readonly path: string
	readonly handlerForm: HttpHandlerForm
	readonly program: ProgramIdentity
	readonly validators: readonly ValidatorSlotDescriptor[]
	readonly bindingIndices: readonly number[]
	readonly lifecycle: readonly LifecycleSegmentReference[]
}
export type HttpHandlerForm =
	| 'function'
	| 'response'
	| 'static-value'
	| 'promise'
	| 'mount'

export interface WSRoutePlanReferenceInput extends VersionedPlanInput {
	readonly path: string
	readonly plan: WSRoutePlan
	readonly validators?: readonly ValidatorSlotInput[]
}
export interface WSRoutePlanReference {
	readonly path: string
	readonly plan: WSRoutePlan
	readonly identity: ProgramIdentity
	readonly validators: readonly ValidatorSlotDescriptor[]
}

export interface ApplicationPolicyInput {
	readonly fetch: unknown
	readonly lifecycle: unknown
	readonly bindings?: readonly ExternalBindingInput[]
}
export interface ApplicationPolicy {
	readonly nodeId: 0
	readonly fetch: CanonicalValue
	readonly lifecycle: CanonicalValue
	readonly bindingIndices: readonly number[]
}
export interface AdapterPlanInput {
	readonly target: string
	readonly capabilities?: Readonly<Record<string, boolean>>
}
export interface AdapterPlan {
	readonly target: string
	readonly capabilities: Readonly<Record<string, boolean>>
}

export interface AppPlanCoverage {
	readonly declaredHttpRoutes: number
	readonly winningHttpRoutes: number
	readonly shadowedHttpRoutes: number
	readonly plannedHttpRoutes: number
	readonly declaredWSRoutes: number
	readonly winningWSRoutes: number
	readonly shadowedWSRoutes: number
	readonly validatorSlots: number
	readonly externalBindings: number
}

type HttpRouteIdentity = Omit<HttpRoutePlan, 'nodeId'>
type WSRouteIdentity = Omit<WSRoutePlanReference, 'plan'>
export interface AppPlanFingerprint {
	readonly planVersion: typeof APP_PLAN_VERSION
	readonly abi: string
	readonly application: ApplicationPolicy
	readonly runtimeConstants: Readonly<Record<string, CanonicalValue>>
	readonly adapter: AdapterPlan
	readonly lifecycleSegments: readonly LifecycleSegmentDescriptor[]
	readonly httpRoutes: readonly HttpRouteIdentity[]
	readonly wsRoutes: readonly WSRouteIdentity[]
	readonly bindingLayout: readonly ExternalBindingDescriptor[]
}
export interface AppPlanInput {
	readonly abi?: string
	readonly programId?: ProgramId
	readonly application: ApplicationPolicyInput
	readonly runtimeConstants?: Readonly<Record<string, unknown>>
	readonly adapter: AdapterPlanInput
	readonly httpRoutes: readonly HttpRoutePlanInput[]
	readonly wsRoutes?: readonly WSRoutePlanReferenceInput[]
	/** Declared counts are supplied by the routing resolver before winner planning. */
	readonly declaredRoutes?: Readonly<{
		readonly http: number
		readonly ws: number
	}>
}
export interface AppPlan {
	readonly version: typeof APP_PLAN_VERSION
	readonly abi: string
	readonly programId: ProgramId
	readonly application: ApplicationPolicy
	readonly runtimeConstants: Readonly<Record<string, CanonicalValue>>
	readonly adapter: AdapterPlan
	readonly lifecycleSegments: readonly LifecycleSegmentDescriptor[]
	readonly httpRoutes: readonly HttpRoutePlan[]
	readonly wsRoutes: readonly WSRoutePlanReference[]
	readonly bindingLayout: readonly ExternalBindingDescriptor[]
	readonly externalBindings: readonly unknown[]
	readonly coverage: AppPlanCoverage
	readonly fingerprint: AppPlanFingerprint
}

const freezeCanonical = (
	value: unknown,
	label: string,
	seen = new Set<object>()
): CanonicalValue => {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean'
	)
		return value
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`${label} is not serializable`)
		return Object.is(value, -0) ? 0 : value
	}
	if (!value || typeof value !== 'object')
		throw new Error(`${label} is not serializable`)
	if (seen.has(value)) throw new Error(`${label} contains a cycle`)

	seen.add(value)
	try {
		if (Array.isArray(value)) {
			if (
				Object.keys(value).length !== value.length ||
				Reflect.ownKeys(value).length !== value.length + 1
			)
				throw new Error(`${label} must be a dense array`)
			return Object.freeze(
				value.map((item, i) => freezeCanonical(item, `${label}[${i}]`, seen))
			)
		}

		const prototype = Object.getPrototypeOf(value)
		const keys = Object.keys(value)
		if (
			(prototype !== null && prototype !== Object.prototype) ||
			Reflect.ownKeys(value).length !== keys.length ||
			keys.some(
				(key) => !('value' in Object.getOwnPropertyDescriptor(value, key)!)
			)
		)
			throw new Error(`${label} must contain only plain data`)

		const result: Record<string, CanonicalValue> = Object.create(null)
		for (const key of keys.sort())
			result[key] = freezeCanonical(
				(value as Record<string, unknown>)[key],
				`${label}.${key}`,
				seen
			)
		return Object.freeze(result)
	} finally {
		seen.delete(value)
	}
}

/** Snapshot planner-owned identity data without retaining its authoring input. */
export const canonicalPlanValue = (value: unknown, label = 'plan value') =>
	freezeCanonical(value, label)

const nonEmpty = (value: unknown, label: string) => {
	if (typeof value !== 'string' || !value || value.includes('\0'))
		throw new Error(`${label} must be non-empty`)
	return value
}
const routePath = (value: unknown, label: string) => {
	if (typeof value !== 'string' || value.includes('\0'))
		throw new Error(`${label} must be a string without NUL`)
	return value
}
const version = (value: number, label: string) => {
	if (!Number.isSafeInteger(value) || value < 1)
		throw new Error(`${label} version must be a positive integer`)
}
const routeKey = (method: string, path: string) => `${method}\0${path}`
const winners = <T>(items: readonly T[], key: (item: T) => string) => {
	const last = new Map<string, number>()
	for (let i = 0; i < items.length; i++) last.set(key(items[i]!), i)
	return items.filter((item, i) => last.get(key(item)) === i)
}

const EMPTY_INDICES = Object.freeze([]) as readonly number[]
const bindingRoles = new Set<ExternalBindingRole>(EXTERNAL_BINDING_ROLES)
const validatorRoles = new Set<ExternalBindingRole>([
	'bodyValidator',
	'headersValidator',
	'paramsValidator',
	'queryValidator',
	'cookieValidator',
	'responseValidator'
])
const routeRoles = new Set<ExternalBindingRole>([
	'parser',
	'tracer',
	'cookieCryptoProvider',
	'adapterParse',
	'adapterMap',
	'adapterCompact'
])
const applicationRoles = new Set<ExternalBindingRole>([
	'request',
	'mapResponse',
	'afterResponse',
	'error',
	'tracer',
	'hoc',
	'routeErrorFinalizer',
	'adapterParse',
	'adapterMap',
	'adapterCompact',
	'decorator',
	'store',
	'server'
])

const applicationRoleOrder = new Map<ExternalBindingRole, number>([
	['routeErrorFinalizer', 0],
	['request', 1],
	['mapResponse', 2],
	['error', 3],
	['afterResponse', 4],
	['tracer', 5],
	['hoc', 6],
	['decorator', 7],
	['store', 8],
	['server', 9],
	['adapterParse', 10],
	['adapterMap', 11],
	['adapterCompact', 12]
])

function assertApplicationBindings(
	bindings: readonly ExternalBindingInput[] | undefined
) {
	let previous = -1
	const counts = new Map<ExternalBindingRole, number>()
	for (const binding of bindings ?? []) {
		const order = applicationRoleOrder.get(binding.role)
		if (order === undefined || order < previous)
			throw new Error('invalid application binding order')
		previous = order
		counts.set(binding.role, (counts.get(binding.role) ?? 0) + 1)
	}
	for (const role of [
		'routeErrorFinalizer',
		'decorator',
		'store',
		'server',
		'adapterParse',
		'adapterMap',
		'adapterCompact'
	] as const)
		if ((counts.get(role) ?? 0) > 1)
			throw new Error(`multiple application ${role} bindings`)
}
const wsRoles = new Set<ExternalBindingRole>([
	'wsOpen',
	'wsMessage',
	'wsDrain',
	'wsClose',
	'wsPing',
	'wsPong',
	'wsUpgrade',
	'transform',
	'derive',
	'resolve',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse',
	'error',
	...routeRoles,
	...validatorRoles
])
const lifecycleRoles = new Set<ExternalBindingRole>([
	'transform',
	'derive',
	'resolve',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse',
	'error'
])
const lifecyclePhases = new Set<LifecyclePhase>(LIFECYCLE_PHASES)
const lifecyclePhaseRoles: Readonly<
	Record<LifecyclePhase, ReadonlySet<LifecycleBindingRole>>
> = {
	transform: new Set(['transform']),
	beforeHandle: new Set(['beforeHandle', 'derive', 'resolve']),
	afterHandle: new Set(['afterHandle']),
	mapResponse: new Set(['mapResponse']),
	afterResponse: new Set(['afterResponse']),
	error: new Set(['error'])
}

export function createAppPlan(input: AppPlanInput): AppPlan {
	const abi = input.abi ?? AOT_ABI
	nonEmpty(abi, 'AppPlan ABI')
	const bindingLayout: ExternalBindingDescriptor[] = []
	const externalBindings: unknown[] = []
	const ordinals = new Map<string, number>()
	const identityContents = new Map<string, CanonicalValue>()
	const addBindings = (
		nodeId: number,
		bindings: readonly ExternalBindingInput[] | undefined,
		allowed = bindingRoles
	) => {
		if (!bindings?.length) return EMPTY_INDICES
		const indices: number[] = []
		for (const binding of bindings) {
			const role = binding.role
			if (!bindingRoles.has(role) || !allowed.has(role))
				throw new Error(`invalid binding role: ${String(role)}`)
			const key = `${nodeId}\0${role}`
			const ordinal = ordinals.get(key) ?? 0
			ordinals.set(key, ordinal + 1)
			indices.push(bindingLayout.length)
			bindingLayout.push(Object.freeze({ nodeId, role, ordinal }))
			externalBindings.push(binding.value)
		}
		return Object.freeze(indices)
	}
	const identity = (
		plan: VersionedPlanInput,
		nodeId: number,
		label: string,
		allowed = bindingRoles
	): ProgramIdentity => {
		version(plan.version, label)
		const frozen = freezeCanonical(plan.content, `${label} content`)
		const key = `${plan.version}\0${JSON.stringify(frozen)}`
		const content = identityContents.get(key) ?? frozen
		identityContents.set(key, content)
		return Object.freeze({
			version: plan.version,
			content,
			bindingIndices: addBindings(nodeId, plan.bindings, allowed)
		})
	}

	assertApplicationBindings(input.application.bindings)
	const application: ApplicationPolicy = Object.freeze({
		nodeId: APPLICATION_NODE_ID,
		fetch: freezeCanonical(input.application.fetch, 'fetch policy'),
		lifecycle: freezeCanonical(input.application.lifecycle, 'lifecycle policy'),
		bindingIndices: addBindings(
			APPLICATION_NODE_ID,
			input.application.bindings,
			applicationRoles
		)
	})
	const declaredHttp = input.httpRoutes.map((route) => {
		const method = nonEmpty(route.method, 'route method').toUpperCase()
		const path = routePath(route.path, 'route path')
		if (method === 'WS') throw new Error('WebSocket plans must use wsRoutes')
		return { route, method, path, key: routeKey(method, path) }
	})
	if (winners(declaredHttp, (route) => route.key).length !== declaredHttp.length)
		throw new Error('AppPlan HTTP routes must be pre-resolved winners')
	const winningHttp = declaredHttp
	const declaredWS = input.wsRoutes ?? []
	const lifecycleSegments: LifecycleSegmentDescriptor[] = []
	const lifecycleChildren: Map<string, Map<unknown, number>>[] = [new Map()]
	const compactPrefixes = new WeakMap<CompactBeforeHandlePrefix, number | null>()
	const appendLifecycle = (
		parent: number | null,
		binding: LifecycleBindingInput
	) => {
		if (
			!lifecycleRoles.has(binding.role) ||
			typeof binding.value !== 'function'
		)
			throw new Error('invalid lifecycle binding')
		const key = binding.role
		const table = lifecycleChildren[parent === null ? 0 : parent + 1]!
		let values = table.get(key)
		if (!values) table.set(key, (values = new Map()))
		const existing = values.get(binding.value)
		if (existing !== undefined) return existing

		const id = lifecycleSegments.length
		const nodeId = winningHttp.length + declaredWS.length + id + 1
		const [bindingIndex] = addBindings(
			nodeId,
			[{ role: binding.role, value: binding.value }],
			lifecycleRoles
		)
		const segment = Object.freeze({
			id,
			parent,
			length: parent === null ? 1 : lifecycleSegments[parent]!.length + 1,
			role: binding.role,
			// Function names are observability metadata, not semantic identity.
			// Lowering restores the live name from the binding after validation.
			name: 'anonymous',
			bindingIndex: bindingIndex!
		})
		lifecycleSegments.push(segment)
		lifecycleChildren.push(new Map())
		values.set(binding.value, id)
		return id
	}
	const appendCompactPrefix = (
		prefix: CompactBeforeHandlePrefix
	): number | null => {
		const cached = compactPrefixes.get(prefix)
		if (cached !== undefined || compactPrefixes.has(prefix)) return cached ?? null
		let parent = prefix.previous
			? appendCompactPrefix(prefix.previous)
			: null
		for (const value of prefix.added)
			parent = appendLifecycle(parent, {
				role: 'beforeHandle',
				value
			})
		const length = parent === null ? 0 : lifecycleSegments[parent]!.length
		if (length !== prefix.length)
			throw new Error('invalid compact lifecycle prefix')
		compactPrefixes.set(prefix, parent)
		return parent
	}
	const lifecycleReferences = (
		sequences: readonly LifecycleSequenceInput[] | undefined
	) => {
		const references: LifecycleSegmentReference[] = []
		const phases = new Set<LifecyclePhase>()
		for (const sequence of sequences ?? []) {
			if (!lifecyclePhases.has(sequence.phase) || phases.has(sequence.phase))
				throw new Error('invalid lifecycle phase')
			phases.add(sequence.phase)
			if (sequence.prefix && sequence.phase !== 'beforeHandle')
				throw new Error('compact lifecycle prefix must be beforeHandle')
			let segmentId = sequence.prefix
				? appendCompactPrefix(sequence.prefix)
				: null
			for (const binding of sequence.bindings ?? []) {
				if (!lifecyclePhaseRoles[sequence.phase].has(binding.role))
					throw new Error('lifecycle role does not match phase')
				segmentId = appendLifecycle(segmentId, binding)
			}
			if (segmentId !== null)
				references.push(
					Object.freeze({
						phase: sequence.phase,
						segmentId,
						start: 0 as const,
						end: lifecycleSegments[segmentId]!.length
					})
				)
		}
		return Object.freeze(references)
	}
	const httpRoutes = Object.freeze(
		winningHttp.map(({ route, method, path }, id) => {
			const nodeId = id + 1
			const expectedRole =
				route.handlerForm === 'mount'
					? 'mount'
					: route.handlerForm === 'function'
						? 'handler'
						: route.handlerForm === 'response'
							? 'response'
							: 'staticValue'
			if (
				!['function', 'response', 'static-value', 'promise', 'mount'].includes(
					route.handlerForm
				) ||
				route.program.bindings?.length !== 1 ||
				route.program.bindings[0]!.role !== expectedRole
			)
				throw new Error(`invalid ${method} ${path} handler binding`)
			const validators = [...(route.validators ?? [])].sort((a, b) =>
				a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0
			)
			for (let i = 0; i < validators.length; i++)
				if (
					!/^(?:body|query|params|headers|cookie|response:\d+)$/.test(
						validators[i]!.slot
					) ||
					(i > 0 && validators[i - 1]!.slot === validators[i]!.slot)
				)
					throw new Error(`invalid validator slot on ${method} ${path}`)
			for (const validator of validators) {
				const expected = `${
					validator.slot.startsWith('response:')
						? 'response'
						: validator.slot
				}Validator` as ExternalBindingRole
				if (
					validator.bindings?.length !== 1 ||
					validator.bindings[0]!.role !== expected
				)
					throw new Error(`missing ${expected} on ${method} ${path}`)
			}

			return Object.freeze({
				id,
				nodeId,
				method,
				path,
				handlerForm: route.handlerForm,
				bindingIndices: addBindings(nodeId, route.bindings, routeRoles),
				lifecycle: lifecycleReferences(route.lifecycle),
				program: identity(
					route.program,
					nodeId,
					`${method} ${path} program`,
					new Set<ExternalBindingRole>([expectedRole])
				),
				validators: Object.freeze(
					validators.map((validator) => {
						const value = identity(
							validator,
							nodeId,
							`${method} ${path} ${validator.slot}`,
							validatorRoles
						)
						return Object.freeze({
							slot: validator.slot,
							version: value.version,
							artifact: value.content,
							bindingIndices: value.bindingIndices
						})
					})
				)
			})
		})
	)

	if (
		winners(declaredWS, (route) => routePath(route.path, 'WebSocket path'))
			.length !== declaredWS.length
	)
		throw new Error('AppPlan WebSocket routes must be pre-resolved winners')
	const winningWS = declaredWS
	const wsRoutes = Object.freeze(
		winningWS.map((route, i) => {
			const nodeId = httpRoutes.length + i + 1
			const validators = [...(route.validators ?? [])].sort((a, b) =>
				a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0
			)
			for (let index = 0; index < validators.length; index++) {
				const validator = validators[index]!
				if (
					!/^(?:body|query|params|headers|cookie|response:\d+)$/.test(
						validator.slot
					) ||
					(index > 0 && validators[index - 1]!.slot === validator.slot)
				)
					throw new Error(`invalid validator slot on WS ${route.path}`)
				const expected = `${
					validator.slot.startsWith('response:')
						? 'response'
						: validator.slot
				}Validator` as ExternalBindingRole
				if (
					validator.bindings?.length !== 1 ||
					validator.bindings[0]!.role !== expected
				)
					throw new Error(`missing ${expected} on WS ${route.path}`)
			}

			return Object.freeze({
				path: route.path,
				plan: route.plan,
				identity: identity(
					route,
					nodeId,
					`WS ${route.path}`,
					wsRoles
				),
				validators: Object.freeze(
					validators.map((validator) => {
						const value = identity(
							validator,
							nodeId,
							`WS ${route.path} ${validator.slot}`,
							validatorRoles
						)
						return Object.freeze({
							slot: validator.slot,
							version: value.version,
							artifact: value.content,
							bindingIndices: value.bindingIndices
						})
					})
				)
			})
		})
	)

	const capabilities: Record<string, boolean> = Object.create(null)
	nonEmpty(input.adapter.target, 'adapter target')
	for (const key of Object.keys(input.adapter.capabilities ?? {}).sort()) {
		const value = input.adapter.capabilities![key]
		if (typeof value !== 'boolean') throw new Error('invalid adapter capability')
		capabilities[key] = value
	}
	const adapter = Object.freeze({
		target: input.adapter.target,
		capabilities: Object.freeze(capabilities)
	})
	const runtimeConstants = freezeCanonical(
		input.runtimeConstants ?? {},
		'runtime constants'
	) as Readonly<Record<string, CanonicalValue>>
	const declaredHttpRoutes = input.declaredRoutes?.http ?? input.httpRoutes.length
	const declaredWSRoutes = input.declaredRoutes?.ws ?? declaredWS.length
	if (
		!Number.isSafeInteger(declaredHttpRoutes) ||
		declaredHttpRoutes < httpRoutes.length ||
		!Number.isSafeInteger(declaredWSRoutes) ||
		declaredWSRoutes < wsRoutes.length
	)
		throw new Error('invalid declared route coverage')
	const coverage: AppPlanCoverage = Object.freeze({
		declaredHttpRoutes,
		winningHttpRoutes: httpRoutes.length,
		shadowedHttpRoutes: declaredHttpRoutes - httpRoutes.length,
		plannedHttpRoutes: httpRoutes.length,
		declaredWSRoutes,
		winningWSRoutes: wsRoutes.length,
		shadowedWSRoutes: declaredWSRoutes - wsRoutes.length,
		validatorSlots:
			httpRoutes.reduce(
				(count, route) => count + route.validators.length,
				0
			) +
			wsRoutes.reduce(
				(count, route) => count + route.validators.length,
				0
			),
		externalBindings: bindingLayout.length
	})
	const frozenLayout = Object.freeze(bindingLayout)
	const fingerprint: AppPlanFingerprint = Object.freeze({
		planVersion: APP_PLAN_VERSION,
		abi,
		application,
		runtimeConstants,
		adapter,
		lifecycleSegments: Object.freeze(lifecycleSegments),
		httpRoutes: Object.freeze(
			httpRoutes.map(({ nodeId: _, ...route }) => Object.freeze(route))
		),
		wsRoutes: Object.freeze(
			wsRoutes.map(({ plan: _, ...route }) => Object.freeze(route))
		),
		bindingLayout: frozenLayout
	})

	return Object.freeze({
		version: APP_PLAN_VERSION,
		abi,
		programId: input.programId ?? createProgramId(),
		application,
		runtimeConstants,
		adapter,
		lifecycleSegments: fingerprint.lifecycleSegments,
		httpRoutes,
		wsRoutes,
		bindingLayout: frozenLayout,
		externalBindings: Object.freeze(externalBindings),
		coverage,
		fingerprint
	})
}

const exactCanonical = (value: unknown, label: string) =>
	JSON.stringify(freezeCanonical(value, label))
const exactFingerprint = (value: AppPlanFingerprint) =>
	exactCanonical(value, 'AppPlan fingerprint')
const sameIndices = (left: readonly number[], right: readonly number[]) =>
	left.length === right.length && left.every((value, i) => value === right[i])

export const programIdentitiesEqual = (
	left: ProgramIdentity,
	right: ProgramIdentity
) =>
	left.version === right.version &&
	sameIndices(left.bindingIndices, right.bindingIndices) &&
	exactCanonical(left.content, 'program identity') ===
		exactCanonical(right.content, 'program identity')

export const validatorSlotDescriptorsEqual = (
	left: ValidatorSlotDescriptor,
	right: ValidatorSlotDescriptor
) =>
	left.slot === right.slot &&
	left.version === right.version &&
	sameIndices(left.bindingIndices, right.bindingIndices) &&
	exactCanonical(left.artifact, 'validator identity') ===
		exactCanonical(right.artifact, 'validator identity')

export const appPlanFingerprintsEqual = (
	live: AppPlanFingerprint,
	aot: AppPlanFingerprint
) => exactFingerprint(live) === exactFingerprint(aot)

/** Exact full-content guard; call before publishing a live or AOT image. */
export function assertAppPlanPublicationIdentity(
	live: AppPlan,
	aot: AppPlanFingerprint
) {
	if (aot.planVersion !== APP_PLAN_VERSION)
		throw new Error(`Unsupported AppPlan version: ${String(aot.planVersion)}`)
	if (!appPlanFingerprintsEqual(live.fingerprint, aot))
		throw new Error('AppPlan fingerprint mismatch')
}
