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

export const clone = <T extends Object = Object>(aObject: T): T => {
	const bObject: Record<string, any> = Array.isArray(aObject) ? [] : {}

	let value: Partial<T>
	for (const key in aObject) {
		value = aObject[key]

		bObject[key as any] =
			typeof value === 'object' ? clone(value as T) : value
	}

	return bObject as T
}

export const mapArrayObject = (value: [string, string][]) => {
	const object: Record<string, string> = {}

	value.forEach(([key, value]) => (object[key] = value))

	return object
}
