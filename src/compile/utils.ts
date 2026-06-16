import type { MaybeArray } from "../types"

export function isAsyncFunction(fn: Function) {
	return (
		fn.constructor.name === 'AsyncFunction' ||
		fn.constructor.name === 'AsyncGeneratorFunction'
	)
}

export const isAsyncLifecycle = (handlers: MaybeArray<Function> | undefined) =>
	handlers
		? Array.isArray(handlers)
			? handlers.some(isAsyncFunction)
			: isAsyncFunction(handlers)
		: false
