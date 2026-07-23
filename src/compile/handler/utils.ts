import { deriveEntryFn, isMapDeriveEntry, type DeriveEntry } from '../../utils'

export function cloneResponse(value: unknown) {
	return value instanceof Response ? value.clone() : value
}

export function hasRequestBody(request: Request) {
	const length = request.headers.get('content-length')
	if (length !== null) return length !== '0'
	if (request.headers.get('transfer-encoding') !== null) return true
	return request.body != null
}

export function replaceDeriveContext(context: any, derivative: any) {
	if (context === derivative) return context

	const mapped = Object.assign(Object.create(null), derivative)
	const preserved = {
		request: context.request,
		store: context.store,
		set: context.set,
		body: context.body,
		query: context.query,
		params: context.params,
		headers: context.headers,
		cookie: context.cookie,
		server: context.server,
		path: context.path,
		route: context.route,
		rid: context.rid,
		trace: context.trace,
		qi: context.qi,
		responseValue: context.responseValue,
		error: context.error,
		status: context.status,
		redirect: context.redirect
	}

	for (const key of Reflect.ownKeys(context)) delete context[key]
	Object.assign(context, mapped, preserved)
	return context
}

export function deriveModes(
	hooks: Function[],
	entries?: readonly DeriveEntry[]
) {
	if (!entries?.length) return

	const queues = new Map<Function, boolean[]>()
	for (const entry of entries) {
		const fn = deriveEntryFn(entry)
		const queue = queues.get(fn)
		const mode = isMapDeriveEntry(entry)
		if (queue) queue.push(mode)
		else queues.set(fn, [mode])
	}

	let found = false
	const modes: (boolean | undefined)[] = Array(hooks.length)
	for (let i = 0; i < hooks.length; i++) {
		const queue = queues.get(hooks[i]!)
		if (!queue?.length) continue
		found = true
		modes[i] = queue.shift()
	}

	return found ? modes : undefined
}
