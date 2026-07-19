import type { AnyElysia } from '../base'

export const defaultHeaders = '\0'

export type DefaultResponseState = {
	headers: Record<string, string>
	status?: number | string
	cookie?: Record<string, any>
}

let defaults = new WeakMap<
	AnyElysia,
	{
		headers: Record<string, string> | null
		response: DefaultResponseState | undefined
	}
>()

export function clearContextDefaults() {
	defaults = new WeakMap()
}

export function contextDefaults(app: AnyElysia) {
	const cached = defaults.get(app)
	if (cached) return cached

	const ext = app['~ext']
	const adapter = app['~config']?.adapter
	const source = ext?.headers
	const headers =
		source && Object.keys(source).length
			? Object.assign(Object.create(null), source)
			: null

	let response: DefaultResponseState | undefined
	if (headers && (!adapter || adapter.response.supportsDefaultHeaderSink)) {
		Object.defineProperty(headers, defaultHeaders, { value: headers })
		Object.freeze(headers)
		response = Object.freeze({ headers })
	}

	const value = { headers, response }
	defaults.set(app, value)
	return value
}
