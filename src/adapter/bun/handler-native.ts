import { isHTMLBundle } from '.'
import type { Context } from '../../context'
import type { AnyLocalHook, MaybePromise } from '../../types'

import { mapResponse } from './handler'

export const createNativeStaticHandler = (
	handle: unknown,
	hooks: AnyLocalHook,
	set?: Context['set']
): (() => MaybePromise<Response>) | undefined => {
	if (typeof handle === 'function' || handle instanceof Blob) return

	if (isHTMLBundle(handle)) return () => handle as any

	const response = mapResponse(
		handle,
		set ?? {
			headers: {}
		}
	)

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

		return () => response.clone() as Response
	}
}
