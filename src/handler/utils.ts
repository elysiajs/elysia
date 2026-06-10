import { isAsyncFunction } from '../compile/utils'

export function forwardError<T>(value: T): T {
	if (value instanceof Error) throw value

	return value
}

export function getAsyncIndexes(onRequests: Function[]) {
	let asyncIndexes: (true | undefined)[] | undefined
	for (let i = 0; i < onRequests.length; i++)
		if (isAsyncFunction(onRequests[i])) {
			asyncIndexes ??= new Array(onRequests.length)
			asyncIndexes[i] = true
		}

	return asyncIndexes
}
