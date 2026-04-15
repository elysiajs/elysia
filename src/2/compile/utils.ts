export function isAsyncFunction(fn: Function) {
	if (
		fn.constructor.name === 'AsyncFunction' ||
		fn.constructor.name === 'AsyncGeneratorFunction'
	)
		return true

	return false
}
