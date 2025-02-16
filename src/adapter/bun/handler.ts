import type { Context } from '../../context'
import type { AnyLocalHook } from '../../types'

import {
	mapResponse,
	mapEarlyResponse,
	mapCompactResponse,
	createStaticHandler
} from '../web-standard/handler'

export const createNativeStaticHandler = (
	handle: unknown,
	hooks: AnyLocalHook,
	setHeaders: Context['set']['headers'] = {}
): (() => Response) | undefined => {
	if (typeof handle === 'function' || handle instanceof Blob) return

	if (
		typeof handle === 'object' &&
		handle?.toString() === '[object HTMLBundle]'
	)
		// Bun HTMLBundle
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
		if (!response.headers.has('content-type'))
			response.headers.append('content-type', 'text/plain;charset=utf-8')

		return response.clone.bind(response)
	}
}

export {
	mapResponse,
	mapEarlyResponse,
	mapCompactResponse,
	createStaticHandler
}
