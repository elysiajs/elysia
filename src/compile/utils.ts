import type { MaybeArray } from "../types"

export function isAsyncFunction(fn: Function) {
	return (
		fn.constructor.name === 'AsyncFunction' ||
		fn.constructor.name === 'AsyncGeneratorFunction'
	)
}

const matchResponseClone = /=>\s?response\.clone\(/
const matchFnReturn = /(?:return|=>)\s?\S+\(|a(?:sync|wait)/

export function mayReturnPromise(fn: Function): boolean {
	const literal = fn.toString()
	if (matchResponseClone.test(literal)) return false
	return matchFnReturn.test(literal)
}

export const isAsyncLifecycle = (handlers: MaybeArray<Function> | undefined) =>
	handlers
		? Array.isArray(handlers)
			? handlers.some(isAsyncFunction)
			: isAsyncFunction(handlers)
		: false
