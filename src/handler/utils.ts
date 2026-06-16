import { isAsyncFunction } from '../compile/utils'
import { isCloudflareWorker } from '../universal/constants'

// cached + cloned Response factory (Cloudflare can't reuse a Response across requests)
export function cachedResponse(body: string, status: number): () => Response {
	let cached: Response | undefined

	return (): Response =>
		isCloudflareWorker
			? new Response(body, { status })
			: ((cached ??= new Response(body, { status })).clone() as Response)
}

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
