import { isPureRefinement, pureRefine } from './type/shared'
import { env } from './universal'
import { assignOwn, evictOldestHalf } from './utils'

const modelSnapshots = new WeakMap<object, object>()
// `.model()` clone -> its source and name, identity only: each app's model
// table owns its clones, so a `$id` it stamps never reaches another app
const modelSources = new WeakMap<object, object>()
// `.model()` clone -> a private copy of its source as registered: what other
// tables and nested uses validate, unmoved by later edits to the source
const modelPristine = new WeakMap<object, object>()
const modelNames = new WeakMap<object, string>()
const hookSnapshots = new WeakMap<object, object>()

// structural fingerprint -> shared frozen snapshot
const interned = new Map<string, object>()

const INTERN_LIMIT = 1024

// snapshots produced for idempotency
const produced = new WeakSet<object>()
const clonableProtos = new WeakMap<object, boolean>()
const immutableNodes = new WeakMap<object, boolean>()
const isEnumerable = Object.prototype.propertyIsEnumerable
const schemaProtoMarkers = new Set(['~kind', '~standard', '~unsafe'])
const schemaSlots = ['body', 'query', 'params', 'headers', 'cookie'] as const

/**
 * Schemas handed to the two snapshot entry points, read by the AOT build:
 * its stub throws on each one, including a schema no route reaches
 */
export let snapshotCalls = 0

function isClonableProto(proto: object | null): boolean {
	if (proto === null || proto === Object.prototype) return true

	const memo = clonableProtos.get(proto)
	if (memo !== undefined) return memo

	let clonable = true

	for (const key of Object.getOwnPropertyNames(proto))
		if (!schemaProtoMarkers.has(key)) {
			clonable = false
			break
		}

	if (clonable && Object.getOwnPropertySymbols(proto).length) clonable = false
	if (clonable) clonable = isClonableProto(Object.getPrototypeOf(proto))

	clonableProtos.set(proto, clonable)

	return clonable
}

function isImmutableNode(value: object) {
	const memo = immutableNodes.get(value)
	if (memo !== undefined) return memo
	if (!Object.isFrozen(value)) return false

	let immutable = true

	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)!

		// an accessor may answer differently on every read, and an object value
		// stays mutable behind the frozen node holding it
		if (
			!('value' in descriptor) ||
			(descriptor.value !== null && typeof descriptor.value === 'object')
		) {
			immutable = false
			break
		}
	}

	immutableNodes.set(value, immutable)

	return immutable
}

function copyMarker(marker: any, copies: Map<object, object>) {
	let out = copies.get(marker)
	if (!out)
		copies.set(
			marker,
			(out = Array.isArray(marker)
				? marker.map((refinement) => {
						const copy = { ...refinement }
						if (isPureRefinement(refinement))
							pureRefine({ '~refine': [copy] })

						return copy
					})
				: { ...marker })
		)

	return out
}

function deepCloneSchema(
	value: any,
	freeze: boolean,
	seen: Map<object, object> | undefined,
	copies: Map<object, object>,
	canShare = true
) {
	if (value === null || typeof value !== 'object') return value

	const cached = seen?.get(value)
	if (cached) return cached

	if (Array.isArray(value)) {
		const out: any[] = []

		seen ??= new Map()
		seen.set(value, out)

		for (let i = 0; i < value.length; i++)
			out[i] = deepCloneSchema(value[i], freeze, seen, copies)

		return freeze ? Object.freeze(out) : out
	}

	// a nested `.model()` clone is copied from its source as registered: the
	// `$id` it was given belongs to its own app's table
	const source = modelPristine.get(value)
	if (source) {
		seen ??= new Map()
		const copy: any = deepCloneSchema(
			source,
			freeze,
			seen,
			copies,
			canShare
		)
		seen.set(value, copy)

		return copy
	}

	if (canShare && isImmutableNode(value)) return value

	const proto = Object.getPrototypeOf(value)
	if (!isClonableProto(proto)) return value

	const out: Record<keyof any, any> = Object.create(proto)

	seen ??= new Map()
	seen.set(value, out)

	const keys = Object.getOwnPropertyNames(value)

	// one length compare stands in for a `propertyIsEnumerable` call per key
	const allEnumerable = Object.keys(value).length === keys.length

	for (let i = 0; i < keys.length; i++) {
		const key = keys[i]!
		const property = value[key]

		// non-enumerable markers (`~kind`, `~optional`, ...) are copied by
		// reference, matching `copyNonEnumerable`, but `~cookieFrom` is cloned
		// and `~refine` / `~codec` copied unfrozen
		if (!allEnumerable && !isEnumerable.call(value, key)) {
			Object.defineProperty(out, key, {
				value:
					key === '~cookieFrom'
						? deepCloneSchema(property, freeze, seen, copies)
						: (key === '~refine' || key === '~codec') &&
							  property &&
							  typeof property === 'object'
							? copyMarker(property, copies)
							: property,
				enumerable: false,
				writable: true,
				configurable: true
			})

			continue
		}

		const cloned = deepCloneSchema(property, freeze, seen, copies)

		if (key === '__proto__') assignOwn(out, { [key]: cloned })
		else out[key] = cloned
	}

	const symbols = Object.getOwnPropertySymbols(value)
	for (let i = 0; i < symbols.length; i++) {
		const key = symbols[i]!
		const property = value[key]

		if (isEnumerable.call(value, key))
			out[key] = deepCloneSchema(property, freeze, seen, copies)
		else
			Object.defineProperty(out, key, {
				value: property,
				enumerable: false,
				writable: true,
				configurable: true
			})
	}

	return freeze ? Object.freeze(out) : out
}

const refIds = new WeakMap<object | Function, number>()
let nextRefId = 0

function refKey(value: object | Function): string {
	let id = refIds.get(value)
	if (id === undefined) refIds.set(value, (id = ++nextRefId))

	return 'r' + id + ';'
}

interface FingerprintState {
	bail: boolean
}

// symbol-keyed members can't be keyed structurally, a node holding one opts out of sharing
const byRefKey = (value: any, state: FingerprintState): string =>
	value !== null && (typeof value === 'object' || typeof value === 'function')
		? refKey(value)
		: fingerprint(value, undefined, state)

function fingerprint(
	value: any,
	seen: Map<object, number> | undefined,
	state: FingerprintState,
	canShare = true
): string {
	if (value === null) return 'z;'

	const type = typeof value
	if (type !== 'object') {
		switch (type) {
			// length-prefixed so `{a:'b',c:''}` and `{a:'b,c'}` cannot collide
			case 'string':
				return 's' + value.length + ':' + value

			case 'number':
				// keep `-0` apart from `0`
				return 'n' + (Object.is(value, -0) ? '-0' : value) + ';'

			case 'boolean':
				return value ? 'T;' : 'F;'

			case 'function':
				return refKey(value)

			case 'undefined':
				return 'u;'

			case 'bigint':
				return 'g' + value + ';'

			default:
				state.bail = true

				return 'y;'
		}
	}

	const backReference = seen?.get(value)
	if (backReference !== undefined) return 'b' + backReference + ';'

	if (Array.isArray(value)) {
		seen ??= new Map()
		seen.set(value, seen.size)

		let out = '['
		for (let i = 0; i < value.length; i++)
			out += fingerprint(value[i], seen, state)

		return out + '];'
	}

	if (canShare && isImmutableNode(value)) return refKey(value)

	const proto = Object.getPrototypeOf(value)
	if (!isClonableProto(proto)) return refKey(value)

	seen ??= new Map()
	seen.set(value, seen.size)

	// different prototypes (`~kind` lives there) = different snapshots
	let out =
		'{' +
		(proto === null
			? 'p;'
			: proto === Object.prototype
				? 'q;'
				: refKey(proto))

	const keys = Object.getOwnPropertyNames(value)
	const allEnumerable = Object.keys(value).length === keys.length

	for (let i = 0; i < keys.length; i++) {
		const key = keys[i]!
		const property = value[key]

		out += 'k' + key.length + ':' + key

		const hidden = !allEnumerable && !isEnumerable.call(value, key)

		// non-enumerable markers key by identity, `~cookieFrom` by structure
		out +=
			hidden && key !== '~cookieFrom'
				? '!' + byRefKey(property, state)
				: (hidden ? '~' : '=') + fingerprint(property, seen, state)
	}

	if (Object.getOwnPropertySymbols(value).length) state.bail = true

	return out + '};'
}

function cloneOrWarn(object: object, freeze: boolean): object | undefined {
	try {
		return deepCloneSchema(object, freeze, undefined, new Map(), false)
	} catch (error) {
		console.warn(
			'[Elysia] schema snapshot failed; schema kept by reference:',
			error
		)
	}
}

/**
 * `name`: a new `.model()` clone of the source, never shared: a source used
 * by other names or apps (a bare `t.String()` is a singleton) or another
 * model's clone must not pass on its `$id`
 */
export function snapshotSchema<T>(schema: T, name?: string): T {
	if (schema === null || typeof schema !== 'object') return schema

	const object = schema as unknown as object

	if ('~standard' in object) return schema
	snapshotCalls++

	if (name !== undefined) {
		const pristine = modelPristine.get(object) ?? cloneOrWarn(object, false)
		if (pristine === undefined) return schema

		const cloned = cloneOrWarn(pristine, false)
		if (cloned === undefined) return schema

		modelSources.set(cloned, modelSources.get(object) ?? object)
		modelPristine.set(cloned, pristine)
		modelNames.set(cloned, name)
		produced.add(cloned)

		return cloned as T
	}

	if (produced.has(object) && !Object.isFrozen(object)) return schema

	const existing = modelSnapshots.get(object)
	if (existing) return existing as T

	const cloned = cloneOrWarn(object, false)
	if (cloned === undefined) return schema

	modelSnapshots.set(object, cloned)
	produced.add(cloned)

	return cloned as T
}

const refineMemo = new WeakMap<object, boolean>()

// any keyword, like `collectRefinements` reaches `$defs` or `prefixItems`
function hasRefine(schema: any, seen = new WeakSet<object>()) {
	if (!schema || typeof schema !== 'object' || seen.has(schema)) return false
	seen.add(schema)

	if (schema['~refine']) return true
	for (const key in schema) if (hasRefine(schema[key], seen)) return true

	return false
}

// a direct validator's schema is the caller's, a route's is already a snapshot
export function ownSchema<T>(schema: T): T {
	if (schema === null || typeof schema !== 'object' || produced.has(schema))
		return schema

	let needed = refineMemo.get(schema)
	if (needed === undefined)
		refineMemo.set(schema, (needed = hasRefine(schema)))

	return needed ? snapshotSchema(schema) : schema
}

/**
 * The route/guard hook snapshot: deep-frozen, and shared with every
 * structurally identical schema in the process.
 */
function internSchema<T>(
	schema: T,
	intern: boolean,
	models: ModelScope | undefined
): T {
	if (schema === null || typeof schema !== 'object') return schema

	const object = schema as unknown as object
	if ('~standard' in object) return schema

	const source = modelSources.get(object)
	if (source) {
		if (models?.table[modelNames.get(object)!] === object) return schema

		const model = models && modelIndex(models).get(source)
		if (model) return model as T

		return internSchema(modelPristine.get(object) as T, intern, models)
	}

	if (produced.has(object)) return schema

	// this app's own `.model()` clone of the source, carrying its `$id`
	const model = models && modelIndex(models).get(object)
	if (model) return model as T

	const existing = hookSnapshots.get(object)
	if (existing) return existing as T

	let key: string | undefined
	if (intern) {
		const state: FingerprintState = { bail: false }

		try {
			key = fingerprint(object, undefined, state, false)
		} catch {}

		if (state.bail) key = undefined
	}

	if (key !== undefined) {
		const shared = interned.get(key)

		if (shared !== undefined) {
			if (interned.size >= INTERN_LIMIT) {
				interned.delete(key)
				interned.set(key, shared)
			}
			hookSnapshots.set(object, shared)

			return shared as T
		}
	}

	const cloned = cloneOrWarn(object, true)
	if (cloned === undefined) return schema

	hookSnapshots.set(object, cloned)
	produced.add(cloned)

	if (key !== undefined) {
		if (interned.size >= INTERN_LIMIT) evictOldestHalf(interned)

		interned.set(key, cloned)
	}

	return cloned as T
}

// a model table and, once a schema asks, its source -> first clone index
type ModelScope = {
	table: Record<string, unknown>
	index?: Map<object, object>
}

function modelIndex(models: ModelScope) {
	if (models.index) return models.index

	// ponytail: rebuilt per route registration, O(models); cache per table if a large-model app shows it
	const index = (models.index = new Map())
	for (const name in models.table) {
		const model = models.table[name] as object
		const source = modelSources.get(model)

		if (source && !index.has(source)) index.set(source, model)
	}

	return index
}

function snapshotSlots(
	target: Record<string, any>,
	intern: boolean,
	models: ModelScope | undefined
) {
	for (const slot of schemaSlots)
		if (target[slot] != null)
			target[slot] = internSchema(target[slot], intern, models)

	const response = target.response
	if (response != null) {
		if (
			typeof response === 'object' &&
			!('~standard' in response) &&
			isStatusMap(response)
		) {
			let next: Record<string, any> = {}
			const state: FingerprintState = { bail: false }
			let key = 'M'

			for (const status in response) {
				const schema = internSchema(response[status], intern, models)

				Object.defineProperty(next, status, {
					value: schema,
					enumerable: true
				})
				key += status.length + ':' + status + byRefKey(schema, state)
			}

			if (key === 'M') target.response = next
			else {
				if (intern && !state.bail) {
					const shared = interned.get(key)

					if (shared === undefined) {
						if (interned.size >= INTERN_LIMIT)
							evictOldestHalf(interned)

						interned.set(key, next)
					} else {
						if (interned.size >= INTERN_LIMIT) {
							interned.delete(key)
							interned.set(key, shared)
						}

						next = shared
					}
				}

				target.response = Object.freeze(next)
			}
		} else target.response = internSchema(response, intern, models)
	}
}

function isStatusMap(response: Record<string, any>): boolean {
	if ('type' in response || '~kind' in response || '$ref' in response)
		return false

	for (const key in response) {
		if (!Number.isInteger(Number(key))) return false
	}

	return true
}

const hasSlot = (target: Record<string, any>) =>
	schemaSlots.some((slot) => target[slot] != null) || target.response != null

export function snapshotHookSchemas<T extends Record<string, any> | undefined>(
	hook: T,
	models?: Record<string, unknown>
): T {
	if (!hook) return hook

	// detect whether anything needs snapshotting without mutating the original
	const needsCopy = hasSlot(hook)
	const schemas = hook.schemas

	if (
		!needsCopy &&
		!(Array.isArray(schemas) && schemas.some((e) => e && hasSlot(e)))
	)
		return hook

	snapshotCalls++
	const intern = !env.ELYSIA_AOT_BUILD
	const scope = models && { table: models }

	const copy: Record<string, any> = Object.assign(
		Object.create(Object.getPrototypeOf(hook)),
		hook
	)

	snapshotSlots(copy, intern, scope)

	if (Array.isArray(schemas)) {
		copy.schemas = schemas.map((entry) => {
			if (!entry || typeof entry !== 'object') return entry

			const entryCopy: Record<string, any> = Object.assign(
				Object.create(Object.getPrototypeOf(entry)),
				entry
			)
			snapshotSlots(entryCopy, intern, scope)

			return entryCopy
		})
	}

	return copy as T
}
