import type { MaybeArray } from "../types"

export function isAsyncFunction(fn: Function) {
	if (
		fn.constructor.name === 'AsyncFunction' ||
		fn.constructor.name === 'AsyncGeneratorFunction'
	)
		return true

	return false
}

export const isAsyncLifecycle = (handlers: MaybeArray<Function> | undefined) =>
	handlers
		? Array.isArray(handlers)
			? handlers.some(isAsyncFunction)
			: isAsyncFunction(handlers)
		: false
