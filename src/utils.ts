import type { Hook, RegisterHook } from './types'

export const mergeObjectArray = <T>(a: T | T[], b: T | T[]): T[] => [
	...(Array.isArray(a) ? a : [a]),
	...(Array.isArray(b) ? b : [b])
]

export const mergeHook = (
	a: Hook | RegisterHook<any, any>,
	b: Hook | RegisterHook<any, any>
): Hook<any> => ({
	onRequest: mergeObjectArray(a?.onRequest ?? [], b?.onRequest ?? []) ?? [],
	transform: mergeObjectArray(a?.transform ?? [], b?.transform ?? []) ?? [],
	preHandler: mergeObjectArray(a?.preHandler ?? [], b?.preHandler ?? []) ?? []
})

export const isPromise = <T>(
	response: T | Promise<T>
): response is Promise<T> => response instanceof Promise

export const clone = <T extends Object | any[] = Object | any[]>(
	value: T
): T => {
	const [cloned] = [value] as [T]

	return cloned
}

// export const splitOnce = (char: string, s: string) => {
// 	const i = s.indexOf(char)

// 	return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]
// }

export const getPath = (url: string): string => {
	const queryIndex = url.indexOf('?')

	return url.substring(
		url.charCodeAt(0) === 47 ? 0 : url.indexOf('/', 11),
		queryIndex === -1 ? url.length : queryIndex
	)
}

export const mapQuery = (url: string): Record<string, string> => {
	const queryIndex = url.indexOf('?') + 1

	return queryIndex
		? url
				.substring(queryIndex)
				.split('&')
				.reduce((result, each) => {
					const i = each.indexOf('=')
					result[each.slice(0, i)] = each.slice(i + 1)

					return result
				}, {} as Record<string, string>)
		: {}
}
