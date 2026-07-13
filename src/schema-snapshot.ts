// original user object -> our snapshot
const snapshots = new WeakMap<object, object>()
// set of snapshots produced for idempotency (snapshot fed back in)
const produced = new WeakSet<object>()

const schemaProtoMarkers = new Set(['~kind', '~standard', '~unsafe'])

function isClonableProto(proto: object | null): boolean {
	if (proto === null || proto === Object.prototype) return true

	for (const key of Object.getOwnPropertyNames(proto))
		if (!schemaProtoMarkers.has(key)) return false

	if (Object.getOwnPropertySymbols(proto).length) return false

	return isClonableProto(Object.getPrototypeOf(proto))
}

function deepCloneSchema(value: any, seen: WeakMap<object, object>): any {
	if (value === null || typeof value !== 'object') return value

	const cached = seen.get(value)
	if (cached) return cached

	if (Array.isArray(value)) {
		const out: any[] = []
		seen.set(value, out)
		for (let i = 0; i < value.length; i++)
			out[i] = deepCloneSchema(value[i], seen)
		return out
	}

	const proto = Object.getPrototypeOf(value)
	if (!isClonableProto(proto)) return value

	const out: Record<keyof any, any> = Object.create(proto)
	seen.set(value, out)

	const descriptors = Object.getOwnPropertyDescriptors(value)
	for (const key of Reflect.ownKeys(descriptors)) {
		const desc = (descriptors as any)[key]
		if (desc.enumerable && 'value' in desc)
			desc.value = deepCloneSchema(desc.value, seen)

		Object.defineProperty(out, key, desc)
	}

	return out
}

export function snapshotSchema<T>(schema: T): T {
	// undefined / null / strings (model refs) / non-objects pass through
	if (schema === null || typeof schema !== 'object') return schema

	const object = schema as unknown as object

	if ('~standard' in object) return schema
	if (produced.has(object)) return schema

	const existing = snapshots.get(object)
	if (existing) return existing as T

	let cloned: object
	try {
		cloned = deepCloneSchema(object, new WeakMap()) as object
	} catch (error) {
		console.warn(
			'[Elysia] schema snapshot failed; schema kept by reference:',
			error
		)

		return schema
	}

	snapshots.set(object, cloned)
	produced.add(cloned)

	return cloned as T
}

function snapshotSlots(target: Record<string, any>): boolean {
	let touched = false

	const body = target.body
	if (body != null) {
		target.body = snapshotSchema(body)
		touched = true
	}

	const query = target.query
	if (query != null) {
		target.query = snapshotSchema(query)
		touched = true
	}

	const params = target.params
	if (params != null) {
		target.params = snapshotSchema(params)
		touched = true
	}

	const headers = target.headers
	if (headers != null) {
		target.headers = snapshotSchema(headers)
		touched = true
	}

	const cookie = target.cookie
	if (cookie != null) {
		target.cookie = snapshotSchema(cookie)
		touched = true
	}

	const response = target.response
	if (response != null) {
		if (
			typeof response === 'object' &&
			!('~standard' in response) &&
			isStatusMap(response)
		) {
			const next: Record<string, any> = {}
			for (const status in response)
				next[status] = snapshotSchema(response[status])
			target.response = next
		} else target.response = snapshotSchema(response)

		touched = true
	}

	return touched
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

	if (
		hook.body != null ||
		hook.query != null ||
		hook.params != null ||
		hook.headers != null ||
		hook.cookie != null ||
		hook.response != null
	)
		needsCopy = true

	const schemas = hook.schemas
	if (!needsCopy && Array.isArray(schemas)) {
		for (const entry of schemas)
			if (
				entry &&
				(entry.body != null ||
					entry.query != null ||
					entry.params != null ||
					entry.headers != null ||
					entry.cookie != null ||
					entry.response != null)
			) {
				needsCopy = true
				break
			}
	}

	if (!needsCopy) return hook

	const copy: Record<string, any> = Object.assign(
		Object.create(Object.getPrototypeOf(hook)),
		hook
	)

	snapshotSlots(copy)

	if (Array.isArray(schemas)) {
		copy.schemas = schemas.map((entry) => {
			if (!entry || typeof entry !== 'object') return entry

			const entryCopy: Record<string, any> = Object.assign(
				Object.create(Object.getPrototypeOf(entry)),
				entry
			)
			snapshotSlots(entryCopy)

			return entryCopy
		})
	}

	return copy as T
}
