import type { Hook, RegisterHook } from './types'

export const schema = Symbol("schema")

export const mergeObjectArray = <T>(a: T | T[], b: T | T[]): T[] => [
	...(Array.isArray(a) ? a : [a]),
	...(Array.isArray(b) ? b : [b])
]

export const mergeHook = (
	a: Hook | RegisterHook<any, any>,
	b: Hook | RegisterHook<any, any> | Array<Hook | RegisterHook<any, any>>
): Hook<any> => {
	if (!Array.isArray(b))
		return {
			onRequest: mergeObjectArray(a?.onRequest ?? [], b?.onRequest ?? []),
			transform: mergeObjectArray(a?.transform ?? [], b?.transform ?? []),
			preHandler: mergeObjectArray(
				a?.preHandler ?? [],
				b?.preHandler ?? []
			)
		}

	const hook: Hook<any> = {
		onRequest: !a.onRequest
			? []
			: Array.isArray(a.onRequest)
			? a.onRequest
			: [a.onRequest],
		transform: !a.transform
			? []
			: Array.isArray(a.transform)
			? a.transform
			: [a.transform],
		preHandler: !a.preHandler
			? []
			: Array.isArray(a.preHandler)
			? a.preHandler
			: [a.preHandler]
	}

	for (let i = 0; i < b.length; i++) {
		hook.onRequest = mergeObjectArray(hook.onRequest, b[i].onRequest ?? [])
		hook.transform = mergeObjectArray(hook.transform, b[i].transform ?? [])
		hook.preHandler = mergeObjectArray(
			hook.preHandler,
			b[i].preHandler ?? []
		)
	}

	return hook
}

// export const isPromise = <T>(
// 	response: T | Promise<T>
// ): response is Promise<T> => response instanceof Promise

export const clone = <T extends Object | any[] = Object | any[]>(value: T): T =>
	[value][0]

// export const splitOnce = (char: string, s: string) => {
// 	const i = s.indexOf(char)

// 	return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]
// }

export const getPath = (url: string): string => {
	const queryIndex = url.indexOf('?')
	const result = url.substring(
		url.charCodeAt(0) === 47 ? 0 : url.indexOf('/', 11),
		queryIndex === -1 ? url.length : queryIndex
	)

	return result
}

export const mapQuery = (url: string): Record<string, string> => {
	const queryIndex = url.indexOf('?')
	if (queryIndex === -1) return {}

	return url
		.substring(queryIndex + 1)
		.split('&')
		.reduce((result, each) => {
			const i = each.indexOf('=')
			result[each.slice(0, i)] = each.slice(i + 1)

			return result
		}, {} as Record<string, string>)
}
