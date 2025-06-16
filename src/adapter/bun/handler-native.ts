import type { Context } from '../../context'
import type { AnyLocalHook, MaybePromise } from '../../types'

import { mapResponse } from './handler'

export const createNativeStaticHandler = (
	handle: unknown,
	hooks: AnyLocalHook,
	setHeaders: Context['set']['headers'] = {}
): (() => MaybePromise<Response>) | undefined => {
	if (typeof handle === 'function' || handle instanceof Blob) return

	if (
		typeof handle === 'object' &&
		handle?.toString() === '[object HTMLBundle]'
	)
		return () => handle as any

	const response = mapResponse(handle, {
		headers: setHeaders
	})

	if (
		!hooks.parse?.length &&
		!hooks.transform?.length &&
		!hooks.beforeHandle?.length &&
		!hooks.afterHandle?.length
	) {
		if (response instanceof Promise)
			return response.then((response) => {
				if (!response) return

				if (!response.headers.has('content-type'))
					response.headers.append('content-type', 'text/plain')

				return response.clone()
			}) as any as () => Promise<Response>

		if (!response.headers.has('content-type'))
			response.headers.append('content-type', 'text/plain')

		return response.clone.bind(response) as any
	}
}
