import type { MaybeArray } from '../types'

export function isAsyncFunction(fn: Function) {
	return (
		fn.constructor.name === 'AsyncFunction' ||
		fn.constructor.name === 'AsyncGeneratorFunction'
	)
}

const matchResponseClone = /=>\s*response\.clone\(/
const matchFnReturn =
	/(?:return|=>)\s*(?:new\s+)?[\w$.][\w$.]*\s*\(|a(?:sync|wait)/

let mayReturnPromiseCache = new WeakMap<Function, boolean>()

export const clearCompileAnalysisCaches = () => {
	mayReturnPromiseCache = new WeakMap()
}

export function mayReturnPromise(fn: Function): boolean {
	let result = mayReturnPromiseCache.get(fn)
	if (result !== undefined) return result

	const literal = fn.toString()
	result = matchResponseClone.test(literal)
		? false
		: matchFnReturn.test(literal)
	mayReturnPromiseCache.set(fn, result)

	return result
}

export const isAsyncLifecycle = (handlers: MaybeArray<Function> | undefined) =>
	handlers
		? Array.isArray(handlers)
			? handlers.some(isAsyncFunction)
			: isAsyncFunction(handlers)
		: false
