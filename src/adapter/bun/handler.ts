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

	const response = mapResponse(handle, {
		headers: setHeaders
	})

	if (
		hooks.parse.length === 0 &&
		hooks.transform.length === 0 &&
		hooks.beforeHandle.length === 0 &&
		hooks.afterHandle.length === 0
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
