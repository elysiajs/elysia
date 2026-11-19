import { isHTMLBundle } from './index'
import type { Context } from '../../context'
import type { AnyLocalHook, MaybePromise } from '../../types'

import { mapResponse } from './handler'

const isEmptyPipelineHook = (hooks: AnyLocalHook) => {
	for (const key in hooks) {
		switch (key) {
			case 'detail':
			case 'tags':
			case 'start':
			case 'stop':
			case 'error':
			case 'afterResponse':
				continue
		}

		const value = (hooks as Record<string, unknown>)[key]

		if (
			value !== undefined &&
			value !== false &&
			(!Array.isArray(value) || value.length)
		)
			return false
	}

	return true
}

export const createNativeStaticHandler = (
	handle: unknown,
	hooks: AnyLocalHook,
	set?: Context['set']
): (() => MaybePromise<Response>) | undefined => {
	if (typeof handle === 'function' || handle instanceof Blob) return

	if (!isEmptyPipelineHook(hooks)) return

	if (isHTMLBundle(handle)) return () => handle as any

	const response = mapResponse(
		handle instanceof Response
			? handle.clone()
			: handle instanceof Promise
				? handle.then((x) =>
						x instanceof Response
							? x.clone()
							: isHTMLBundle(x)
								? () => x
								: x
					)
				: handle,
		set ?? {
			headers: {}
		}
	)

	if (response instanceof Promise)
		return response.then((response) => {
			if (!response) return

			return response.clone()
		}) as any as () => Promise<Response>

	return () => response.clone() as Response
}
