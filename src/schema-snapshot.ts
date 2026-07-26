import { env } from './universal'

const modelSnapshots = new WeakMap<object, object>()
const hookSnapshots = new WeakMap<object, object>()

// structural fingerprint -> shared frozen snapshot. Process-wide is safe:
// functions/Dates/foreign instances are keyed by identity in `fingerprint`,
// so apps holding different callbacks can never land on the same entry
const interned = new Map<string, object>()

// insertion-order LRU, same policy as `TypeBoxValidatorCache`
const INTERN_LIMIT = 1024

// set of snapshots produced for idempotency (snapshot fed back in)
const produced = new WeakSet<object>()

// prototype -> `isClonableProto` verdict (one walk per shared `~kind` proto)
const clonableProtos = new WeakMap<object, boolean>()

// node -> may the snapshot keep it by reference? A frozen node whose own
// properties are all primitive data can never change again, so cloning it
// (e.g. the `t.String()` singleton, once per route) only produces a slower
// equal. Roots are excluded, see `canShare`
const immutableNodes = new WeakMap<object, boolean>()

const isEnumerable = Object.prototype.propertyIsEnumerable

const schemaProtoMarkers = new Set(['~kind', '~standard', '~unsafe'])
const schemaSlots = ['body', 'query', 'params', 'headers', 'cookie'] as const

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

function isImmutableNode(value: object): boolean {
	const memo = immutableNodes.get(value)
	if (memo !== undefined) return memo

	// unfrozen = fresh per-route object; memoising it would only churn the map
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

// set during a hook-path clone: owned nodes freeze on the way out (what makes
// cross-route/cross-app sharing safe)
// Borrowed nodes stay unfrozen, freezing a `Date` the user still holds would be a write to their object
let freezeClones = false

function deepCloneSchema(
	value: any,
	// plain Map on purpose: call-scoped, WeakMap is ~40% slower per entry on JSC
	seen?: Map<object, object>,
	// callers write to the returned root (`.model()` stamps `$id`), so a root
	// is always a private, mutable clone
	canShare = true
): any {
	if (value === null || typeof value !== 'object') return value

	const cached = seen?.get(value)
	if (cached) return cached

	if (Array.isArray(value)) {
		const out: any[] = []

		seen ??= new Map()
		seen.set(value, out)

		for (let i = 0; i < value.length; i++)
			out[i] = deepCloneSchema(value[i], seen)

		return freezeClones ? Object.freeze(out) : out
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
		// reference, matching `copyNonEnumerable`
		if (!allEnumerable && !isEnumerable.call(value, key)) {
			Object.defineProperty(out, key, {
				value: property,
				enumerable: false,
				writable: true,
				configurable: true
			})

			continue
		}

		const cloned = deepCloneSchema(property, seen)

		// `out.__proto__ = x` reaches the `Object.prototype` setter and
		// re-parents `out` instead of creating an own property
		if (key === '__proto__')
			Object.defineProperty(out, key, {
				value: cloned,
				enumerable: true,
				writable: true,
				configurable: true
			})
		else out[key] = cloned
	}

	const symbols = Object.getOwnPropertySymbols(value)
	for (let i = 0; i < symbols.length; i++) {
		const key = symbols[i]!
		const property = value[key]

		if (isEnumerable.call(value, key))
			out[key] = deepCloneSchema(property, seen)
		else
			Object.defineProperty(out, key, {
				value: property,
				enumerable: false,
				writable: true,
				configurable: true
			})
	}

	return freezeClones ? Object.freeze(out) : out
}

const refIds = new WeakMap<object | Function, number>()
let nextRefId = 0

function refKey(value: object | Function): string {
	let id = refIds.get(value)
	if (id === undefined) refIds.set(value, (id = ++nextRefId))

	return 'r' + id + ';'
}

// symbol-keyed members can't be keyed structurally, a node holding one opts out of sharing
let fingerprintBail = false

const byRefKey = (value: any): string =>
	value !== null && (typeof value === 'object' || typeof value === 'function')
		? refKey(value)
		: fingerprint(value, undefined)

function fingerprint(
	value: any,
	seen: Map<object, number> | undefined,
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
				return 'n' + value + ';'
			case 'boolean':
				return value ? 'T;' : 'F;'
			case 'function':
				return refKey(value)
			case 'undefined':
				return 'u;'
			case 'bigint':
				return 'g' + value + ';'
			default:
				fingerprintBail = true

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
			out += fingerprint(value[i], seen)

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

		// non-enumerable markers clone by reference, so they key by identity
		out +=
			!allEnumerable && !isEnumerable.call(value, key)
				? '!' + byRefKey(property)
				: '=' + fingerprint(property, seen)
	}

	if (Object.getOwnPropertySymbols(value).length) fingerprintBail = true

	return out + '};'
}

/**
 * The `.model()` snapshot: a private, MUTABLE clone. `base.ts` stamps `$id` onto
 * the node this returns, so it is never frozen and never interned.
 */
export function snapshotSchema<T>(schema: T): T {
	if (schema === null || typeof schema !== 'object') return schema

	const object = schema as unknown as object

	if ('~standard' in object) return schema
	if (produced.has(object) && !Object.isFrozen(object)) return schema

	const existing = modelSnapshots.get(object)
	if (existing) return existing as T

	let cloned: object
	try {
		cloned = deepCloneSchema(object, undefined, false) as object
	} catch (error) {
		console.warn(
			'[Elysia] schema snapshot failed; schema kept by reference:',
			error
		)

		return schema
	}

	modelSnapshots.set(object, cloned)
	produced.add(cloned)

	return cloned as T
}

/**
 * The route/guard hook snapshot: deep-frozen, and shared with every
 * structurally identical schema in the process.
 */
function internSchema<T>(schema: T, intern: boolean): T {
	if (schema === null || typeof schema !== 'object') return schema

	const object = schema as unknown as object

	if ('~standard' in object) return schema
	if (produced.has(object)) return schema

	const model = modelSnapshots.get(object)
	if (model) return model as T

	const existing = hookSnapshots.get(object)
	if (existing) return existing as T

	let key: string | undefined
	if (intern) {
		fingerprintBail = false

		try {
			key = fingerprint(object, undefined, false)
		} catch {}

		if (fingerprintBail) key = undefined
	}

	if (key !== undefined) {
		const shared = interned.get(key)

		if (shared !== undefined) {
			interned.delete(key)
			interned.set(key, shared)
			hookSnapshots.set(object, shared)

			return shared as T
		}
	}

	let cloned: object
	freezeClones = true
	try {
		cloned = deepCloneSchema(object, undefined, false) as object
	} catch (error) {
		console.warn(
			'[Elysia] schema snapshot failed; schema kept by reference:',
			error
		)

		return schema
	} finally {
		freezeClones = false
	}

	hookSnapshots.set(object, cloned)
	produced.add(cloned)

	if (key !== undefined) {
		if (interned.size >= INTERN_LIMIT) {
			const oldest = interned.keys().next().value
			if (oldest !== undefined) interned.delete(oldest)
		}

		interned.set(key, cloned)
	}

	return cloned as T
}

function snapshotSlots(target: Record<string, any>, intern: boolean): void {
	for (const slot of schemaSlots)
		if (target[slot] != null)
			target[slot] = internSchema(target[slot], intern)

	const response = target.response
	if (response != null) {
		if (
			typeof response === 'object' &&
			!('~standard' in response) &&
			isStatusMap(response)
		) {
			const next: Record<string, any> = {}
			for (const status in response)
				next[status] = internSchema(response[status], intern)
			target.response = next
		} else target.response = internSchema(response, intern)
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

export function snapshotHookSchemas<T extends Record<string, any> | undefined>(
	hook: T
): T {
	if (!hook) return hook

	// detect whether anything needs snapshotting without mutating the original
	let needsCopy = false

	if (schemaSlots.some((slot) => hook[slot] != null) || hook.response != null)
		needsCopy = true

	const schemas = hook.schemas
	if (!needsCopy && Array.isArray(schemas)) {
		for (const entry of schemas)
			if (
				entry &&
				(schemaSlots.some((slot) => entry[slot] != null) ||
					entry.response != null)
			) {
				needsCopy = true
				break
			}
	}

	if (!needsCopy) return hook

	// an AOT build must see one snapshot per registration, not the intern
	// table's shared graph. `ELYSIA_AOT_BUILD` (unlike `Capture.isCapturing()`)
	// cannot throw on this every-route path. Freezing is NOT gated: writes must
	// fail identically in both modes.
	const intern = !env.ELYSIA_AOT_BUILD

	const copy: Record<string, any> = Object.assign(
		Object.create(Object.getPrototypeOf(hook)),
		hook
	)

	snapshotSlots(copy, intern)

	if (Array.isArray(schemas)) {
		copy.schemas = schemas.map((entry) => {
			if (!entry || typeof entry !== 'object') return entry

			const entryCopy: Record<string, any> = Object.assign(
				Object.create(Object.getPrototypeOf(entry)),
				entry
			)
			snapshotSlots(entryCopy, intern)

			return entryCopy
		})
	}

	return copy as T
}
