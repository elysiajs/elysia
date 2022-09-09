import type { Hook, RegisterHook } from './types'

export const concatArrayObject = <T>(a: T[], b: T | T[]): T[] => [
	...a,
	...(Array.isArray(b) ? b : [b])
]

export const mergeHook = (a: Hook, b?: Hook | RegisterHook): Hook<any> => ({
	onRequest: concatArrayObject(a?.onRequest, b?.onRequest ?? []) ?? [],
	transform: concatArrayObject(a?.transform, b?.transform ?? []) ?? [],
	preHandler: concatArrayObject(a?.preHandler, b?.preHandler ?? []) ?? []
})

export const isPromise = <T>(
	response: T | Promise<T>
): response is Promise<T> => response instanceof Promise

export const clone = <T extends Object | any[] = Object | any[]>(
	aObject: T
): T => {
	const bObject: Record<string, any> = Array.isArray(aObject)
		? []
		: Object.create(null)

	let value: Partial<T>
	for (const key in aObject) {
		value = aObject[key] as any

		bObject[key as any] =
			typeof value === 'object' ? clone(value as T) : value
	}

	return bObject as T
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

export const getQuery = (url: string): string => {
	const queryIndex = url.indexOf('?') + 1

	return queryIndex ? url.substring(queryIndex) : ''
}

export const parseQuery = (search: string) =>
	!search
		? {}
		: search.split('&').reduce((result, each) => {
				const i = each.indexOf('=')
				result[each.slice(0, i)] = each.slice(i + 1)

				return result
		  }, {} as Record<string, string>)
