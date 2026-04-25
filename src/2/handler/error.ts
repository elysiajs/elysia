import { getAsyncIndexes } from './utils'

import type { Context } from '../context'
import type { AppHook } from '../types'

export function createErrorHandler(
	onErrors: AppHook['error'] | undefined,
	mapResponse: (
		response: unknown,
		set: Context['set'],
		...any: unknown[]
	) => unknown
) {
	const defaultError = new Response('Internal Server Error', { status: 500 })
	if (!onErrors) return () => defaultError.clone()

	const asyncIndexes = getAsyncIndexes(onErrors)
	if (asyncIndexes)
		return async (context: Context, error: Error) => {
			// @ts-expect-error
			context.error = error
			// @ts-expect-error
			context.code = error.code ?? 'UNKNOWN'
			// @ts-expect-error
			if (error?.status) context.set.status = error.status

			for (let i = 0; i < onErrors.length; i++) {
				const error = asyncIndexes?.[i]
					? await onErrors[i](context)
					: onErrors[i](context)

				if (error !== undefined) {
					// @ts-expect-error
					if (error?.status) context.set.status = error.status

					return mapResponse(error, context.set)
				}
			}

			return defaultError.clone()
		}

	return (context: Context, error: Error) => {
		// @ts-expect-error
		context.error = error
		// @ts-expect-error
		context.code = error.code ?? 'UNKNOWN'
		// @ts-expect-error
		if (error?.status) context.set.status = error.status

		for (let i = 0; i < onErrors.length; i++) {
			const error = onErrors[i](context)
			if (error !== undefined) return mapResponse(error, context.set)
		}

		return defaultError.clone() as Response
	}
}
