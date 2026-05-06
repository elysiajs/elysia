import { isAsyncFunction } from '../compile/utils'

export function getAsyncIndexes(onRequests: Function[]) {
	let asyncIndexes: number[] | undefined
	for (let i = 0; i < onRequests.length; i++)
		if (isAsyncFunction(onRequests[i])) {
			asyncIndexes ??= new Array(onRequests.length)
			asyncIndexes[i] = i
		}

	return asyncIndexes
}
