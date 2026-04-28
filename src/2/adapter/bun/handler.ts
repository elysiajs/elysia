/* eslint-disable sonarjs/no-nested-switch */

import { mapResponse } from '../web-standard/handler'

import type { Context } from '../../context'

/* eslint-disable sonarjs/no-duplicate-string */
export function mapStaticHandler(
	handle: unknown,
	hooks: Partial<AnyLocalHook>,
	setHeaders?: Context['set']['headers']
): (() => Response) | undefined {
	if (typeof handle === 'function') return

	const response = mapResponse(handle, {
		headers: setHeaders ?? {}
	})

	if (
		!hooks.parse?.length &&
		!hooks.transform?.length &&
		!hooks.beforeHandle?.length &&
		!hooks.afterHandle?.length
	)
		return () => response.clone() as Response
}
